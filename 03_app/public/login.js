let registering = false;
const form = document.getElementById("login-form");
const password = document.getElementById("password");
const button = document.getElementById("login-button");
const message = document.getElementById("login-error");
document.getElementById("toggle-auth").addEventListener("click", event => {
  registering = !registering;
  document.getElementById("auth-title").textContent = registering ? "Create your account." : "Welcome back.";
  document.getElementById("auth-copy").textContent = registering ? "Sign up to explore apartment profiles and compare twins." : "Log in to explore apartment profiles and compare twins.";
  button.textContent = registering ? "Sign up" : "Log in";
  event.currentTarget.textContent = registering ? "Log in instead" : "Create an account";
  password.autocomplete = registering ? "new-password" : "current-password";
  document.getElementById("password-rules").hidden = !registering;
  message.textContent = "";
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (registering && (password.value.length < 8 || !/[a-z]/.test(password.value) || !/[A-Z]/.test(password.value) ||
      !/[0-9]/.test(password.value) || !/[^a-zA-Z0-9\s]/.test(password.value))) {
    message.textContent = "Use at least 8 characters, including an uppercase letter, a lowercase letter, a number and a special character.";
    return;
  }
  button.disabled = true; message.textContent = "";
  try {
    const response = await fetch(registering ? "/api/register" : "/api/login", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({email: document.getElementById("email").value, password: password.value})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to continue.");
    window.location.replace("/");
  } catch (error) { message.textContent = error.message; }
  finally { password.value = ""; button.disabled = false; }
});
