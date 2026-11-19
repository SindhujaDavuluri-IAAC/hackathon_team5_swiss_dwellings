import {sessionCookie, getToken, tokenHash} from "../_middleware.js";
export async function onRequestPost({request, env}) {
  const token = getToken(request);
  if (token && env.USERS_DB) await env.USERS_DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await tokenHash(token)).run();
  return Response.json({ok: true}, {headers: {"Set-Cookie": sessionCookie(request, "", true)}});
}
