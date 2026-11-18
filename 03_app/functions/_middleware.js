// Run before static pages and API routes. The model itself stays on Render.
const COOKIE = "swiss_session";
const DAY = 86400;
const PUBLIC = new Set(["/login", "/login.html", "/login.js", "/style.css", "/api/login"]);
const encoder = new TextEncoder();

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("Invalid token");
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
async function signingKey(password) {
  return crypto.subtle.importKey("raw", encoder.encode(password), {name: "HMAC", hash: "SHA-256"}, false, ["sign", "verify"]);
}
export async function issueSession(password) {
  const payload = encode(encoder.encode(JSON.stringify({exp: Math.floor(Date.now()/1000) + DAY, nonce: crypto.randomUUID()})));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(password), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function validSession(token, password) {
  if (!password || !token || token.length > 1024) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    if (!await crypto.subtle.verify("HMAC", await signingKey(password), decode(parts[1]), encoder.encode(parts[0]))) return false;
    const data = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    return Number.isInteger(data.exp) && data.exp > Math.floor(Date.now()/1000);
  } catch { return false; }
}
export function sessionCookie(request, token, clear = false) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : DAY}${secure}`;
}
// Bound JSON requests while reading, rather than buffering an arbitrary upload.
export async function readJson(request, maximum = 32768) {
  if (!request.headers.get("Content-Type")?.includes("application/json"))
    throw Object.assign(new Error("Send application/json."), {status: 415});
  if (!request.body) throw Object.assign(new Error("Missing request body."), {status: 400});
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw Object.assign(new Error("Request is too large."), {status: 413}); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error("Invalid JSON."), {status: 400}); }
}
export async function onRequest(context) {
  const {request, env, next} = context;
  const url = new URL(request.url);
  // Cookies and same-origin requests protect the write endpoints from cross-site forms.
  const origin = request.headers.get("Origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin && origin !== url.origin)
    return Response.json({error: "Cross-origin request refused."}, {status: 403});
  let response;
  if (!PUBLIC.has(url.pathname)) {
    const token = request.headers.get("Cookie")?.match(/(?:^|;\s*)swiss_session=([^;]+)/)?.[1];
    if (!await validSession(token, env.APP_PASSWORD)) {
      response = url.pathname.startsWith("/api/")
        ? Response.json({error: "Please log in."}, {status: 401})
        : Response.redirect(new URL("/login", url), 302);
    }
  }
  response ||= await next();
  // Prevent protected pages/results from being cached after logout.
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}
