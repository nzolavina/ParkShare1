const loginForm = document.getElementById("loginPageForm");
const loginText = document.getElementById("loginPageText");
const logoutBtn = document.getElementById("logoutPageBtn");

function setMessage(message, isError = false) {
  loginText.textContent = message;
  loginText.style.color = isError ? "#9f1239" : "var(--muted)";
}

async function checkSession() {
  try {
    const response = await fetch("/api/auth/me");
    const payload = await response.json();

    if (response.ok && payload.authenticated) {
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
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Login failed.");
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
    const response = await fetch("/api/auth/logout", { method: "POST" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "Logout failed.");
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
