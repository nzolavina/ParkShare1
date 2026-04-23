const pendingBookingsList = document.getElementById("pendingBookingsList");
const confirmedBookingsList = document.getElementById("confirmedBookingsList");
const myBookingsText = document.getElementById("myBookingsText");

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

function setMessage(message, isError = false) {
  myBookingsText.textContent = message;
  myBookingsText.style.color = isError ? "#9f1239" : "var(--muted)";
}

async function parseResponseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
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

function bookingCardMarkup(booking) {
  const status = booking.status || "pending";
  const statusLabel = status === "confirmed" ? "Confirmed" : "Pending approval";
  const statusClass = status === "confirmed" ? "confirmed" : "pending";
  const receiptNote = booking.receiptPath
    ? `<p class="meta">Receipt uploaded.</p>`
    : `<p class="meta">No receipt uploaded yet.</p>`;

  return `
    <article class="my-booking-card">
      <div class="admin-booking-card-top">
        <h3>${booking.listingTitle}</h3>
        <span class="status-badge ${statusClass}">${statusLabel}</span>
      </div>
      <p class="meta">${booking.bookingDate} | ${formatTimeForDisplay(booking.bookingTime)} to ${formatTimeForDisplay(booking.bookingEndTime)}</p>
      <p class="meta">Total: PHP ${booking.totalPrice}</p>
      ${receiptNote}
      ${status === "pending" ? `<a class="btn btn-outline" href="payment.html?reservationId=${booking.id}">Open payment page</a>` : ""}
    </article>
  `;
}

async function checkAuth() {
  const response = await apiFetch("/api/auth/me");
  if (!response.ok) {
    throw new Error(`Could not verify session (${response.status}).`);
  }

  const payload = await parseResponseJsonSafe(response);
  if (!payload.authenticated) {
    setMessage("Please login to view your bookings.", true);
    setTimeout(() => {
      window.location.href = "login.html";
    }, 1200);
    return false;
  }

  return true;
}

async function loadBookings() {
  try {
    setMessage("Loading bookings...");
    const response = await apiFetch("/api/reservations");
    const payload = await parseResponseJsonSafe(response);
    if (!response.ok) {
      throw new Error(payload?.message || `Failed to load your bookings (${response.status}).`);
    }

    const reservations = payload.reservations || [];
    const pending = reservations.filter((item) => (item.status || "pending") !== "confirmed");
    const confirmed = reservations.filter((item) => (item.status || "pending") === "confirmed");

    pendingBookingsList.innerHTML = pending.length
      ? pending.map(bookingCardMarkup).join("")
      : `<p class="meta">No pending bookings.</p>`;

    confirmedBookingsList.innerHTML = confirmed.length
      ? confirmed.map(bookingCardMarkup).join("")
      : `<p class="meta">No confirmed bookings yet.</p>`;

    setMessage("Bookings updated.");
  } catch (error) {
    setMessage(error.message, true);
  }
}

(async () => {
  const authed = await checkAuth();
  if (!authed) {
    return;
  }

  await loadBookings();
})();
