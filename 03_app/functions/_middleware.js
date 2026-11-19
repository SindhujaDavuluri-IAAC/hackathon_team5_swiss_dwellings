// Run before static pages and API routes. The model itself stays on Render.
const COOKIE = "swiss_session";
const DAY = 86400;
const PUBLIC = new Set(["/login", "/login.html", "/login.js", "/style.css", "/api/login", "/api/register", "/api/team-login"]);
export async function tokenHash(token) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export function getToken(request) {
  return request.headers.get("Cookie")?.match(/(?:^|;\s*)swiss_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}
export async function issueSession(db, userId) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await tokenHash(token), userId, now + DAY).run();
  return token;
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
    const token = getToken(request);
    let session = null;
    if (token && env.USERS_DB) {
      session = await env.USERS_DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?").bind(await tokenHash(token), Math.floor(Date.now()/1000)).first();
    }
    if (!session) {
      response = url.pathname.startsWith("/api/")
        ? Response.json({error: "Please log in."}, {status: 401})
        : Response.redirect(new URL("/login", url), 302);
    } else context.data.userId = session.user_id;
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
