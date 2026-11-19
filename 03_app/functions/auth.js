import {readJson, issueSession, sessionCookie, tokenHash} from "./_middleware.js";

const encoder = new TextEncoder();
const ITERATIONS = 100000;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: ITERATIONS}, key, 256);
  return hex(new Uint8Array(bits));
}

export async function teamLogin({request, env}) {
  if (!env.USERS_DB || !env.APP_PASSWORD) return Response.json({error: "Team access is unavailable."}, {status: 503});
  let data;
  try { data = await readJson(request, 4096); }
  catch (e) { return Response.json({error: e.message}, {status: e.status || 400}); }
  const db = env.USERS_DB;
  const now = Math.floor(Date.now() / 1000);
  const key = await tokenHash("ip:" + (request.headers.get("CF-Connecting-IP") || "unknown"));
  const attempt = await db.prepare(
    "INSERT INTO auth_attempts (key,count,window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END, window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END RETURNING count"
  ).bind(key, now, now - 900, now - 900).first();
  if (attempt.count > 10) return Response.json({error: "Too many attempts. Try again later."}, {status: 429});
  if (typeof data?.password !== "string" || !data.password || data.password.length > 256)
    return Response.json({error: "Incorrect team password."}, {status: 401});
  const expectedKey = await crypto.subtle.importKey("raw", encoder.encode(env.APP_PASSWORD), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", expectedKey, encoder.encode("team-access"));
  const enteredKey = await crypto.subtle.importKey("raw", encoder.encode(data.password), {name:"HMAC", hash:"SHA-256"}, false, ["verify"]);
  if (!await crypto.subtle.verify("HMAC", enteredKey, signature, encoder.encode("team-access")))
    return Response.json({error: "Incorrect team password."}, {status: 401});
  // One reserved, non-login identity satisfies the session table's foreign key;
  // no individual team member account or email is created.
  await db.prepare("INSERT OR IGNORE INTO users (id,email,password_salt,password_hash,created_at) VALUES (?, ?, ?, ?, ?)")
    .bind("team-access", "team-access", "", "", now).run();
  return Response.json({ok: true}, {headers: {"Set-Cookie": sessionCookie(request, await issueSession(db, "team-access"))}});
}

export async function authenticate({request, env}, register) {
  if (!env.USERS_DB) return Response.json({error: "Account service unavailable."}, {status: 503});
  let data;
  try { data = await readJson(request, 4096); }
  catch (e) { return Response.json({error: e.message}, {status: e.status || 400}); }
  const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
  const password = data?.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" || password.length < 1 || password.length > 128) {
    return Response.json({error: "Enter a valid email and password."}, {status: 400});
  }
  if (register && (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) ||
      !/[0-9]/.test(password) || !/[^a-zA-Z0-9\s]/.test(password))) {
    return Response.json({error: "Password must have at least 8 characters, including an uppercase letter, a lowercase letter, a number and a special character."}, {status: 400});
  }
  const db = env.USERS_DB;
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await tokenHash("ip:" + ip);
  // A fixed 15-minute per-IP window limits both login and registration attempts.
  const attempt = await db.prepare(
    "INSERT INTO auth_attempts (key,count,window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END, window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END RETURNING count"
  ).bind(key, now, now - 900, now - 900).first();
  if (attempt.count > 10) return Response.json({error: "Too many attempts. Try again later."}, {status: 429});
  const user = await db.prepare("SELECT id, password_salt, password_hash FROM users WHERE email = ?").bind(email).first();
  if (register) {
    if (user) return Response.json({error: "An account with this email already exists. Please log in."}, {status: 409});
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(password, salt);
    const id = crypto.randomUUID();
    try {
      await db.prepare("INSERT INTO users (id,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?)").bind(id,email,salt,hash,now).run();
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) return Response.json({error: "An account with this email already exists. Please log in."}, {status: 409});
      throw error;
    }
    return Response.json({ok: true}, {headers: {"Set-Cookie": sessionCookie(request, await issueSession(db, id))}});
  }
  // Always derive a hash, including for unknown emails.
  const actual = await passwordHash(password, user?.password_salt || "00000000000000000000000000000000");
  const expected = user?.password_hash || "0".repeat(64);
  const encKey = await crypto.subtle.importKey("raw", encoder.encode(expected), {name:"HMAC", hash:"SHA-256"}, false, ["sign","verify"]);
  const signature = await crypto.subtle.sign("HMAC", encKey, encoder.encode("password-check"));
  const matches = await crypto.subtle.verify("HMAC", await crypto.subtle.importKey("raw", encoder.encode(actual), {name:"HMAC", hash:"SHA-256"}, false, ["verify"]), signature, encoder.encode("password-check"));
  if (!user || !matches) return Response.json({error: "Incorrect email or password."}, {status: 401});
  return Response.json({ok: true}, {headers: {"Set-Cookie": sessionCookie(request, await issueSession(db, user.id))}});
}

