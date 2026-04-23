const loginForm = document.getElementById("loginPageForm");
const loginText = document.getElementById("loginPageText");
const logoutBtn = document.getElementById("logoutPageBtn");

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
  loginText.textContent = message;
  loginText.style.color = isError ? "#9f1239" : "var(--muted)";
}

async function parseResponseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

async function checkSession() {
  try {
    const response = await apiFetch("/api/auth/me");
    const payload = await parseResponseJsonSafe(response);

    if (!response.ok) {
      throw new Error(`Auth check failed (${response.status}).`);
    }

    if (payload && payload.authenticated) {
      setMessage(`Signed in as ${payload.user.name}. You can continue to booking.`);
      return;
    }

    setMessage("Log in or create an account to start reserving.");
  } catch (error) {
    setMessage("Could not reach auth service.", true);
  }
}

async function login(email, password) {
  setMessage("Logging in...");

  try {
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const payload = await parseResponseJsonSafe(response);
    if (!response.ok) {
      throw new Error(payload?.message || `Login failed (${response.status}).`);
    }

    setMessage("Login successful. Redirecting...");
    window.location.href = "index.html#listings";
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function logout() {
  setMessage("Logging out...");

  try {
    const response = await apiFetch("/api/auth/logout", { method: "POST" });
    const payload = await parseResponseJsonSafe(response);

    if (!response.ok) {
      throw new Error(payload?.message || `Logout failed (${response.status}).`);
    }

    setMessage("Logged out.");
  } catch (error) {
    setMessage(error.message, true);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const email = (formData.get("email") || "").toString().trim();
  const password = (formData.get("password") || "").toString();

  await login(email, password);
});

logoutBtn.addEventListener("click", async () => {
  await logout();
});

checkSession();
