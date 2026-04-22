const paymentBookingText = document.getElementById("paymentBookingText");
const paymentTotalAmount = document.getElementById("paymentTotalAmount");
const paymentText = document.getElementById("paymentText");
const receiptForm = document.getElementById("receiptForm");

const params = new URLSearchParams(window.location.search);
const reservationId = Number(params.get("reservationId"));
let reservation = null;

async function parseResponseJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

function setMessage(message, isError = false) {
  paymentText.textContent = message;
  paymentText.style.color = isError ? "#9f1239" : "var(--muted)";
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

async function checkAuth() {
  const response = await fetch("/api/auth/me");
  if (!response.ok) {
    throw new Error("Could not verify session.");
  }

  const payload = await response.json();
  if (!payload.authenticated) {
    setMessage("Please login first.", true);
    setTimeout(() => {
      window.location.href = "login.html";
    }, 1200);
    return false;
  }

  return true;
}

async function loadReservation() {
  try {
    const response = await fetch("/api/reservations");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Failed to load reservations.");
    }

    const reservations = payload.reservations || [];
    if (!reservations.length) {
      throw new Error("You do not have any bookings yet.");
    }

    if (Number.isInteger(reservationId)) {
      reservation = reservations.find((item) => item.id === reservationId) || null;
    }

    if (!reservation) {
      reservation = reservations.find((item) => (item.status || "pending") !== "confirmed") || reservations[0];
    }

    paymentBookingText.textContent = `${reservation.listingTitle} on ${reservation.bookingDate}, ${formatTimeForDisplay(reservation.bookingTime)} to ${formatTimeForDisplay(reservation.bookingEndTime)}.`;
    paymentTotalAmount.textContent = `PHP ${reservation.totalPrice}`;

    if (reservation.status === "confirmed") {
      setMessage("This booking is already approved.");
      receiptForm.hidden = true;
      return;
    }

    if (reservation.receiptPath) {
      setMessage("Receipt already uploaded. Waiting for admin approval.");
    }
  } catch (error) {
    setMessage(error.message, true);
    receiptForm.hidden = true;
  }
}

async function submitReceipt() {
  if (!reservation) {
    return;
  }

  if (!receiptForm.reportValidity()) {
    return;
  }

  const formData = new FormData(receiptForm);
  try {
    const latestReservationsResponse = await fetch("/api/reservations");
    const latestReservationsPayload = await parseResponseJson(latestReservationsResponse);
    if (!latestReservationsResponse.ok) {
      throw new Error(latestReservationsPayload.message || "Could not refresh bookings.");
    }

    const latestReservations = latestReservationsPayload.reservations || [];
    if (!latestReservations.length) {
      throw new Error("No booking available for receipt upload.");
    }

    const matchedReservation = latestReservations.find((item) => item.id === reservation.id);
    if (!matchedReservation) {
      reservation =
        latestReservations.find((item) => (item.status || "pending") !== "confirmed") ||
        latestReservations[0];
    } else {
      reservation = matchedReservation;
    }

    if ((reservation.status || "pending") === "confirmed") {
      throw new Error("This booking is already approved.");
    }

    setMessage("Uploading receipt...");
    const response = await fetch(`/api/reservations/${reservation.id}/receipt`, {
      method: "POST",
      body: formData,
    });

    const payload = await parseResponseJson(response);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Booking not found. Open My Bookings and select a pending booking, then upload the receipt again.");
      }
      throw new Error(payload.message || "Failed to upload receipt.");
    }

    setMessage(payload.message || "Receipt uploaded.");
    receiptForm.reset();
  } catch (error) {
    setMessage(error.message, true);
  }
}

receiptForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitReceipt();
});

(async () => {
  const authed = await checkAuth();
  if (!authed) {
    return;
  }

  await loadReservation();
})();
