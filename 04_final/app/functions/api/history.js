// Saved evaluations are private to the team and unavailable through the website.
export function onRequest() {
  return Response.json({error: "Not found."}, {status: 404});
}
