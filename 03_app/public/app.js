import {FEATURES, LABELS, EXAMPLES, GROUPS} from "./data.js";

const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = (value, digits=2) => Number(value).toFixed(digits);
const localTime = value => new Date(value).toLocaleString();
let current = null;
let activeMeta = {};
let revision = 0;
let pending = null;
let messages = [];
const goals = [["acoustics","improve_acoustics"],["sunlight","improve_sunlight"],["views","improve_view"]];
const questionLabels = {
  score:"What does my score mean?", flag:"Why was this apartment flagged?",
  twins:"How do the twins compare?", matches:"Why are there fewer matches?",
  measurements:"What do the measurements mean?", reliability:"How reliable is this result?"
};

function notice(text="", error=false) {
  $("notice").textContent = text; $("notice").hidden = !text;
  $("notice").classList.toggle("error", error);
}
function busy(value) {
  $("analyse").disabled = value;
  $("analyse").textContent = value ? "Analysing and saving..." : "Analyse profile & find twins";
  $("apartment-form").setAttribute("aria-busy", String(value));
}
function emptyView() {
  $("summary").innerHTML = '<div class="empty"><h2>Your apartment, at a glance</h2><p>Choose an apartment, set your priorities, then analyse its profile.</p></div>';
  $("errors").innerHTML = '<div class="empty"><h3>Understand the profile</h3><p>After analysis, the chart will show the measurements the model found unusual.</p></div>';
  $("twins").innerHTML = '<div class="empty"><h3>Discover comparable apartments</h3><p>Matching reference apartments will appear here.</p></div>';
  $("comparison").textContent = "Run an analysis to compare measurements.";
}
function resetChat() {
  messages = [{role:"assistant", text:current ? "Your analysis is ready. Choose a question to understand this apartment and its matching twins." : "Choose a question below. Analyse an apartment first for answers about its score and twins."}];
  drawChat();
}
function drawChat() {
  $("chat-log").replaceChildren(...messages.map(message => {
    const bubble = document.createElement("div"); bubble.className = `message ${message.role}`;
    bubble.textContent = message.text; return bubble;
  }));
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
}
function dirty() {
  revision += 1;
  pending?.abort(); pending = null; current = null;
  busy(false); emptyView(); resetChat(); notice();
}
async function api(path, options={}) {
  const response = await fetch(path, {credentials:"same-origin", ...options});
  if (response.status === 401) { window.location.assign("/login"); throw new Error("Your session expired. Please log in."); }
  let data;
  try { data = await response.json(); } catch { throw new Error(`The server returned HTTP ${response.status} without a JSON response.`); }
  if (!response.ok) throw new Error(data.error || `Request failed: HTTP ${response.status}.`);
  return data;
}

