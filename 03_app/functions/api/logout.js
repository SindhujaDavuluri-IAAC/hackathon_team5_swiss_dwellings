import {sessionCookie} from "../_middleware.js";
export function onRequestPost({request}) {
  return Response.json({ok: true}, {headers: {"Set-Cookie": sessionCookie(request, "", true)}});
}
