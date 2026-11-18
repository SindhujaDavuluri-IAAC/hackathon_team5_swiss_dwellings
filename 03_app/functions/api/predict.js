import {FEATURES} from "../../public/data.js";
import {readJson} from "../_middleware.js";

// Validate raw measurements here too; the browser is not a trusted validator.
export function normalize(data) {
  if (!data || typeof data !== "object" || !data.features || Array.isArray(data.features)) throw new Error("Provide a features object.");
  const names = Object.keys(data.features);
  if (names.length !== FEATURES.length || names.some(name => !FEATURES.includes(name))) throw new Error("Exactly the 24 named apartment features are required.");
  for (const name of FEATURES) if (typeof data.features[name] !== "number" || !Number.isFinite(data.features[name])) throw new Error(`Provide a finite number for ${name}.`);
  if (data.features.apt_total_area <= 0 || data.features.apt_room_count < 2) throw new Error("Area must be positive and area-record count at least 2.");
  const output = {features: Object.fromEntries(FEATURES.map(name => [name, data.features[name]])), top_k: Object.hasOwn(data, "top_k") ? data.top_k : 3};
  if (!Number.isInteger(output.top_k) || output.top_k < 1 || output.top_k > 5) throw new Error("Request between 1 and 5 matches.");
  for (const name of ["improve_acoustics", "improve_sunlight", "improve_view"]) {
    output[name] = Object.hasOwn(data, name) ? data[name] : true;
    if (typeof output[name] !== "boolean") throw new Error(`${name} must be true or false.`);
  }
  for (const name of ["apartment_id", "label"]) {
    if (data[name] != null) {
      if (typeof data[name] !== "string" || data[name].length > 160) throw new Error(`Invalid ${name}.`);
      output[name] = data[name];
    }
  }
  return output;
}

// Keep the abort timer alive through both HTTP calls AND the response body.
export async function callModel(env, input) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let reader;
  try {
    const base = `${env.MODEL_URL.replace(/\/+$/, "")}/gradio_api/call/${env.MODEL_API_NAME || "predict"}`;
    const started = await fetch(base, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({data: [JSON.stringify(input)]}), signal: controller.signal});
    if (!started.ok) throw new Error(`Model returned HTTP ${started.status}.`);
    const {event_id} = await started.json();
    if (typeof event_id !== "string" || !/^[\w-]{1,128}$/.test(event_id)) throw new Error("Model returned an invalid job ticket.");
    const stream = await fetch(`${base}/${event_id}`, {signal: controller.signal});
    if (!stream.ok || !stream.body) throw new Error(`Model stream returned HTTP ${stream.status}.`);
    reader = stream.body.getReader();
    const decoder = new TextDecoder(); let buffer = ""; let bytes = 0;
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 1024 * 1024) throw new Error("Model response exceeded the expected size.");
      buffer += decoder.decode(value, {stream: true});
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = frame.split(/\r?\n/);
        const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        if (event === "error") throw new Error("The model could not complete this request.");
        if (event === "complete") {
          const outputs = JSON.parse(data);
          if (!Array.isArray(outputs) || !outputs[0]) throw new Error("Missing model output.");
          return outputs[0];
        }
      }
    }
    throw new Error("Model connection ended without a completed result.");
  } finally {
    clearTimeout(timer);
    if (reader) { try { await reader.cancel(); } catch {} }
  }
}
function validResult(result, expectedHash) {
  return result && typeof result.score === "number" && Number.isFinite(result.score) && result.score >= 0
    && Number.isFinite(result.threshold) && result.threshold > 0 && typeof result.is_anomaly === "boolean"
    && Number.isFinite(result.score_vs_threshold) && typeof result.model_sha256 === "string"
    && result.model_sha256 === expectedHash && Number.isInteger(result.matching_candidates)
    && result.matching_candidates >= 0 && Array.isArray(result.twins) && result.twins.length <= 5
    && FEATURES.every(name => Number.isFinite(result.per_feature_squared_error?.[name]) && result.per_feature_squared_error[name] >= 0)
    && result.twins.every(twin => typeof twin.apartment_id === "string" && Number.isFinite(twin.latent_distance)
      && FEATURES.every(name => Number.isFinite(twin.features?.[name])));
}
export async function onRequestPost({request, env}) {
  let input;
  try { input = normalize(await readJson(request)); }
  catch (error) { return Response.json({error: error.message}, {status: error.status || 400}); }
  if (!env.DB) return Response.json({error: "D1 is not configured. Follow the setup README."}, {status: 503});
  let result;
  try {
    result = await callModel(env, input);
    if (!validResult(result, env.EXPECTED_MODEL_SHA256)) throw new Error("The model response or model version does not match this application.");
  } catch (error) {
    console.error("Model request failed:", error.message);
    return Response.json({error: "The model did not complete the analysis. Render may be waking up; wait a minute and try again. If this persists, check the model server logs."}, {status: 503});
  }
  const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare("INSERT INTO predictions (id,created_at,apartment_id,label,input_json,score,threshold,is_anomaly,model_sha256,result_json) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id,createdAt,input.apartment_id || null,input.label || "Custom apartment",JSON.stringify(input),result.score,result.threshold,result.is_anomaly ? 1 : 0,result.model_sha256,JSON.stringify(result)).run();
  } catch (error) {
    console.error("D1 save failed:", error.message);
    return Response.json({error: "The model answered, but the result could not be saved. Check the D1 binding and run the schema setup before retrying."}, {status: 503});
  }
  return Response.json({id, created_at: createdAt, input, ...result});
}
