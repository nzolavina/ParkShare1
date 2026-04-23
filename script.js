const listingGrid = document.getElementById("listingGrid");
const resultsText = document.getElementById("resultsText");
const actionText = document.getElementById("actionText");
const searchForm = document.getElementById("searchForm");
const authText = document.getElementById("authText");
const logoutBtn = document.getElementById("logoutBtn");
const myBookingsLink = document.getElementById("myBookingsLink");
const adminBookingsLink = document.getElementById("adminBookingsLink");
const adminToggleBtn = document.getElementById("adminToggleBtn");
const adminListingForm = document.getElementById("adminListingForm");
const adminBookingsSection = document.getElementById("adminBookingsSection");
const adminBookingsList = document.getElementById("adminBookingsList");
const refreshAdminBookingsBtn = document.getElementById("refreshAdminBookingsBtn");
const imageUploader = document.getElementById("imageUploader");
const imageFileInput = document.getElementById("imageFile");
const imageUploadHint = document.getElementById("imageUploadHint");
const imagePreview = document.getElementById("imagePreview");
const clearImageBtn = document.getElementById("clearImageBtn");
let currentListings = [];
let currentUser = null;
let imagePreviewUrl = null;

const API_BASE =
  window.location.hostname === "localhost" && window.location.port && window.location.port !== "3000"
    ? "http://localhost:3000"
    : "";

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function apiFetch(path, options = {}) {
  return fetch(apiUrl(path), {
    credentials: "include",
    ...options,
  });
}

function listingCardMarkup(listing) {
  const featureMarkup = listing.features.map((feature) => `<span>${feature}</span>`).join("");
  const isAdmin = currentUser?.role === "admin";
  const adminActions = isAdmin
    ? `<button class="btn btn-danger" data-delete-id="${listing.id}">Remove spot</button>`
    : "";

  return `
    <article class="card">
      <div class="card-image" style="background-image:url('${encodeURI(listing.image)}');"></div>
      <div class="card-body">
        <div class="card-top">
          <h3>${listing.title}</h3>
          <p class="price">PHP ${listing.pricePerHour}/hr</p>
        </div>
        <p class="meta">${listing.location} | ${capitalize(listing.type)}</p>
        <div class="badges">${featureMarkup}</div>
        <button class="btn btn-solid" data-id="${listing.id}">Reserve spot</button>
        ${adminActions}
      </div>
    </article>
  `;
}

