document.getElementById("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const password = document.getElementById("password");
  const button = document.getElementById("login-button");
  const message = document.getElementById("login-error");
  button.disabled = true; message.textContent = "";
  try {
    const response = await fetch("/api/login", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({password: password.value})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Login failed.");
    window.location.replace("/");
  } catch (error) { message.textContent = error.message; }
  finally { password.value = ""; button.disabled = false; }
});