// Build the form from exactly the feature order expected by the saved model.
for (const [group,start,end] of GROUPS) {
  const fieldset = document.createElement("fieldset"); fieldset.className = "feature-group";
  const legend = document.createElement("legend"); legend.textContent = group; fieldset.append(legend);
  for (let i=start; i<end; i++) {
    const name = FEATURES[i]; const label = document.createElement("label");
    label.htmlFor = `feature-${name}`; label.textContent = LABELS[i];
    const input = document.createElement("input");
    input.id = `feature-${name}`; input.type = "number"; input.step = "any"; input.required = true;
    input.addEventListener("input", dirty);
    fieldset.append(label,input);
  }
  $("feature-fields").append(fieldset);
}
for (const [key,example] of Object.entries(EXAMPLES)) {
  const option = document.createElement("option"); option.value = key;
  option.textContent = `${key.startsWith("noisy") ? "Noisy example" : "Quiet-rule example"} ${key.split("_").at(-1)} | ${fmt(example.features.apt_total_area,0)} m2 | floor ${example.features.apt_floor_number}`;
  $("example").append(option);
}
const custom = document.createElement("option"); custom.value = "custom"; custom.textContent = "Custom measurements"; $("example").append(custom);
function fillFeatures(features) { for (const name of FEATURES) $(`feature-${name}`).value = features[name]; }
function loadExample(key) {
  dirty();
  if (key === "custom") { activeMeta = {label:"Custom apartment"}; return; }
  const example = EXAMPLES[key]; activeMeta = {apartment_id:example.apartment_id,label:example.label};
  fillFeatures(example.features);
}
$("example").value = Object.keys(EXAMPLES).find(key => key.startsWith("noisy")) || Object.keys(EXAMPLES)[0];
$("example").addEventListener("change", event => loadExample(event.target.value));
for (const [id] of goals) $(id).addEventListener("change", dirty);
$("top-k").addEventListener("input", () => { $("top-k-value").value = $("top-k").value; dirty(); });
// Explicit validation provides readable errors even inside collapsed details.
$("apartment-form").noValidate = true;
function getInput() {
  const features = {};
  for (let i=0; i<FEATURES.length; i++) {
    const name = FEATURES[i]; const field = $(`feature-${name}`);
    if (!field.value.trim() || !Number.isFinite(field.valueAsNumber)) {
      document.querySelector(".measurements").open = true; field.focus();
      throw new Error(`Provide a finite number for ${LABELS[i]}.`);
    }
    features[name] = field.valueAsNumber;
  }
  if (features.apt_total_area <= 0 || features.apt_room_count < 2) throw new Error("Area must be positive and area-record count at least 2.");
  return {...activeMeta,features,top_k:Number($("top-k").value),...Object.fromEntries(goals.map(([id,name])=>[name,$(id).checked]))};
}
$("apartment-form").addEventListener("submit", async event => {
  event.preventDefault();
  let input;
  try { input = getInput(); } catch (error) { notice(error.message,true); return; }
  dirty(); const requestRevision = revision;
  const controller = new AbortController(); pending = controller;
  busy(true); notice("Calling the model and saving your result. A sleeping Render service can take about a minute to wake.");
  try {
    const saved = await api("/api/predict", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),signal:controller.signal});
    if (requestRevision !== revision) return;
    render(saved); notice("Analysis saved. You can reopen it from Saved analyses.");
    await loadHistory();
  } catch (error) {
    if (requestRevision === revision && error.name !== "AbortError") notice(error.message,true);
  } finally { if (requestRevision === revision) { pending = null; busy(false); } }
});

function render(saved) {
  current = saved; const f = saved.input.features;
  $("summary").innerHTML = `<div class="panel"><div class="status-line"><div class="section-label">Apartment profile</div><span class="badge ${saved.is_anomaly ? "flagged" : ""}">${saved.is_anomaly ? "Flagged as unusual" : "Not flagged"}</span></div>
  <h2>${saved.is_anomaly ? "An unusual apartment profile" : "Within the model's learned range"}</h2><p class="small muted">The model compares 24 measurements with patterns learned from rule-normal apartments.</p>
  <div class="metric-grid"><div class="metric"><strong>${fmt(saved.score_vs_threshold)}x</strong><span>score / threshold</span></div><div class="metric"><strong>${fmt(saved.score,4)}</strong><span>reconstruction score</span></div><div class="metric"><strong>${fmt(saved.threshold,4)}</strong><span>decision threshold</span></div></div>
  <p class="small muted">A score above the threshold is flagged. This is not a probability or a noise rating. A non-flagged result does not certify quietness.</p><p class="saved-label">Saved ${esc(localTime(saved.created_at))} | reference ${esc(saved.id)}</p></div>`;
  const errors = saved.per_feature_squared_error;
  const total = Object.values(errors).reduce((a,b)=>a+b,0);
  const maximum = Math.max(...Object.values(errors)); const colors = {};
  const groups = GROUPS.map(([name,start,end,color]) => {
    for (const feature of FEATURES.slice(start,end)) colors[feature] = color;
    const share = 100 * FEATURES.slice(start,end).reduce((sum,key)=>sum+errors[key],0)/Math.max(total,1e-12);
    return `<div class="chart-row"><div class="chart-heading"><span>${name}</span><strong>${fmt(share,1)}%</strong></div><div class="track"><div class="fill" style="width:${share}%;background:${color}"></div></div></div>`;
  }).join("");
  const largest = Object.keys(errors).sort((a,b)=>errors[b]-errors[a]).slice(0,6).map(name => `<div class="feature-error"><span>${esc(LABELS[FEATURES.indexOf(name)])}</span><div class="track"><div class="fill" style="width:${100*errors[name]/Math.max(maximum,1e-12)}%;background:${colors[name]}"></div></div><strong>${fmt(errors[name],3)}</strong></div>`).join("");
  $("errors").innerHTML = `<div class="panel"><div class="section-label">What stands out?</div><h3>Reconstruction error by domain</h3><p class="small muted">Share of total squared error, not a measurement of harm.</p>${groups}<p class="chart-note">Largest feature mismatches below; bar lengths are relative to the largest error. Values are squared errors in standardized units.</p>${largest}</div>`;
  const comparisons = [["Indoor daytime traffic","noise_traffic_day_max",1," dBA"],["Window daytime traffic","window_traffic_day_max",1," dBA"],["Equinox noon sun","sun_equinox_noon_mean",2,""],["Sky view","view_sky_mean",4,""],["Greenery view","view_greenery_mean",4,""],["Area","apt_total_area",1," m2"],["Area records","apt_room_count",0,""]];
  const cards = saved.twins.map((twin,i) => `<article class="twin-card"><div class="twin-title"><h3>Match ${String(i+1).padStart(2,"0")}</h3><span>distance ${fmt(twin.latent_distance)}</span></div>${comparisons.map(([label,name,digits,unit])=>`<div class="compare"><span class="muted">${label}</span><span class="value">${fmt(twin.features[name],digits)}${unit}<small>your apartment: ${fmt(f[name],digits)}${unit}</small></span></div>`).join("")}<details class="reference"><summary>Apartment reference</summary>${esc(twin.apartment_id)}<br>Site ${esc(twin.site_id)} | building ${esc(twin.building_id)}</details></article>`).join("");
  $("twins").innerHTML = saved.twins.length ? `<div class="section-label">Your alternatives</div><h2>${saved.twins.length} matching apartments</h2><p class="small muted">${saved.matching_candidates} candidates pass your filters. Smaller latent distance means a closer learned fingerprint.</p><div class="twin-grid">${cards}</div>` : '<div class="empty"><h2>No apartments meet all selected goals</h2><p>Try turning off one improvement goal. We do not silently relax filters.</p></div>';
  $("comparison").innerHTML = `<table><thead><tr><th>Apartment</th>${comparisons.map(([label])=>`<th>${label}</th>`).join("")}<th>Distance</th></tr></thead><tbody><tr><th>Your apartment</th>${comparisons.map(([,name,digits])=>`<td>${fmt(f[name],digits)}</td>`).join("")}<td>--</td></tr>${saved.twins.map((twin,i)=>`<tr><th>Match ${i+1}</th>${comparisons.map(([,name,digits])=>`<td>${fmt(twin.features[name],digits)}</td>`).join("")}<td>${fmt(twin.latent_distance)}</td></tr>`).join("")}</tbody></table>`;
  resetChat();
}

