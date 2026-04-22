const signupForm = document.getElementById("signupPageForm");
const signupText = document.getElementById("signupPageText");
const logoutBtn = document.getElementById("logoutPageBtn");

function setMessage(message, isError = false) {
  signupText.textContent = message;
  signupText.style.color = isError ? "#9f1239" : "var(--muted)";
}

async function checkSession() {
  try {
    const response = await fetch("/api/auth/me");
    const payload = await response.json();

    if (response.ok && payload.authenticated) {
      setMessage(`Signed in as ${payload.user.name}. You can continue to booking.`);
      return;
    }

    setMessage("Create your account to start reserving.");
  } catch (error) {
    setMessage("Could not reach auth service.", true);
  }
}

async function signup(name, email, password) {
  setMessage("Creating account...");

  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Sign up failed.");
    }

    setMessage("Account created. Redirecting...");
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

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(signupForm);
  const name = (formData.get("name") || "").toString().trim();
  const email = (formData.get("email") || "").toString().trim();
  const password = (formData.get("password") || "").toString();

  await signup(name, email, password);
});

logoutBtn.addEventListener("click", async () => {
  await logout();
});

checkSession();
