// List recent analyses, or reopen one complete saved request/result by its ID.
export async function onRequestGet({request, env}) {
  if (!env.DB) return Response.json({error: "D1 is not configured."}, {status: 503});
  const id = new URL(request.url).searchParams.get("id");
  try {
    if (id) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({error: "Invalid analysis ID."}, {status: 400});
      const row = await env.DB.prepare("SELECT id,created_at,input_json,result_json FROM predictions WHERE id = ?").bind(id).first();
      if (!row) return Response.json({error: "Analysis not found."}, {status: 404});
      return Response.json({id: row.id, created_at: row.created_at, input: JSON.parse(row.input_json), ...JSON.parse(row.result_json)});
    }
    const {results} = await env.DB.prepare("SELECT id,created_at,apartment_id,label,score,threshold,is_anomaly,model_sha256,json_array_length(result_json,'$.twins') AS twin_count FROM predictions ORDER BY created_at DESC,id DESC LIMIT 20").all();
    return Response.json(results.map(row => ({...row, is_anomaly: Boolean(row.is_anomaly)})));
  } catch (error) {
    console.error("D1 read failed:", error.message);
    return Response.json({error: "History could not be read. Check the D1 binding and schema."}, {status: 503});
  }
}
