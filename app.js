require("dotenv").config();

const express = require("express");
const path = require("node:path");
const crypto = require("node:crypto");
const session = require("express-session");
const multer = require("multer");
const pg = require("pg");
const connectPgSimple = require("connect-pg-simple");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "admin@parkshare.local");
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "Admin123!").toString();
const ADMIN_NAME = (process.env.ADMIN_NAME || "ParkShare Admin").toString();
const LISTING_BUCKET = process.env.SUPABASE_LISTING_BUCKET || "listing-images";
const RECEIPT_BUCKET = process.env.SUPABASE_RECEIPT_BUCKET || "receipts";
const SESSION_STORE_MODE = (process.env.SESSION_STORE_MODE || "auto").toLowerCase();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

const memoryUpload = multer.memoryStorage();
const upload = multer({
  storage: memoryUpload,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      callback(new Error("Only image files are allowed."));
      return;
    }

    callback(null, true);
  },
});

const receiptUpload = multer({
  storage: memoryUpload,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const isImage = file.mimetype.startsWith("image/");
    const isPdf = file.mimetype === "application/pdf";
    if (!isImage && !isPdf) {
      callback(new Error("Only image or PDF receipt files are allowed."));
      return;
    }

    callback(null, true);
  },
});

app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^http:\/\/localhost:\d+$/.test(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

const sessionOptions = {
  secret: process.env.SESSION_SECRET || "parkshare-dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
};

const isServerlessRuntime =
  process.env.VERCEL === "1" ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
  Boolean(process.env.LAMBDA_TASK_ROOT);

const shouldUseDatabaseSessionStore =
  SESSION_STORE_MODE === "database" ||
  (SESSION_STORE_MODE === "auto" && Boolean(process.env.DATABASE_URL) && !isServerlessRuntime);

function buildPgPoolConfig(databaseUrl) {
  const config = {
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    family: 4,
  };

  try {
    const parsedUrl = new URL(databaseUrl);
    const sslMode = parsedUrl.searchParams.get("sslmode");
    if (sslMode === "require") {
      config.ssl = { rejectUnauthorized: false };
    }
  } catch (_error) {
    // Keep default config if URL parsing fails.
  }

  return config;
}

if (shouldUseDatabaseSessionStore && process.env.DATABASE_URL) {
  const PgStore = connectPgSimple(session);
  const pool = new pg.Pool(buildPgPoolConfig(process.env.DATABASE_URL));
  const pgStore = new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: true,
  });
  pgStore.on("error", (error) => {
    console.error("Session store connection error:", error.message);
  });
  sessionOptions.store = pgStore;
} else {
  if (SESSION_STORE_MODE === "memory") {
    console.log("SESSION_STORE_MODE=memory, using in-memory sessions.");
  } else if (SESSION_STORE_MODE === "auto" && isServerlessRuntime) {
    console.log("SESSION_STORE_MODE=auto on serverless runtime, using in-memory sessions.");
  } else if (SESSION_STORE_MODE === "auto" && !process.env.DATABASE_URL) {
    console.log("SESSION_STORE_MODE=auto without DATABASE_URL, using in-memory sessions.");
  }
}

app.use(session(sessionOptions));
app.use(express.static(__dirname));

let initPromise = null;

app.use("/api", async (_req, res, next) => {
  try {
    await ensureInitialized();
    return next();
  } catch (error) {
    console.error("API initialization failed:", error);
    return res.status(500).json({ message: "Server initialization failed." });
  }
});

function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      const client = getSupabase();
      await ensureAdminAccount(client);
    })();
  }

  return initPromise;
}

function getSupabase() {
  if (!supabase) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return supabase;
}

function parsePrice(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function normalizeEmail(value) {
  return (value || "").toString().trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = (storedHash || "").split(":");
  if (!salt || !key) {
    return false;
  }

  const hashBuffer = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, "hex");
  if (hashBuffer.length !== keyBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hashBuffer, keyBuffer);
}

function mapUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role || "user",
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || "user",
    createdAt: user.createdAt,
  };
}

function mapListingRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    title: row.title,
    location: row.location,
    type: row.type,
    pricePerHour: Number(row.price_per_hour),
    image: row.image,
    features: Array.isArray(row.features) ? row.features : [],
  };
}

function mapReservationRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    listingTitle: row.listing_title,
    location: row.location,
    pricePerHour: Number(row.price_per_hour),
    bookingDate: row.booking_date,
    bookingTime: row.booking_time,
    bookingEndTime: row.booking_end_time,
    durationHours: Number(row.duration_hours),
    totalPrice: Number(row.total_price),
    userId: Number(row.user_id),
    userEmail: row.user_email,
    status: row.status || "pending",
    receiptPath: row.receipt_path || null,
    approvedAt: row.approved_at || null,
    approvedBy: row.approved_by ? Number(row.approved_by) : null,
    createdAt: row.created_at,
  };
}

function toPublicReservation(reservation) {
  return {
    id: reservation.id,
    listingId: reservation.listingId,
    listingTitle: reservation.listingTitle,
    location: reservation.location,
    pricePerHour: reservation.pricePerHour,
    bookingDate: reservation.bookingDate,
    bookingTime: reservation.bookingTime,
    bookingEndTime: reservation.bookingEndTime,
    durationHours: reservation.durationHours,
    totalPrice: reservation.totalPrice,
    status: reservation.status || "pending",
    receiptPath: reservation.receiptPath || null,
    approvedAt: reservation.approvedAt || null,
    createdAt: reservation.createdAt,
  };
}

function normalizeSpotType(value) {
  const type = (value || "").toString().trim().toLowerCase();
  const allowedTypes = new Set(["driveway", "garage", "lot", "condo"]);
  return allowedTypes.has(type) ? type : null;
}

function normalizeFeatures(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => item.toString().trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  return [];
}

function parseTimeToMinutes(value) {
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatTimeForDisplay(value) {
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) {
    return value;
  }

  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = hour24 >= 12 ? "PM" : "AM";
  return `${hour12}:00 ${period}`;
}

function reservationRangeInMinutes(reservation) {
  const start = parseTimeToMinutes((reservation.bookingTime || "").toString());
  const end = parseTimeToMinutes((reservation.bookingEndTime || "").toString());

  if (start !== null && end !== null && end > start) {
    return { start, end };
  }

  const fallbackDuration = Number(reservation.durationHours);
  if (start !== null && Number.isFinite(fallbackDuration) && fallbackDuration > 0) {
    return { start, end: start + fallbackDuration * 60 };
  }

  return null;
}

function isSupabaseStoragePublicUrl(url, bucketName) {
  if (typeof url !== "string") {
    return false;
  }

  return url.includes(`/storage/v1/object/public/${bucketName}/`);
}

function extractStorageObjectPath(publicUrl, bucketName) {
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const index = publicUrl.indexOf(marker);
  if (index < 0) {
    return null;
  }

  return publicUrl.slice(index + marker.length);
}

async function getNextId(tableName) {
  const client = getSupabase();
  const { data, error } = await client
    .from(tableName)
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || !Number.isFinite(Number(data.id))) {
    return 1;
  }

  return Number(data.id) + 1;
}

async function uploadToStorage(bucketName, file, prefix) {
  const client = getSupabase();
  const extension = path.extname(file.originalname || "").toLowerCase() || ".bin";
  const objectPath = `${prefix}/${Date.now()}-${crypto.randomUUID()}${extension}`;

  const { error: uploadError } = await client.storage
    .from(bucketName)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = client.storage.from(bucketName).getPublicUrl(objectPath);
  return data.publicUrl;
}

async function ensureAdminAccount(client) {
  const { data: existingRow, error: lookupError } = await client
    .from("users")
    .select("id,email,role,name,password_hash")
    .eq("email", ADMIN_EMAIL)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  if (existingRow) {
    const updates = {};

    if (existingRow.role !== "admin") {
      updates.role = "admin";
    }

    if (existingRow.name !== ADMIN_NAME) {
      updates.name = ADMIN_NAME;
    }

    if (!verifyPassword(ADMIN_PASSWORD, existingRow.password_hash || "")) {
      updates.password_hash = hashPassword(ADMIN_PASSWORD);
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await client
        .from("users")
        .update(updates)
        .eq("id", existingRow.id);

      if (updateError) {
        throw updateError;
      }
    }

    return;
  }

  const nextAdminId = await getNextId("users");

  const { error: insertError } = await client.from("users").insert({
    id: nextAdminId,
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    role: "admin",
    password_hash: hashPassword(ADMIN_PASSWORD),
  });

  if (insertError) {
    throw insertError;
  }
}