function capitalize(value) {
  if (!value) {
    return "";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderListings(data) {
  if (!data.length) {
    listingGrid.innerHTML = `
      <article class="card">
        <div class="card-body">
          <h3>No matches found</h3>
          <p class="meta">Try widening your location text or increasing max price.</p>
        </div>
      </article>
    `;
    return;
  }

  listingGrid.innerHTML = data.map(listingCardMarkup).join("");
}

function setActionMessage(message, isError = false) {
  actionText.textContent = message;
  actionText.style.color = isError ? "#9f1239" : "var(--muted)";
}

function setAuthMessage(message, isError = false) {
  authText.textContent = message;
  authText.style.color = isError ? "#9f1239" : "var(--muted)";
}

async function parseResponseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function updateAuthUI(user) {
  currentUser = user;
  const isAuthenticated = Boolean(user);
  const isAdmin = isAuthenticated && user.role === "admin";
  logoutBtn.hidden = !isAuthenticated;
  myBookingsLink.hidden = !isAuthenticated;
  adminBookingsLink.hidden = !isAdmin;
  adminToggleBtn.hidden = !isAdmin;
  adminBookingsSection.hidden = !isAdmin;
  if (!isAdmin) {
    adminListingForm.hidden = true;
    adminBookingsList.innerHTML = "";
  } else {
    loadAdminBookings();
  }

  if (isAuthenticated) {
    const roleLabel = isAdmin ? "admin" : "user";
    setAuthMessage(`Signed in as ${user.name} (${roleLabel})`);
  } else {
    setAuthMessage("Login or sign up to reserve a parking spot.");
  }
}

function formatBookingStatus(status) {
  if (status === "confirmed") {
    return "Confirmed";
  }

  return "Pending approval";
}

function formatTimeForDisplay(timeValue) {
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(timeValue || "")) {
    return timeValue || "";
  }

  const [hourText] = timeValue.split(":");
  const hour = Number(hourText);
  const period = hour >= 12 ? "PM" : "AM";
  const normalized = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalized}:00 ${period}`;
}

function adminBookingCardMarkup(reservation) {
  const status = reservation.status || "pending";
  const receiptMarkup = reservation.receiptPath
    ? `<a class="btn btn-outline" href="${reservation.receiptPath}" target="_blank" rel="noopener">View receipt</a>`
    : `<p class="meta">No receipt uploaded yet.</p>`;

  const approveButton =
    status === "pending"
      ? `<button class="btn btn-solid" data-approve-id="${reservation.id}">Approve booking</button>`
      : `<p class="meta">Approved</p>`;

  return `
    <article class="admin-booking-card">
      <div class="admin-booking-card-top">
        <h4>${reservation.listingTitle}</h4>
        <span class="status-badge ${status}">${formatBookingStatus(status)}</span>
      </div>
      <p class="meta">${reservation.userEmail} | ${reservation.bookingDate} | ${formatTimeForDisplay(reservation.bookingTime)} to ${formatTimeForDisplay(reservation.bookingEndTime)}</p>
      <p class="meta">Total: PHP ${reservation.totalPrice}</p>
      <div class="admin-booking-actions">
        ${receiptMarkup}
        ${approveButton}
      </div>
    </article>
  `;
}

async function loadAdminBookings() {
  if (!currentUser || currentUser.role !== "admin") {
    return;
  }

  try {
    const response = await apiFetch("/api/admin/reservations");
    const payload = await parseResponseJsonSafe(response);
    if (!response.ok) {
      throw new Error(payload?.message || `Failed to load admin bookings (${response.status}).`);
    }

    if (!payload.reservations.length) {
      adminBookingsList.innerHTML = `<p class="meta">No bookings yet.</p>`;
      return;
    }

    adminBookingsList.innerHTML = payload.reservations.map(adminBookingCardMarkup).join("");
  } catch (error) {
    adminBookingsList.innerHTML = `<p class="meta">${error.message}</p>`;
  }
}

async function approveBooking(reservationId) {
  if (!currentUser || currentUser.role !== "admin") {
    setActionMessage("Admin access required.", true);
    return;
  }

  try {
    setActionMessage("Approving booking...");
    const response = await apiFetch(`/api/admin/reservations/${reservationId}/approve`, {
      method: "POST",
    });
    const payload = await parseResponseJsonSafe(response);
    if (!response.ok) {
      throw new Error(payload?.message || `Failed to approve booking (${response.status}).`);
    }

    setActionMessage(payload.message || "Booking approved.");
    await loadAdminBookings();
  } catch (error) {
    setActionMessage(error.message, true);
  }
}

async function refreshAuthState() {
  try {
    const response = await apiFetch("/api/auth/me");
    if (!response.ok) {
      throw new Error("Failed to check auth session.");
    }

    const payload = await response.json();
    updateAuthUI(payload.user);
  } catch (error) {
    updateAuthUI(null);
    setAuthMessage("Auth service unavailable.", true);
  }
}

async function logout() {
  try {
    const response = await apiFetch("/api/auth/logout", { method: "POST" });
    const payload = await parseResponseJsonSafe(response);
    if (!response.ok) {
      throw new Error(payload?.message || `Logout failed (${response.status}).`);
    }

    updateAuthUI(null);
    setAuthMessage("Logged out.");
    setActionMessage("Login to create a reservation.");
  } catch (error) {
    setAuthMessage(error.message, true);
  }
}

async function loadListings() {
  const formData = new FormData(searchForm);
  const location = formData.get("location").toLowerCase().trim();
  const type = formData.get("spotType");
  const priceCap = formData.get("priceCap");

  const params = new URLSearchParams({
    location,
    type,
    priceCap,
  });

  try {
    setActionMessage("Loading listings...");
    const response = await apiFetch(`/api/listings?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Failed to fetch listings.");
    }

    const payload = await response.json();
    currentListings = payload.listings;
    renderListings(currentListings);
    resultsText.textContent = `Showing ${currentListings.length} spot${currentListings.length === 1 ? "" : "s"}.`;
    setActionMessage("Listings updated.");
  } catch (error) {
    renderListings([]);
    resultsText.textContent = "Unable to load listings right now.";
    setActionMessage("Could not reach backend API. Start the server with npm start.", true);
  }
}

function reserveSpot(listingId) {
  window.location.href = `booking.html?listingId=${listingId}`;
}