async function loadHistory() {
  $("history-status").textContent = "Loading saved analyses...";
  try {
    const rows = await api("/api/history");
    $("history-status").textContent = rows.length ? `${rows.length} recent analyses. Shared by everyone with this workspace password.` : "No saved analyses yet.";
    $("history").innerHTML = rows.map(row=>`<button type="button" class="history-entry" data-history="${esc(row.id)}"><span><strong>${esc(row.label || "Apartment")}</strong><small>${esc(row.apartment_id || "Custom measurements")}</small></span><span>Score ${fmt(row.score,4)}<small>${row.is_anomaly ? "Flagged as unusual" : "Not flagged"} | ${row.twin_count} twins</small></span><time>${esc(localTime(row.created_at))}</time></button>`).join("");
  } catch (error) { $("history-status").textContent = error.message; }
}
$("refresh-history").addEventListener("click",loadHistory);
$("history").addEventListener("click",async event=>{
  const button = event.target.closest("[data-history]"); if (!button) return;
  dirty(); const requestRevision = revision; button.disabled = true;
  try {
    const saved = await api(`/api/history?id=${encodeURIComponent(button.dataset.history)}`);
    if (requestRevision !== revision) return;
    activeMeta = {apartment_id:saved.input.apartment_id,label:saved.input.label};
    $("example").value = Object.keys(EXAMPLES).find(key=>EXAMPLES[key].apartment_id===saved.input.apartment_id) || "custom";
    fillFeatures(saved.input.features);
    for (const [id,name] of goals) $(id).checked = saved.input[name];
    $("top-k").value = saved.input.top_k; $("top-k-value").value = saved.input.top_k;
    render(saved); notice("Reopened a saved analysis. No new model call was made.");
    $("summary").scrollIntoView({behavior:"smooth",block:"start"});
  } catch (error) { notice(error.message,true); }
  finally { button.disabled = false; }
});
$("logout").addEventListener("click",async ()=>{
  try { await api("/api/logout",{method:"POST"}); window.location.replace("/login"); }
  catch (error) { notice(error.message,true); }
});