async function getCurrentUser(req) {
  if (!req.session?.userId) {
    return null;
  }

  const client = getSupabase();
  const { data, error } = await client
    .from("users")
    .select("id,name,email,role,password_hash,created_at")
    .eq("id", req.session.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return mapUserRow(data);
}

async function requireAuth(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(500).json({ message: "Failed to validate session." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required." });
  }

  return next();
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return res.status(200).json({ authenticated: false, user: null });
    }

    return res.json({ authenticated: true, user: publicUser(user) });
  } catch (error) {
    console.error("GET /api/auth/me failed:", error);
    return res.status(500).json({ message: "Failed to load session." });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = (req.body?.name || "").toString().trim();
    const email = normalizeEmail(req.body?.email);
    const password = (req.body?.password || "").toString();

    if (!name || !email || password.length < 6) {
      return res
        .status(400)
        .json({ message: "Name, email, and password (min 6 chars) are required." });
    }

    const client = getSupabase();
    const { data: existing, error: lookupError } = await client
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    if (existing) {
      return res.status(409).json({ message: "Email already registered." });
    }

    const nextUserId = await getNextId("users");

    const { data: createdRow, error: insertError } = await client
      .from("users")
      .insert({
        id: nextUserId,
        name,
        email,
        role: "user",
        password_hash: hashPassword(password),
      })
      .select("id,name,email,role,password_hash,created_at")
      .single();

    if (insertError) {
      throw insertError;
    }

    const user = mapUserRow(createdRow);
    req.session.userId = user.id;
    return res.status(201).json({
      message: `Welcome, ${user.name}!`,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("POST /api/auth/register failed:", error);
    return res.status(500).json({ message: "Failed to register user." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = (req.body?.password || "").toString();

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const client = getSupabase();
    const { data: row, error: lookupError } = await client
      .from("users")
      .select("id,name,email,role,password_hash,created_at")
      .eq("email", email)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    const user = mapUserRow(row);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    req.session.userId = user.id;
    return res.json({ message: "Logged in successfully.", user: publicUser(user) });
  } catch (error) {
    console.error("POST /api/auth/login failed:", error);
    return res.status(500).json({ message: "Failed to login." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ message: "Failed to logout." });
    }

    return res.json({ message: "Logged out." });
  });
});

app.get("/api/listings", async (req, res) => {
  try {
    const client = getSupabase();
    const { data, error } = await client
      .from("listings")
      .select("id,title,location,type,price_per_hour,image,features")
      .order("id", { ascending: true });

    if (error) {
      throw error;
    }

    const listings = (data || []).map(mapListingRow);
    const location = (req.query.location || "").toString().trim().toLowerCase();
    const type = (req.query.type || "all").toString().trim().toLowerCase();
    const priceCap = parsePrice(req.query.priceCap);

    const filtered = listings.filter((listing) => {
      const title = listing.title.toLowerCase();
      const listingLocation = listing.location.toLowerCase();
      const listingType = listing.type.toLowerCase();

      const locationMatches =
        location.length === 0 || listingLocation.includes(location) || title.includes(location);
      const typeMatches = type === "all" || listingType === type;
      const priceMatches = listing.pricePerHour <= priceCap;

      return locationMatches && typeMatches && priceMatches;
    });

    return res.json({ count: filtered.length, listings: filtered });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load listings." });
  }
});

app.get("/api/listings/:id", async (req, res) => {
  try {
    const listingId = Number(req.params.id);
    if (!Number.isInteger(listingId)) {
      return res.status(400).json({ message: "Invalid listing id." });
    }

    const client = getSupabase();
    const { data, error } = await client
      .from("listings")
      .select("id,title,location,type,price_per_hour,image,features")
      .eq("id", listingId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const listing = mapListingRow(data);
    if (!listing) {
      return res.status(404).json({ message: "Listing not found." });
    }

    return res.json({ listing });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load listing." });
  }
});

app.get("/api/listings/:id/availability", async (req, res) => {
  try {
    const listingId = Number(req.params.id);
    const bookingDate = (req.query.date || "").toString();
    if (!Number.isInteger(listingId)) {
      return res.status(400).json({ message: "Invalid listing id." });
    }

    if (!bookingDate || Number.isNaN(Date.parse(bookingDate))) {
      return res.status(400).json({ message: "date query is required in YYYY-MM-DD format." });
    }

    const client = getSupabase();
    const { data, error } = await client
      .from("reservations")
      .select("booking_time,booking_end_time,duration_hours")
      .eq("listing_id", listingId)
      .eq("booking_date", bookingDate)
      .eq("status", "confirmed");

    if (error) {
      throw error;
    }

    const occupiedRanges = (data || [])
      .map((row) =>
        reservationRangeInMinutes({
          bookingTime: row.booking_time,
          bookingEndTime: row.booking_end_time,
          durationHours: row.duration_hours,
        })
      )
      .filter(Boolean);

    const occupiedHours = new Set();
    occupiedRanges.forEach((range) => {
      for (let minute = range.start; minute <= range.end; minute += 60) {
        occupiedHours.add(Math.floor(minute / 60));
      }
    });

    return res.json({
      listingId,
      bookingDate,
      occupiedHours: Array.from(occupiedHours).sort((a, b) => a - b),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load availability." });
  }
});

app.post("/api/listings", requireAuth, requireAdmin, upload.single("imageFile"), async (req, res) => {
  try {
    const title = (req.body?.title || "").toString().trim();
    const location = (req.body?.location || "").toString().trim();
    const type = normalizeSpotType(req.body?.type);
    const features = normalizeFeatures(req.body?.features);
    const pricePerHour = Number(req.body?.pricePerHour);

    if (!title || !location || !type || !Number.isFinite(pricePerHour) || pricePerHour <= 0) {
      return res.status(400).json({
        message: "title, location, valid type, and positive pricePerHour are required.",
      });
    }

    let image = "images/images.jpg";
    if (req.file) {
      image = await uploadToStorage(LISTING_BUCKET, req.file, "listings");
    }

    const client = getSupabase();
    const nextListingId = await getNextId("listings");

    const { data, error } = await client
      .from("listings")
      .insert({
        id: nextListingId,
        title,
        location,
        type,
        price_per_hour: pricePerHour,
        image,
        features: features.length ? features : ["New listing"],
      })
      .select("id,title,location,type,price_per_hour,image,features")
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({ message: "Listing created.", listing: mapListingRow(data) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create listing." });
  }
});

app.delete("/api/listings/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const listingId = Number(req.params.id);
    if (!Number.isInteger(listingId)) {
      return res.status(400).json({ message: "Invalid listing id." });
    }

    const client = getSupabase();
    const { data: deletedRow, error } = await client
      .from("listings")
      .delete()
      .eq("id", listingId)
      .select("id,image")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!deletedRow) {
      return res.status(404).json({ message: "Listing not found." });
    }

    const imagePath = deletedRow.image;
    if (isSupabaseStoragePublicUrl(imagePath, LISTING_BUCKET)) {
      const objectPath = extractStorageObjectPath(imagePath, LISTING_BUCKET);
      if (objectPath) {
        await client.storage.from(LISTING_BUCKET).remove([objectPath]);
      }
    }

    return res.json({ message: "Listing removed.", deletedListingId: Number(deletedRow.id) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to remove listing." });
  }
});

app.post("/api/reservations", requireAuth, async (req, res) => {
  try {
    const listingId = Number(req.body?.listingId);
    const bookingDate = (req.body?.bookingDate || "").toString();
    const bookingTime = (req.body?.bookingTime || "").toString();
    const bookingEndTime = (req.body?.bookingEndTime || "").toString();
    const durationHours = Number(req.body?.durationHours);

    if (!Number.isInteger(listingId)) {
      return res.status(400).json({ message: "listingId is required and must be an integer." });
    }

    if (!bookingDate || Number.isNaN(Date.parse(bookingDate))) {
      return res.status(400).json({ message: "bookingDate is required and must be a valid date." });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bookingDay = new Date(`${bookingDate}T00:00:00`);
    if (!(bookingDay > today)) {
      return res.status(400).json({ message: "Bookings must be at least one day in advance." });
    }

    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(bookingTime)) {
      return res.status(400).json({ message: "bookingTime is required and must be in HH:MM format." });
    }

    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(bookingEndTime)) {
      return res.status(400).json({ message: "bookingEndTime is required and must be in HH:MM format." });
    }

    const [startHour, startMinute] = bookingTime.split(":").map(Number);
    const [endHour, endMinute] = bookingEndTime.split(":").map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    if (endMinutes <= startMinutes) {
      return res.status(400).json({ message: "bookingEndTime must be after bookingTime." });
    }

    const computedDuration = (endMinutes - startMinutes) / 60;
    if (!Number.isInteger(computedDuration)) {
      return res.status(400).json({ message: "Time range must be in whole-hour blocks." });
    }

    if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 24) {
      return res.status(400).json({ message: "durationHours must be between 1 and 24." });
    }

    if (durationHours !== computedDuration) {
      return res.status(400).json({ message: "durationHours does not match selected time range." });
    }

    const client = getSupabase();
    const { data: listingRow, error: listingError } = await client
      .from("listings")
      .select("id,title,location,price_per_hour")
      .eq("id", listingId)
      .maybeSingle();

    if (listingError) {
      throw listingError;
    }

    const listing = mapListingRow(listingRow);
    if (!listing) {
      return res.status(404).json({ message: "Listing not found." });
    }

    const { data: confirmedRows, error: overlapError } = await client
      .from("reservations")
      .select("booking_time,booking_end_time,duration_hours")
      .eq("listing_id", listingId)
      .eq("booking_date", bookingDate)
      .eq("status", "confirmed");

    if (overlapError) {
      throw overlapError;
    }

    const hasOverlap = (confirmedRows || [])
      .map((row) =>
        reservationRangeInMinutes({
          bookingTime: row.booking_time,
          bookingEndTime: row.booking_end_time,
          durationHours: row.duration_hours,
        })
      )
      .filter(Boolean)
      .some((range) => startMinutes <= range.end && endMinutes >= range.start);

    if (hasOverlap) {
      return res.status(409).json({ message: "Selected time overlaps with an existing booking." });
    }

    const nextReservationId = await getNextId("reservations");

    const { data: reservationRow, error: insertError } = await client
      .from("reservations")
      .insert({
        id: nextReservationId,
        listing_id: listing.id,
        listing_title: listing.title,
        location: listing.location,
        price_per_hour: listing.pricePerHour,
        booking_date: bookingDate,
        booking_time: bookingTime,
        booking_end_time: bookingEndTime,
        duration_hours: durationHours,
        total_price: listing.pricePerHour * durationHours,
        user_id: req.user.id,
        user_email: req.user.email,
        status: "pending",
        receipt_path: null,
        approved_at: null,
        approved_by: null,
      })
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    const reservation = mapReservationRow(reservationRow);
    return res.status(201).json({
      message: `Reservation created for ${listing.title} on ${bookingDate} from ${formatTimeForDisplay(bookingTime)} to ${formatTimeForDisplay(bookingEndTime)}. Complete payment upload for admin approval.`,
      reservation: toPublicReservation(reservation),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create reservation." });
  }
});

app.get("/api/reservations/:id", requireAuth, async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    if (!Number.isInteger(reservationId)) {
      return res.status(400).json({ message: "Invalid reservation id." });
    }

    const client = getSupabase();
    const { data: row, error } = await client
      .from("reservations")
      .select("*")
      .eq("id", reservationId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const reservation = mapReservationRow(row);
    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found." });
    }

    const isOwner = reservation.userId === req.user.id;
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Not allowed to view this reservation." });
    }

    return res.json({ reservation: toPublicReservation(reservation) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load reservation." });
  }
});

app.post(
  "/api/reservations/:id/receipt",
  requireAuth,
  receiptUpload.single("receiptFile"),
  async (req, res) => {
    try {
      const reservationId = Number(req.params.id);
      if (!Number.isInteger(reservationId)) {
        return res.status(400).json({ message: "Invalid reservation id." });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Receipt file is required." });
      }

      const client = getSupabase();
      const { data: row, error } = await client
        .from("reservations")
        .select("*")
        .eq("id", reservationId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const reservation = mapReservationRow(row);
      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found." });
      }

      const isOwner = reservation.userId === req.user.id;
      if (!isOwner) {
        return res.status(403).json({ message: "You can only upload receipt for your own booking." });
      }

      if ((reservation.status || "pending") === "confirmed") {
        return res.status(409).json({ message: "Reservation is already approved." });
      }

      const uploadedReceiptUrl = await uploadToStorage(RECEIPT_BUCKET, req.file, "receipts");

      const { data: updatedRow, error: updateError } = await client
        .from("reservations")
        .update({ receipt_path: uploadedReceiptUrl })
        .eq("id", reservationId)
        .select("*")
        .single();

      if (updateError) {
        throw updateError;
      }

      return res.json({
        message: "Receipt uploaded. Waiting for admin approval.",
        reservation: toPublicReservation(mapReservationRow(updatedRow)),
      });
    } catch (error) {
      return res.status(500).json({ message: "Failed to upload receipt." });
    }
  }
);

app.get("/api/reservations", requireAuth, async (req, res) => {
  try {
    const client = getSupabase();
    const { data, error } = await client
      .from("reservations")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const reservations = (data || []).map((row) => toPublicReservation(mapReservationRow(row)));
    return res.json({ count: reservations.length, reservations });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load reservations." });
  }
});

app.get("/api/admin/reservations", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const client = getSupabase();
    const { data, error } = await client
      .from("reservations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const reservations = (data || []).map((row) => {
      const mapped = mapReservationRow(row);
      return {
        ...toPublicReservation(mapped),
        userId: mapped.userId,
        userEmail: mapped.userEmail,
      };
    });

    return res.json({ count: reservations.length, reservations });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load reservations." });
  }
});

app.post("/api/admin/reservations/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    if (!Number.isInteger(reservationId)) {
      return res.status(400).json({ message: "Invalid reservation id." });
    }

    const client = getSupabase();
    const { data: row, error } = await client
      .from("reservations")
      .select("*")
      .eq("id", reservationId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const reservation = mapReservationRow(row);
    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found." });
    }

    if ((reservation.status || "pending") === "confirmed") {
      return res.status(409).json({ message: "Reservation already approved." });
    }

    if (!reservation.receiptPath) {
      return res.status(400).json({ message: "Cannot approve without an uploaded receipt." });
    }

    const targetRange = reservationRangeInMinutes(reservation);
    if (!targetRange) {
      return res.status(400).json({ message: "Reservation has invalid time range." });
    }

    const { data: confirmedRows, error: overlapError } = await client
      .from("reservations")
      .select("booking_time,booking_end_time,duration_hours")
      .eq("listing_id", reservation.listingId)
      .eq("booking_date", reservation.bookingDate)
      .eq("status", "confirmed")
      .neq("id", reservation.id);

    if (overlapError) {
      throw overlapError;
    }

    const hasOverlap = (confirmedRows || [])
      .map((item) =>
        reservationRangeInMinutes({
          bookingTime: item.booking_time,
          bookingEndTime: item.booking_end_time,
          durationHours: item.duration_hours,
        })
      )
      .filter(Boolean)
      .some((range) => targetRange.start <= range.end && targetRange.end >= range.start);

    if (hasOverlap) {
      return res.status(409).json({
        message: "Cannot approve because the selected time is already confirmed for another booking.",
      });
    }

    const { data: updatedRow, error: updateError } = await client
      .from("reservations")
      .update({
        status: "confirmed",
        approved_at: new Date().toISOString(),
        approved_by: req.user.id,
      })
      .eq("id", reservation.id)
      .select("*")
      .single();

    if (updateError) {
      throw updateError;
    }

    return res.json({
      message: "Reservation approved. The time slot is now unavailable.",
      reservation: toPublicReservation(mapReservationRow(updatedRow)),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to approve reservation." });
  }
});

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ message: "File upload failed. Check file size and format." });
  }

  if (
    error &&
    (error.message === "Only image files are allowed." ||
      error.message === "Only image or PDF receipt files are allowed.")
  ) {
    return res.status(400).json({ message: error.message });
  }

  return next(error);
});

module.exports = app;
module.exports.ensureInitialized = ensureInitialized;