async function addListing() {
  if (!adminListingForm.reportValidity()) {
    return;
  }

  const formData = new FormData(adminListingForm);

  formData.set("title", (formData.get("title") || "").toString().trim());
  formData.set("location", (formData.get("location") || "").toString().trim());
  formData.set("type", (formData.get("type") || "").toString().trim());
  formData.set("pricePerHour", (formData.get("pricePerHour") || "").toString().trim());
  formData.set("features", (formData.get("features") || "").toString().trim());

  try {
    setActionMessage("Publishing listing...");
    const response = await apiFetch("/api/listings", {
      method: "POST",
      body: formData,
    });

    const body = await parseResponseJsonSafe(response);
    if (!response.ok) {
      throw new Error(body?.message || `Failed to create listing (${response.status}).`);
    }

    adminListingForm.reset();
    resetImagePreview();
    adminListingForm.hidden = true;
    await loadListings();
    setActionMessage(`Listing created: ${body.listing.title}`);
  } catch (error) {
    setActionMessage(error.message, true);
  }
}

async function removeListing(listingId) {
  if (!currentUser || currentUser.role !== "admin") {
    setActionMessage("Admin access required.", true);
    return;
  }

  const confirmed = window.confirm("Remove this listing? This cannot be undone.");
  if (!confirmed) {
    return;
  }

  try {
    setActionMessage("Removing listing...");
    const response = await apiFetch(`/api/listings/${listingId}`, {
      method: "DELETE",
    });
    const body = await parseResponseJsonSafe(response);
    if (!response.ok) {
      throw new Error(body?.message || `Failed to remove listing (${response.status}).`);
    }

    await loadListings();
    setActionMessage("Listing removed.");
  } catch (error) {
    setActionMessage(error.message, true);
  }
}

function resetImagePreview() {
  if (imagePreviewUrl) {
    URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = null;
  }

  imagePreview.hidden = true;
  imagePreview.removeAttribute("src");
  clearImageBtn.hidden = true;
  imageUploadHint.textContent = "Drag and drop image here, or click to browse.";
}

function setImagePreview(file) {
  if (!file) {
    resetImagePreview();
    return;
  }

  if (!file.type.startsWith("image/")) {
    imageFileInput.value = "";
    resetImagePreview();
    setActionMessage("Please choose an image file.", true);
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    imageFileInput.value = "";
    resetImagePreview();
    setActionMessage("Image must be 5MB or smaller.", true);
    return;
  }

  if (imagePreviewUrl) {
    URL.revokeObjectURL(imagePreviewUrl);
  }

  imagePreviewUrl = URL.createObjectURL(file);
  imagePreview.src = imagePreviewUrl;
  imagePreview.hidden = false;
  clearImageBtn.hidden = false;
  imageUploadHint.textContent = `Selected: ${file.name}`;
}

function assignDroppedFile(file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  imageFileInput.files = transfer.files;
  imageFileInput.dispatchEvent(new Event("change"));
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadListings();
});

listingGrid.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("button[data-delete-id]");
  if (deleteButton) {
    const listingId = Number(deleteButton.dataset.deleteId);
    if (Number.isInteger(listingId)) {
      await removeListing(listingId);
    }
    return;
  }

  const reserveButton = event.target.closest("button[data-id]");
  if (!reserveButton) {
    return;
  }

  const listingId = Number(reserveButton.dataset.id);
  const listing = currentListings.find((item) => item.id === listingId);
  if (!listing) {
    return;
  }

  reserveSpot(listing.id);
});

adminBookingsList.addEventListener("click", async (event) => {
  const approveButton = event.target.closest("button[data-approve-id]");
  if (!approveButton) {
    return;
  }

  const reservationId = Number(approveButton.dataset.approveId);
  if (!Number.isInteger(reservationId)) {
    return;
  }

  await approveBooking(reservationId);
});

logoutBtn.addEventListener("click", async () => {
  await logout();
});

adminToggleBtn.addEventListener("click", () => {
  adminListingForm.hidden = !adminListingForm.hidden;
});

adminListingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await addListing();
});

imageUploader.addEventListener("click", (event) => {
  if (event.target === clearImageBtn) {
    return;
  }

  imageFileInput.click();
});

imageUploader.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    imageFileInput.click();
  }
});

imageUploader.addEventListener("dragover", (event) => {
  event.preventDefault();
  imageUploader.classList.add("drag-over");
});

imageUploader.addEventListener("dragleave", () => {
  imageUploader.classList.remove("drag-over");
});

imageUploader.addEventListener("drop", (event) => {
  event.preventDefault();
  imageUploader.classList.remove("drag-over");
  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    return;
  }

  assignDroppedFile(file);
});

imageFileInput.addEventListener("change", () => {
  const file = imageFileInput.files?.[0];
  setImagePreview(file);
});

clearImageBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  imageFileInput.value = "";
  resetImagePreview();
});

refreshAdminBookingsBtn?.addEventListener("click", async () => {
  await loadAdminBookings();
  setActionMessage("Booking approvals refreshed.");
});

refreshAuthState();
loadListings();
