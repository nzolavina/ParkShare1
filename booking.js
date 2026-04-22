const bookingForm = document.getElementById("bookingForm");
const bookingText = document.getElementById("bookingText");
const bookingListingText = document.getElementById("bookingListingText");
const bookingDateInput = document.getElementById("bookingDate");
const bookingTimeInput = document.getElementById("bookingTime");
const bookingEndTimeInput = document.getElementById("bookingEndTime");
const durationHoursInput = document.getElementById("durationHours");
const timeField = document.getElementById("timeField");
const calendarGrid = document.getElementById("calendarGrid");
const calendarMonthLabel = document.getElementById("calendarMonthLabel");
const calendarPrev = document.getElementById("calendarPrev");
const calendarNext = document.getElementById("calendarNext");
const timeBlockGrid = document.getElementById("timeBlockGrid");
const selectedTimeText = document.getElementById("selectedTimeText");

const params = new URLSearchParams(window.location.search);
const listingId = Number(params.get("listingId"));
let listing = null;
const today = new Date();
today.setHours(0, 0, 0, 0);
let selectedDateIso = "";
let displayMonth = today.getMonth();
let displayYear = today.getFullYear();
let selectedStartHour = null;
let selectedEndHour = null;
let occupiedHours = new Set();

function formatHourForApi(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatHourForDisplay(hour) {
  const period = hour >= 12 ? "PM" : "AM";
  const normalized = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalized}:00 ${period}`;
}

function setMessage(message, isError = false) {
  bookingText.textContent = message;
  bookingText.style.color = isError ? "#9f1239" : "var(--muted)";
}

function toIsoDate(date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 10);
}

function setSelectedDate(date) {
  selectedDateIso = toIsoDate(date);
  bookingDateInput.value = selectedDateIso;
  timeField.hidden = false;
  bookingTimeInput.required = true;
  bookingEndTimeInput.required = true;
  durationHoursInput.required = true;

  selectedStartHour = null;
  selectedEndHour = null;
  bookingTimeInput.value = "";
  bookingEndTimeInput.value = "";
  durationHoursInput.value = "";
  selectedTimeText.textContent = "No time selected yet.";
  loadAvailabilityForDate(selectedDateIso);

  renderCalendar();
}

function rangeHasOccupiedHour(startHour, endHour) {
  for (let hour = startHour; hour < endHour; hour += 1) {
    if (occupiedHours.has(hour)) {
      return true;
    }
  }

  return false;
}

async function loadAvailabilityForDate(dateIso) {
  if (!listing || !Number.isInteger(listingId)) {
    occupiedHours = new Set();
    renderTimeBlocks();
    return;
  }

  try {
    const response = await fetch(`/api/listings/${listingId}/availability?date=${encodeURIComponent(dateIso)}`);
    if (!response.ok) {
      throw new Error("Could not load availability.");
    }

    const payload = await response.json();
    occupiedHours = new Set(payload.occupiedHours || []);
    renderTimeBlocks();
  } catch (_error) {
    occupiedHours = new Set();
    renderTimeBlocks();
    setMessage("Availability info is temporarily unavailable.", true);
  }
}

function applyTimeSelection() {
  if (selectedStartHour === null || selectedEndHour === null) {
    bookingTimeInput.value = "";
    bookingEndTimeInput.value = "";
    durationHoursInput.value = "";
    selectedTimeText.textContent = "No time selected yet.";
    return;
  }

  bookingTimeInput.value = formatHourForApi(selectedStartHour);
  bookingEndTimeInput.value = formatHourForApi(selectedEndHour);
  durationHoursInput.value = String(selectedEndHour - selectedStartHour);
  selectedTimeText.textContent = `Selected: ${formatHourForDisplay(selectedStartHour)} to ${formatHourForDisplay(selectedEndHour)} (${durationHoursInput.value} hour(s))`;
}

function renderTimeBlocks() {
  timeBlockGrid.innerHTML = "";

  for (let hour = 0; hour < 24; hour += 1) {
    const blockButton = document.createElement("button");
    blockButton.type = "button";
    blockButton.className = "time-block";
    blockButton.textContent = formatHourForDisplay(hour);
    const isOccupied = occupiedHours.has(hour);

    const inRange =
      selectedStartHour !== null &&
      selectedEndHour !== null &&
      hour >= selectedStartHour &&
      hour < selectedEndHour;
    if (inRange) {
      blockButton.classList.add("selected");
    }
    if (selectedStartHour === hour) {
      blockButton.classList.add("start");
    }
    if (selectedEndHour !== null && selectedEndHour === hour) {
      blockButton.classList.add("end");
    }

    if (isOccupied) {
      blockButton.classList.add("occupied");
      blockButton.disabled = true;
    }

    blockButton.addEventListener("click", () => {
      if (selectedStartHour === null || (selectedStartHour !== null && selectedEndHour !== null)) {
        selectedStartHour = hour;
        selectedEndHour = null;
      } else if (hour <= selectedStartHour) {
        selectedStartHour = hour;
        selectedEndHour = null;
      } else if (rangeHasOccupiedHour(selectedStartHour, hour)) {
        setMessage("Selected range includes occupied time blocks.", true);
        return;
      } else {
        selectedEndHour = hour;
      }

      applyTimeSelection();
      renderTimeBlocks();
    });

    timeBlockGrid.appendChild(blockButton);
  }
}

function renderCalendar() {
  const firstDay = new Date(displayYear, displayMonth, 1);
  const lastDay = new Date(displayYear, displayMonth + 1, 0);
  const monthName = firstDay.toLocaleString("en-US", { month: "long", year: "numeric" });

  calendarMonthLabel.textContent = monthName;
  calendarGrid.innerHTML = "";

  for (let i = 0; i < firstDay.getDay(); i += 1) {
    const emptyCell = document.createElement("span");
    emptyCell.className = "calendar-empty";
    calendarGrid.appendChild(emptyCell);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const dayDate = new Date(displayYear, displayMonth, day);
    dayDate.setHours(0, 0, 0, 0);
    const dayIso = toIsoDate(dayDate);
    const isPastOrToday = dayDate <= today;
    const isSelected = dayIso === selectedDateIso;

    const dayButton = document.createElement("button");
    dayButton.type = "button";
    dayButton.className = "calendar-day";
    dayButton.textContent = String(day);
    if (isSelected) {
      dayButton.classList.add("selected");
    }
    if (isPastOrToday) {
      dayButton.disabled = true;
      dayButton.classList.add("disabled");
    }

    dayButton.addEventListener("click", () => {
      setSelectedDate(dayDate);
    });

    calendarGrid.appendChild(dayButton);
  }
}

async function checkAuth() {
  const response = await fetch("/api/auth/me");
  if (!response.ok) {
    throw new Error("Could not verify session.");
  }

  const payload = await response.json();
  if (!payload.authenticated) {
    setMessage("Please login first to continue booking.", true);
    setTimeout(() => {
      window.location.href = "login.html";
    }, 1200);
    return false;
  }

  return true;
}

async function loadListing() {
  if (!Number.isInteger(listingId)) {
    setMessage("Invalid listing link.", true);
    bookingForm.hidden = true;
    return;
  }

  try {
    const response = await fetch(`/api/listings/${listingId}`);
    if (!response.ok) {
      throw new Error("Listing not found.");
    }

    const payload = await response.json();
    listing = payload.listing;
    bookingListingText.textContent = `${listing.title} in ${listing.location} - PHP ${listing.pricePerHour}/hr`;
    if (selectedDateIso) {
      await loadAvailabilityForDate(selectedDateIso);
    }
  } catch (error) {
    setMessage(error.message, true);
    bookingForm.hidden = true;
  }
}

async function submitBooking() {
  if (!listing) {
    return;
  }

  const formData = new FormData(bookingForm);
  const bookingDate = (formData.get("bookingDate") || "").toString();
  const bookingTime = (formData.get("bookingTime") || "").toString();
  const bookingEndTime = (formData.get("bookingEndTime") || "").toString();
  const durationHours = Number(formData.get("durationHours"));

  if (!bookingDate) {
    setMessage("Please select a booking date.", true);
    return;
  }

  if (!bookingTime) {
    setMessage("Please select a start and end booking time.", true);
    return;
  }

  if (!bookingEndTime) {
    setMessage("Please complete your time range selection.", true);
    return;
  }

  try {
    setMessage("Creating reservation...");
    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId,
        bookingDate,
        bookingTime,
        bookingEndTime,
        durationHours,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Failed to create reservation.");
    }

    const reservationId = payload.reservation?.id;
    if (!Number.isInteger(reservationId)) {
      throw new Error("Reservation created but missing reference id.");
    }

    const total = listing.pricePerHour * durationHours;
    setMessage(`Reservation created. Total: PHP ${total}. Redirecting to payment...`);
    setTimeout(() => {
      window.location.href = `payment.html?reservationId=${reservationId}`;
    }, 1500);
  } catch (error) {
    setMessage(error.message, true);
  }
}

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitBooking();
});

calendarPrev.addEventListener("click", () => {
  displayMonth -= 1;
  if (displayMonth < 0) {
    displayMonth = 11;
    displayYear -= 1;
  }
  renderCalendar();
});

calendarNext.addEventListener("click", () => {
  displayMonth += 1;
  if (displayMonth > 11) {
    displayMonth = 0;
    displayYear += 1;
  }
  renderCalendar();
});

(async () => {
  renderCalendar();
  const isAuthed = await checkAuth();
  if (!isAuthed) {
    return;
  }

  await loadListing();
})();
