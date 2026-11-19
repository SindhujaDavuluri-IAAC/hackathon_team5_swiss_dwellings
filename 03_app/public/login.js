let registering = false;
let teamMode = false;
const form = document.getElementById("login-form");
const password = document.getElementById("password");
const button = document.getElementById("login-button");
const message = document.getElementById("login-error");
document.getElementById("toggle-auth").addEventListener("click", event => {
  registering = teamMode ? true : !registering;
  teamMode = false;
  document.getElementById("email-fields").hidden = false;
  document.getElementById("email").disabled = false;
  document.getElementById("password-label").textContent = "Password";
  document.getElementById("toggle-team").textContent = "Team access";
  document.getElementById("auth-title").textContent = registering ? "Create your account." : "Welcome back.";
  document.getElementById("auth-copy").textContent = registering ? "Sign up to explore apartment profiles and compare twins." : "Log in to explore apartment profiles and compare twins.";
  button.textContent = registering ? "Sign up" : "Log in";
  event.currentTarget.textContent = registering ? "Log in instead" : "Create an account";
  password.autocomplete = registering ? "new-password" : "current-password";
  document.getElementById("password-rules").hidden = !registering;
  message.textContent = "";
});
document.getElementById("toggle-team").addEventListener("click", event => {
  teamMode = !teamMode;
  registering = false;
  document.getElementById("email-fields").hidden = teamMode;
  document.getElementById("email").disabled = teamMode;
  document.getElementById("password-label").textContent = teamMode ? "Team password" : "Password";
  document.getElementById("auth-title").textContent = teamMode ? "Team access." : "Welcome back.";
  document.getElementById("auth-copy").textContent = teamMode ? "Enter the team password to access the website." : "Log in to explore apartment profiles and compare twins.";
  button.textContent = teamMode ? "Enter website" : "Log in";
  event.currentTarget.textContent = teamMode ? "Account login" : "Team access";
  document.getElementById("toggle-auth").textContent = "Create an account";
  document.getElementById("password-rules").hidden = true;
  password.autocomplete = teamMode ? "off" : "current-password";
  password.value = "";
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
    const response = await fetch(teamMode ? "/api/team-login" : registering ? "/api/register" : "/api/login", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(teamMode ? {password: password.value} : {email: document.getElementById("email").value, password: password.value})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to continue.");
    window.location.replace("/");
  } catch (error) { message.textContent = error.message; }
  finally { password.value = ""; button.disabled = false; }
});