// This helper is deterministic and uses the currently displayed saved result.
function explain(key) {
  if (key === "measurements") return "Noise values are simulated indoor/window exposure in dBA. The maximum is the worst room/area value; the mean is an arithmetic room average. Sun values are simulations at specific seasons/times, not direct daylight-factor measurements. Views describe sky, greenery and other visibility measures. Layout includes area, floor, window perimeter and centrality. Area records include ancillary spaces; they are not an official bedroom count.";
  if (key === "reliability") return "This is an experimental comparison tool. Labels come from noise percentile rules rather than independent comfort assessments or legal limits. The evaluation has building-overlap and label-cutoff limitations. Geometry or views can also cause a high score, and a non-flagged result does not certify quietness. The references are historical examples, not live listings.";
  if (!current) return "Please click Analyse profile & find twins first, or reopen a saved analysis. I will then explain that result and its actual matching apartments.";
  const f = current.input.features;
  if (key === "score") return `Your reconstruction score is ${fmt(current.score,6)}, compared with threshold ${fmt(current.threshold,6)} (${fmt(current.score_vs_threshold)} times the threshold). It is ${current.is_anomaly ? "above the threshold and flagged as unusual" : "at or below the threshold and not flagged"}. This is the mean squared difference between the 24 standardized inputs and their reconstructions, not a probability or dBA reading.`;
  if (key === "flag") {
    const errors = current.per_feature_squared_error;
    const total = Object.values(errors).reduce((a,b)=>a+b,0);
    const share = 100*FEATURES.slice(0,8).reduce((a,name)=>a+errors[name],0)/Math.max(total,1e-12);
    return `${current.is_anomaly ? "It was flagged because its score exceeds the saved threshold." : "This apartment was NOT flagged: its score does not exceed the threshold."}\n\nLargest reconstruction mismatches:\n${Object.keys(errors).sort((a,b)=>errors[b]-errors[a]).slice(0,3).map(name=>`${LABELS[FEATURES.indexOf(name)]}: ${fmt(errors[name],4)}`).join("\n")}\n\nAcoustic features contribute ${fmt(share,1)}% of total squared error. This explains reconstruction mismatches, not physical causes or harmful exposure.`;
  }
  if (key === "twins") {
    if (!current.twins.length) return "There are no twins to compare for this analysis. Try turning off one improvement goal and analyse again. Area/count constraints stay in place.";
    return current.twins.map((twin,i)=>{
      const t=twin.features; const delta=f.noise_traffic_day_max-t.noise_traffic_day_max;
      return `Match ${i+1}: indoor daytime traffic ${fmt(t.noise_traffic_day_max)} dBA (${fmt(Math.abs(delta))} dBA ${delta>0 ? "lower" : delta<0 ? "higher" : "equal"} than your apartment); window daytime traffic ${fmt(t.window_traffic_day_max)} dBA (yours: ${fmt(f.window_traffic_day_max)}); equinox-noon sun ${fmt(t.sun_equinox_noon_mean)} (yours: ${fmt(f.sun_equinox_noon_mean)}); area ${fmt(t.apt_total_area,1)} m2 (yours: ${fmt(f.apt_total_area,1)}).`;
    }).join("\n\n")+"\n\nOnly your selected goals are enforced. Acoustic improvement checks daytime traffic, not all train/nighttime noise. Smaller latent distance means a closer learned fingerprint, not automatically a better home.";
  }
  if (key === "matches") {
    const requested=current.input.top_k; const found=current.twins.length;
    return `You requested ${requested} matches and received ${found}. ${current.matching_candidates} candidates passed all filters; at most your requested number is shown. Candidates have normal noise-rule labels, area within +/-25%, area-record count within +/-2, and pass your selected improvement goals. The query is excluded. Turning off a goal can broaden the pool; increasing the requested count cannot create eligible apartments. We never silently relax filters.`;
  }
  return "Choose one of the question buttons.";
}
for (const [key,label] of Object.entries(questionLabels)) {
  const button=document.createElement("button");button.type="button";button.className="secondary";button.textContent=label;
  button.addEventListener("click",()=>{
    messages=[...messages.slice(-12),{role:"user",text:label},{role:"assistant",text:explain(key)}];drawChat();
  });
  $("question-buttons").append(button);
}
$("clear-chat").addEventListener("click",resetChat);
loadExample($("example").value);
loadHistory();
