import {issueSession, sessionCookie, readJson} from "../_middleware.js";
export async function onRequestPost({request, env}) {
  if (!env.APP_PASSWORD) return Response.json({error: "APP_PASSWORD is not configured. Follow the setup README."}, {status: 503});
  let data;
  try { data = await readJson(request, 4096); }
  catch (error) { return Response.json({error: error.message}, {status: error.status || 400}); }
  if (!data || typeof data.password !== "string" || data.password !== env.APP_PASSWORD)
    return Response.json({error: "Incorrect password."}, {status: 401});
  return Response.json({ok: true}, {headers: {"Set-Cookie": sessionCookie(request, await issueSession(env.APP_PASSWORD))}});
}
