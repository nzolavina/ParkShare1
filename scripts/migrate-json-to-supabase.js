require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const rootDir = path.join(__dirname, "..");
const dataDir = path.join(rootDir, "data");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

async function readJson(fileName) {
  const filePath = path.join(dataDir, fileName);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function toSnakeDate(value) {
  if (!value) {
    return null;
  }

  return value;
}

async function main() {
  console.log("Reading local JSON files...");
  const users = await readJson("users.json");
  const listings = await readJson("listings.json");
  const reservations = await readJson("reservations.json");

  console.log("Clearing Supabase tables...");
  await supabase.from("reservations").delete().neq("id", 0);
  await supabase.from("listings").delete().neq("id", 0);
  await supabase.from("users").delete().neq("id", 0);

  if (users.length) {
    console.log(`Inserting ${users.length} users...`);
    const payload = users.map((user) => ({
      id: Number(user.id),
      name: user.name,
      email: user.email,
      role: user.role || "user",
      password_hash: user.passwordHash,
      created_at: toSnakeDate(user.createdAt),
    }));

    const { error } = await supabase.from("users").insert(payload);
    if (error) {
      throw error;
    }
  }

  if (listings.length) {
    console.log(`Inserting ${listings.length} listings...`);
    const payload = listings.map((listing) => ({
      id: Number(listing.id),
      title: listing.title,
      location: listing.location,
      type: listing.type,
      price_per_hour: Number(listing.pricePerHour),
      image: listing.image,
      features: Array.isArray(listing.features) ? listing.features : [],
    }));

    const { error } = await supabase.from("listings").insert(payload);
    if (error) {
      throw error;
    }
  }

  if (reservations.length) {
    console.log(`Inserting ${reservations.length} reservations...`);
    const payload = reservations.map((reservation) => ({
      id: Number(reservation.id),
      listing_id: Number(reservation.listingId),
      listing_title: reservation.listingTitle,
      location: reservation.location,
      price_per_hour: Number(reservation.pricePerHour),
      booking_date: reservation.bookingDate,
      booking_time: reservation.bookingTime,
      booking_end_time: reservation.bookingEndTime,
      duration_hours: Number(reservation.durationHours),
      total_price: Number(reservation.totalPrice),
      user_id: Number(reservation.userId),
      user_email: reservation.userEmail,
      status: reservation.status || "pending",
      receipt_path: reservation.receiptPath || null,
      approved_at: reservation.approvedAt || null,
      approved_by: reservation.approvedBy || null,
      created_at: toSnakeDate(reservation.createdAt),
    }));

    const { error } = await supabase.from("reservations").insert(payload);
    if (error) {
      throw error;
    }
  }

  console.log("Migration complete.");
}

main().catch((error) => {
  console.error("Migration failed:", error.message || error);
  process.exit(1);
});
