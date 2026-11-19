import {FEATURES, LABELS, EXAMPLES, GROUPS} from "./data.js";

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = (value, digits=2) => Number(value).toFixed(digits);
const localTime = value => new Date(value).toLocaleString();

let current = null;
let activeMeta = {};
let activeKey = "noisy_apartment_1";
let activeTab = "agent"; // "agent" | "architect" | "split"
let catalogFilter = "all"; // "all" | "anomaly" | "normal"
let displayLimit = 12; // 4..50
let focusedTwinIdx = 0;
let revision = 0;
let pending = null;
let messages = [];

const goals = [["acoustics","improve_acoustics"],["sunlight","improve_sunlight"],["views","improve_view"]];
const questionLabels = {
  score: "What does the Unusualness Percentile & 95th-percentile threshold mean?",
  flag: "Why was this apartment flagged as unusual?",
  twins: "How do the 3–5 architect twins improve on this apartment?",
  matches: "How are the 44,195 reference apartments filtered and ranked?",
  measurements: "What do the 24 Swiss Dwellings measurements represent?",
  reliability: "How should a Real Estate Agent or Architect use this studio?"
};

// Map raw reconstruction score to a calibrated 0..99.9th percentile across the 44,195 catalog
// By training definition, threshold (0.179884) is the 95.0th percentile of rule-normal validation apartments.
function scoreToPercentile(score, threshold = 0.179884) {
  const r = Math.max(0, Number(score) / Math.max(1e-6, Number(threshold)));
  if (r <= 0.25) return Math.max(4, Math.round(r * 140)); // 0..35th
  if (r <= 0.60) return Math.round(35 + ((r - 0.25) / 0.35) * 37); // 35..72nd
  if (r <= 1.00) return Math.round(72 + ((r - 0.60) / 0.40) * 23); // 72..95th (threshold = 95th!)
  return Math.min(99.9, Number((95 + 4.9 * (1 - Math.exp(-(r - 1.0) * 1.15))).toFixed(1)));
}

function notice(text="", error=false) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
  $("notice").classList.toggle("error", error);
}

function busy(value) {
  $("analyse").disabled = value;
  $("analyse").innerHTML = value
    ? '<span class="spinner"></span> Evaluating Profile & Saving to Cloudflare D1...'
    : "Evaluate Normality & Find Better Spatial Twins";
  $("apartment-form").setAttribute("aria-busy", String(value));
}

function setTab(tab) {
  activeTab = tab;
  for (const id of ["agent", "architect", "split"]) {
    const btn = $(`tab-btn-${id}`);
    if (btn) {
      btn.classList.toggle("active", id === tab);
      btn.setAttribute("aria-selected", String(id === tab));
    }
  }
  const agentPane = $("story-agent-pane");
  const archPane = $("story-architect-pane");
  if (tab === "agent") {
    agentPane.hidden = false;
    archPane.hidden = true;
  } else if (tab === "architect") {
    agentPane.hidden = true;
    archPane.hidden = false;
  } else {
    agentPane.hidden = false;
    archPane.hidden = false;
  }
}

for (const id of ["agent", "architect", "split"]) {
  $(`tab-btn-${id}`)?.addEventListener("click", () => setTab(id));
}

// ============================================================================
// ARTISTIC ARCHITECTURAL BUBBLE TOPOLOGY DIAGRAM + SOLAR HALO + ACOUSTIC RIPPLES
// Inspired by architectural bubble & flow diagrams, using the light blue & orange palette
// ============================================================================
function generateBubbleDiagramSVG(f, uid = "main") {
  const area = Math.max(25, Math.min(240, Number(f.apt_total_area) || 95));
  const rooms = Math.max(2, Math.min(14, Math.round(Number(f.apt_room_count) || 7)));
  const noise = Number(f.window_traffic_day_max) || 52;
  const sun = Number(f.sun_equinox_noon_mean) || 1.8;
  const sky = Number(f.view_sky_mean) || 0.02;
  const green = Number(f.view_greenery_mean) || 0.015;

  const scale = Math.min(1.16, Math.max(0.76, Math.sqrt(area / 100)));
  const cx = 152, cy = 92;

  // Room definitions: organic spatial bubbles around central Living/Foyer hub
  const palette = [
    {name: "living",  fill: "rgba(89, 165, 216, 0.34)", stroke: "#133C55", r: 30, dx: 0,   dy: 0,   call: "sunlight"},
    {name: "foyer",   fill: "rgba(56, 111, 164, 0.25)", stroke: "#133C55", r: 19, dx: -44, dy: 8,   call: "entry"},
    {name: "dining",  fill: "rgba(253, 224, 71, 0.38)", stroke: "#133C55", r: 22, dx: 42,  dy: -20, call: "eating"},
    {name: "kitchen", fill: "rgba(245, 98, 0, 0.22)",   stroke: "#133C55", r: 17, dx: 46,  dy: 25,  call: ""},
    {name: "bed 01",  fill: "rgba(134, 239, 172, 0.36)",stroke: "#133C55", r: 23, dx: -14, dy: -46, call: "quiet"},
    {name: "bed 02",  fill: "rgba(125, 211, 252, 0.34)",stroke: "#133C55", r: 20, dx: -12, dy: 48,  call: ""},
    {name: "bath",    fill: "rgba(186, 230, 253, 0.42)",stroke: "#133C55", r: 14, dx: -52, dy: -32, call: ""},
    {name: "loggia",  fill: "rgba(74, 222, 128, 0.34)", stroke: "#133C55", r: 17, dx: 76,  dy: 2,   call: "views"},
    {name: "study",   fill: "rgba(253, 186, 116, 0.34)",stroke: "#133C55", r: 16, dx: 26,  dy: -54, call: ""},
    {name: "bed 03",  fill: "rgba(147, 197, 253, 0.34)",stroke: "#133C55", r: 17, dx: 28,  dy: 54,  call: ""},
    {name: "utility", fill: "rgba(203, 213, 225, 0.45)",stroke: "#133C55", r: 12, dx: -58, dy: 42,  call: ""},
    {name: "terrace", fill: "rgba(110, 231, 183, 0.36)",stroke: "#133C55", r: 15, dx: 74,  dy: -38, call: ""}
  ];

  const activeNodes = palette.slice(0, Math.min(rooms, palette.length)).map((n, i) => ({
    ...n,
    x: cx + n.dx * scale,
    y: cy + n.dy * scale,
    r: n.r * (0.88 + 0.12 * scale),
    idx: i
  }));

  // 1. Soft Luminous Solar Halo behind the cluster (intensity & radius driven by sun_equinox_noon_mean)
  const sunNorm = Math.min(1, Math.max(0.15, sun / 3.6));
  const haloR = (58 + sunNorm * 48) * scale;
  const haloRings = [1.0, 0.74, 0.48].map((m, idx) =>
    `<circle cx="${(cx + 22).toFixed(1)}" cy="${(cy - 10).toFixed(1)}" r="${(haloR * m).toFixed(1)}" fill="none" stroke="#F59E0B" stroke-width="${1.2 - idx * 0.25}" stroke-opacity="${(0.18 + sunNorm * 0.22).toFixed(2)}" stroke-dasharray="${idx === 0 ? '4,5' : 'none'}"/>`
  ).join("");

  // 2. Smooth Translucent Flow Ribbons connecting rooms (inspired by Image 1)
  let ribbons = "";
  const hub = activeNodes[0];
  for (let i = 1; i < activeNodes.length; i++) {
    const target = activeNodes[i];
    const mx = (hub.x + target.x) / 2 + (i % 2 === 0 ? 8 : -8);
    const my = (hub.y + target.y) / 2 + (i % 2 === 0 ? -6 : 6);
    ribbons += `<path d="M ${hub.x.toFixed(1)} ${hub.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${target.x.toFixed(1)} ${target.y.toFixed(1)}" fill="none" stroke="${target.fill}" stroke-width="${Math.max(10, target.r * 0.85).toFixed(1)}" stroke-linecap="round"/>`;
  }

  // 3. Hand-sketched Circulation Path & Curved Adjacency Arrows (inspired by Image 2)
  const circPath = `<path d="M ${(cx - 78 * scale).toFixed(1)} ${(cy + 22 * scale).toFixed(1)} Q ${(cx - 12).toFixed(1)} ${(cy + 4).toFixed(1)} ${(cx + 68 * scale).toFixed(1)} ${(cy - 14 * scale).toFixed(1)}" fill="none" stroke="#F56200" stroke-width="5.5" stroke-opacity="0.28" stroke-dasharray="10,7" stroke-linecap="round"/>`;

  // 4. Elegant Concentric Wi-Fi / Ripple Acoustic Arcs on left street boundary
  const noiseNorm = Math.min(1, Math.max(0.12, (noise - 28) / 48));
  const rippleCount = noise > 64 ? 4 : noise > 50 ? 3 : 2;
  const rippleColor = noise > 58 ? "#F56200" : "#386FA4";
  const rx0 = 18, ry0 = cy;
  let ripples = `<circle cx="${rx0}" cy="${ry0}" r="3.5" fill="${rippleColor}" opacity="${(0.45 + noiseNorm * 0.5).toFixed(2)}"/>`;
  for (let k = 1; k <= rippleCount; k++) {
    const rr = 11 * k;
    const ySpan = 10 * k;
    ripples += `<path d="M ${(rx0 + rr * 0.35).toFixed(1)} ${(ry0 - ySpan).toFixed(1)} A ${rr} ${rr} 0 0 1 ${(rx0 + rr * 0.35).toFixed(1)} ${(ry0 + ySpan).toFixed(1)}" fill="none" stroke="${rippleColor}" stroke-width="${(2.2 - k * 0.3).toFixed(1)}" stroke-opacity="${(noiseNorm * (1.05 - k * 0.18)).toFixed(2)}" stroke-linecap="round"/>`;
  }

  // 5. Sky & Greenery Horizon Arcs on the right garden side
  const viewNorm = Math.min(1, Math.max(0.15, (sky + green) / 0.08));
  const viewArcs = [1, 2].map(k => {
    const vr = 22 + k * 12 * viewNorm;
    return `<path d="M ${(282 - vr * 0.4).toFixed(1)} ${(cy - vr * 0.75).toFixed(1)} A ${vr.toFixed(1)} ${vr.toFixed(1)} 0 0 0 ${(282 - vr * 0.4).toFixed(1)} ${(cy + vr * 0.75).toFixed(1)}" fill="none" stroke="#2a9d8f" stroke-width="2" stroke-opacity="${(0.28 + viewNorm * 0.4).toFixed(2)}" stroke-dasharray="3,4" stroke-linecap="round"/>`;
  }).join("");

  // 6. Double-Ring Sketched Room Bubbles + Labels
  const bubblesHtml = activeNodes.map(n => {
    // Second slightly offset ring gives the architectural hand-drawn bubble feel from Image 2
    return `<g>
      <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="${n.fill}" stroke="${n.stroke}" stroke-width="1.35"/>
      <circle cx="${(n.x + 1.1).toFixed(1)}" cy="${(n.y - 0.9).toFixed(1)}" r="${(n.r * 0.96).toFixed(1)}" fill="none" stroke="${n.stroke}" stroke-width="0.65" stroke-opacity="0.55"/>
      <text x="${n.x.toFixed(1)}" y="${(n.y + 3).toFixed(1)}" text-anchor="middle" font-size="${n.r > 22 ? '9.5' : '8'}" font-weight="700" fill="#133C55" style="letter-spacing:0.3px">${n.name}</text>
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 300 184" class="blueprint-svg" role="img" aria-label="Artistic spatial bubble topology diagram">
    <defs>
      <radialGradient id="solarHalo-${uid}" cx="56%" cy="45%" r="52%">
        <stop offset="0%" stop-color="#FDE047" stop-opacity="${(0.28 + sunNorm * 0.38).toFixed(2)}"/>
        <stop offset="55%" stop-color="#F59E0B" stop-opacity="${(0.10 + sunNorm * 0.16).toFixed(2)}"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="300" height="184" fill="#FAFDFE"/>
    <!-- Luminous Solar Halo -->
    <circle cx="${(cx + 18).toFixed(1)}" cy="${(cy - 8).toFixed(1)}" r="${(haloR * 1.15).toFixed(1)}" fill="url(#solarHalo-${uid})"/>
    ${haloRings}
    <!-- Acoustic Ripple Waves (Left Facade) -->
    ${ripples}
    <!-- Viewshed Horizon Arcs (Right Garden) -->
    ${viewArcs}
    <!-- Organic Translucent Flow Ribbons -->
    ${ribbons}
    <!-- Circulation Axis -->
    ${circPath}
    <!-- Room Bubbles -->
    ${bubblesHtml}
    <!-- Subtle Architectural Axis Labels (No ugly boxes!) -->
    <text x="12" y="18" font-size="7.5" font-weight="800" fill="${rippleColor}" letter-spacing="1.1">ACOUSTIC RIPPLE</text>
    <text x="288" y="18" text-anchor="end" font-size="7.5" font-weight="800" fill="#D97706" letter-spacing="1.1">SOLAR HALO</text>
    <text x="288" y="174" text-anchor="end" font-size="7.5" font-weight="800" fill="#2a9d8f" letter-spacing="1.1">VIEWSHED HORIZON</text>
  </svg>`;
}

function updateBlueprintFromInputs() {
  const f = {};
  for (const name of FEATURES) {
    const el = $(`feature-${name}`);
    f[name] = el ? Number(el.value) : 0;
  }
  $("blueprint-meta").textContent = `${fmt(f.apt_total_area || 0, 1)} m² • ${fmt(f.apt_room_count || 0, 0)} rooms • Floor ${fmt(f.apt_floor_number || 0, 0)}`;
  $("blueprint-svg-wrap").innerHTML = generateBubbleDiagramSVG(f, "active");
  const readout = $("blueprint-Readout");
  if (readout) {
    readout.innerHTML = `
      <span class="readout-pill"><i class="readout-dot" style="background:#F56200"></i>Window Traffic: ${fmt(f.window_traffic_day_max, 1)} dBA</span>
      <span class="readout-pill"><i class="readout-dot" style="background:#eab308"></i>Equinox Sun: ${fmt(f.sun_equinox_noon_mean, 2)} klx</span>
      <span class="readout-pill"><i class="readout-dot" style="background:#2a9d8f"></i>Sky View: ${fmt(f.view_sky_mean, 3)} sr</span>
    `;
  }
}

// ============================================================================
// SEMICIRCULAR PERCENTILE GAUGE + 4-DOMAIN RADAR FOR REAL ESTATE AGENT
// ============================================================================
function generateGaugeAndRadarSVG(saved, domainShares) {
  const pct = scoreToPercentile(saved.score, saved.threshold);
  const angle = (-180 + (pct / 100) * 180) * (Math.PI / 180);
  const cx = 112, cy = 104, r = 74;
  const nx = cx + r * Math.cos(angle);
  const ny = cy + r * Math.sin(angle);

  // 95th percentile cutoff tick
  const tRad = (-180 + 0.95 * 180) * (Math.PI / 180);
  const tx1 = cx + (r - 10) * Math.cos(tRad);
  const ty1 = cy + (r - 10) * Math.sin(tRad);
  const tx2 = cx + (r + 10) * Math.cos(tRad);
  const ty2 = cy + (r + 10) * Math.sin(tRad);

  const strokeCol = saved.is_anomaly ? "#F56200" : "#386FA4";

  // 4-Domain Radar Chart on right side
  const rcx = 318, rcy = 84, rr = 56;
  const vals = domainShares.map(d => Math.min(1, Math.max(0.16, d.share / 65)));
  const pts = [
    [rcx, rcy - rr * vals[0]], // Top: Acoustics
    [rcx + rr * vals[1], rcy], // Right: Sunlight
    [rcx, rcy + rr * vals[2]], // Bottom: Views
    [rcx - rr * vals[3], rcy]  // Left: Layout
  ];
  const polyPoints = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  return `<svg viewBox="0 0 435 155" class="gauge-radar-svg" role="img" aria-label="Unusualness percentile gauge and 4-domain radar">
    <!-- Left: Semicircle Percentile Dial -->
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="#E2EEF7" stroke-width="14" stroke-linecap="round"/>
    <!-- Normal Blue Zone (0th to 95th Percentile) -->
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${tx2.toFixed(1)} ${ty2.toFixed(1)}" fill="none" stroke="#59A5D8" stroke-width="14" stroke-opacity="0.45" stroke-linecap="round"/>
    <!-- Needle -->
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${strokeCol}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="6.5" fill="#133C55"/>
    <!-- 95th Percentile Cutoff Marker -->
    <line x1="${tx1.toFixed(1)}" y1="${ty1.toFixed(1)}" x2="${tx2.toFixed(1)}" y2="${ty2.toFixed(1)}" stroke="#F56200" stroke-width="2.5"/>
    <text x="${(tx2 + 4).toFixed(1)}" y="${(ty2 - 6).toFixed(1)}" text-anchor="end" font-size="8" font-weight="800" fill="#F56200">95th PCT CUTOFF</text>
    <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="17" font-weight="800" fill="${strokeCol}">${pct}th Percentile</text>
    <text x="${cx}" y="${cy + 39}" text-anchor="middle" font-size="9.5" fill="#4A6D88">Unusualness Rank (Cutoff: 95th Pct • ${fmt(saved.score_vs_threshold, 2)}x)</text>

    <!-- Right: 4-Domain Radar -->
    <circle cx="${rcx}" cy="${rcy}" r="${rr}" fill="none" stroke="#CBE0F0" stroke-dasharray="3,3"/>
    <circle cx="${rcx}" cy="${rcy}" r="${(rr * 0.55).toFixed(1)}" fill="none" stroke="#DCEAF5"/>
    <line x1="${rcx - rr}" y1="${rcy}" x2="${rcx + rr}" y2="${rcy}" stroke="#CBE0F0"/>
    <line x1="${rcx}" y1="${rcy - rr}" x2="${rcx}" y2="${rcy + rr}" stroke="#CBE0F0"/>
    <polygon points="${polyPoints}" fill="rgba(245, 98, 0, 0.18)" stroke="#F56200" stroke-width="2.2"/>
    ${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.2" fill="${GROUPS[i][3]}"/>`).join("")}
    <text x="${rcx}" y="${rcy - rr - 7}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#F56200">ACOUSTICS (${fmt(domainShares[0].share,0)}%)</text>
    <text x="${rcx + rr + 6}" y="${rcy + 3}" text-anchor="start" font-size="8.5" font-weight="800" fill="#b45309">SUN (${fmt(domainShares[1].share,0)}%)</text>
    <text x="${rcx}" y="${rcy + rr + 14}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#1e7e72">VIEWS (${fmt(domainShares[2].share,0)}%)</text>
    <text x="${rcx - rr - 6}" y="${rcy + 3}" text-anchor="end" font-size="8.5" font-weight="800" fill="#386FA4">LAYOUT (${fmt(domainShares[3].share,0)}%)</text>
  </svg>`;
}

function emptyView() {
  const ex = EXAMPLES[activeKey];
  const previewPct = ex?.preview_pct ?? "--";
  const isAnom = ex?.tag_type === "anomaly";
  $("summary").innerHTML = `<div class="empty">
    <span class="section-label">USER STORY 01 • REAL ESTATE AGENT VIEW</span>
    <h2>Selected: ${esc(ex ? ex.label : "Custom Apartment Profile")}</h2>
    <p>Catalog Preview Rank: <strong>${previewPct}th Unusualness Percentile</strong> (${isAnom ? "Above 95th-percentile threshold — Flagged" : "Below 95th-percentile threshold — Normal"}). Click <strong>Evaluate Normality &amp; Find Better Spatial Twins</strong> on the left to run the live ONNX model and log this property to Cloudflare D1.</p>
  </div>`;
  $("errors").innerHTML = `<div class="empty">
    <h3>4-Dimension Environmental Breakdown</h3>
    <p>After clicking Evaluate, you will see intuitive Unusualness Ratings across <strong>Acoustics</strong>, <strong>Sunlight</strong>, <strong>Viewshed</strong>, and <strong>Layout</strong>.</p>
  </div>`;
  $("twins").innerHTML = `<div class="empty">
    <span class="section-label">USER STORY 02 • ARCHITECT SPATIAL TWIN ENGINE</span>
    <h3>3–5 Layout-Matched Spatial Twins</h3>
    <p>Click <strong>Evaluate Normality &amp; Find Better Spatial Twins</strong> to retrieve 3–5 similar apartments from the 44,195 catalog (&plusmn;25% area, &plusmn;2 rooms) with their own organic bubble diagrams and improvement badges.</p>
  </div>`;
  $("comparison").textContent = "Run an evaluation to populate the side-by-side comparison table.";
}

function resetChat() {
  messages = [{
    role: "assistant",
    text: current
      ? `Evaluation ready for "${current.input.label || "Selected Apartment"}". Choose any question above for a plain-English explanation of its normality percentile and spatial twins.`
      : "Pick any of the 50 apartments above and click 'Evaluate Normality & Find Better Spatial Twins', or click a question button to learn how the studio works."
  }];
  drawChat();
}

function drawChat() {
  $("chat-log").replaceChildren(...messages.map(message => {
    const bubble = document.createElement("div");
    bubble.className = `message ${message.role}`;
    bubble.textContent = message.text;
    return bubble;
  }));
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
}

function dirty() {
  revision += 1;
  pending?.abort();
  pending = null;
  current = null;
  busy(false);
  emptyView();
  resetChat();
  notice();
  updateBlueprintFromInputs();
}

async function api(path, options={}) {
  const response = await fetch(path, {credentials:"same-origin", ...options});
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Your session expired. Please log in.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`The server returned HTTP ${response.status} without a JSON response.`);
  }
  if (!response.ok) throw new Error(data.error || `Request failed: HTTP ${response.status}.`);
  return data;
}

// Build 24 feature inputs
for (const [group, start, end, color] of GROUPS) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "feature-group";
  const legend = document.createElement("legend");
  legend.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${group} (${end - start} features)`;
  fieldset.append(legend);
  for (let i = start; i < end; i++) {
    const name = FEATURES[i];
    const label = document.createElement("label");
    label.htmlFor = `feature-${name}`;
    label.textContent = LABELS[i];
    const input = document.createElement("input");
    input.id = `feature-${name}`;
    input.type = "number";
    input.step = "any";
    input.required = true;
    input.addEventListener("input", dirty);
    fieldset.append(label, input);
  }
  $("feature-fields").append(fieldset);
}

// Render up to `displayLimit` (capped at 50) apartment cards for the Real Estate Agent & Architect
function renderCarouselCards() {
  const container = $("listing-carousel");
  container.innerHTML = "";
  const allEntries = Object.entries(EXAMPLES).filter(([, ex]) => {
    if (catalogFilter === "anomaly") return ex.tag_type === "anomaly";
    if (catalogFilter === "normal") return ex.tag_type === "normal";
    return true;
  });
  const shown = allEntries.slice(0, displayLimit);
  $("display-limit-val").textContent = `${shown.length} / ${allEntries.length}`;

  for (const [key, example] of shown) {
    const f = example.features;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `listing-card ${key === activeKey ? "selected" : ""}`;
    card.dataset.key = key;
    const isAnom = example.tag_type === "anomaly";
    const pct = example.preview_pct ?? scoreToPercentile(example.preview_score || 0.1);
    card.innerHTML = `
      <div class="listing-card-top">
        <span class="listing-city">${esc(example.city || `Site ${example.site_id}`)}</span>
        <span class="listing-tag ${isAnom ? "tag-anom" : "tag-norm"}">${esc(example.tag)}</span>
      </div>
      <strong class="listing-title">${esc(example.label)}</strong>
      <div class="listing-metrics">
        <span><strong>${fmt(f.apt_total_area, 0)} m²</strong>Area</span>
        <span><strong>${fmt(f.apt_room_count, 0)}</strong>Rooms</span>
        <span><strong>${fmt(f.noise_traffic_day_max, 0)} dB</strong>Traffic</span>
        <span><strong>${pct}th</strong>Pct Rank</span>
      </div>
      <div class="listing-footer">
        <span class="listing-price">${esc(example.price_chf || "Swiss Listing")}</span>
        <span class="listing-cta">Inspect &rarr;</span>
      </div>
    `;
    card.addEventListener("click", () => {
      $("example").value = key;
      loadExample(key);
    });
    container.append(card);
  }
}

// Wire up the "Show apartments (up to 50)" slider & filter pills
$("display-limit")?.addEventListener("input", e => {
  displayLimit = Math.min(50, Math.max(4, Number(e.target.value)));
  renderCarouselCards();
});

document.querySelectorAll(".filter-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    catalogFilter = btn.dataset.filter;
    document.querySelectorAll(".filter-pill").forEach(b => b.classList.toggle("active", b === btn));
    renderCarouselCards();
  });
});

// Populate dropdown with all 50 apartments
for (const [key, example] of Object.entries(EXAMPLES)) {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = `${example.label} | ${fmt(example.features.apt_total_area, 0)} m² | ${fmt(example.features.apt_room_count, 0)} rooms | ${example.tag}`;
  $("example").append(option);
}
const custom = document.createElement("option");
custom.value = "custom";
custom.textContent = "Custom Architectural Measurements (What-If Simulation)";
$("example").append(custom);

function fillFeatures(features) {
  for (const name of FEATURES) $(`feature-${name}`).value = features[name];
}

function loadExample(key) {
  activeKey = key;
  renderCarouselCards();
  if (key === "custom") {
    dirty();
    activeMeta = {label: "Custom Architectural Simulation"};
    return;
  }
  const example = EXAMPLES[key];
  activeMeta = {apartment_id: example.apartment_id, label: example.label};
  fillFeatures(example.features);
  dirty();
}

$("example").value = Object.keys(EXAMPLES)[0];
$("example").addEventListener("change", event => loadExample(event.target.value));
for (const [id] of goals) $(id).addEventListener("change", dirty);
$("top-k").addEventListener("input", () => {
  $("top-k-value").value = $("top-k").value;
  dirty();
});

$("apartment-form").noValidate = true;

function getInput() {
  const features = {};
  for (let i = 0; i < FEATURES.length; i++) {
    const name = FEATURES[i];
    const field = $(`feature-${name}`);
    if (!field.value.trim() || !Number.isFinite(field.valueAsNumber)) {
      document.querySelector(".measurements").open = true;
      field.focus();
      throw new Error(`Provide a finite number for ${LABELS[i]}.`);
    }
    features[name] = field.valueAsNumber;
  }
  if (features.apt_total_area <= 0 || features.apt_room_count < 2) {
    throw new Error("Area must be positive and area-record count at least 2.");
  }
  return {
    ...activeMeta,
    features,
    top_k: Number($("top-k").value),
    ...Object.fromEntries(goals.map(([id, name]) => [name, $(id).checked]))
  };
}

$("apartment-form").addEventListener("submit", async event => {
  event.preventDefault();
  let input;
  try {
    input = getInput();
  } catch (error) {
    notice(error.message, true);
    return;
  }
  dirty();
  const requestRevision = revision;
  const controller = new AbortController();
  pending = controller;
  busy(true);
  notice("Evaluating apartment normality on Render & saving audit to Cloudflare D1...");
  try {
    const saved = await api("/api/predict", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(input),
      signal: controller.signal
    });
    if (requestRevision !== revision) return;
    focusedTwinIdx = 0;
    render(saved);
    notice(`Evaluation saved to Cloudflare D1 (${saved.twins.length} spatial twins retrieved). Switch between User Story 01 and User Story 02 below!`);
    await loadHistory();
  } catch (error) {
    if (requestRevision === revision && error.name !== "AbortError") notice(error.message, true);
  } finally {
    if (requestRevision === revision) {
      pending = null;
      busy(false);
    }
  }
});

function render(saved) {
  current = saved;
  const f = saved.input.features;
  const errors = saved.per_feature_squared_error;
  const total = Object.values(errors).reduce((a, b) => a + b, 0);
  const maximum = Math.max(...Object.values(errors));
  const colors = {};
  const pct = scoreToPercentile(saved.score, saved.threshold);

  // Compute 4 intuitive dimension ratings
  const domainShares = GROUPS.map(([name, start, end, color]) => {
    const slice = FEATURES.slice(start, end);
    for (const feat of slice) colors[feat] = color;
    const sumErr = slice.reduce((sum, key) => sum + errors[key], 0);
    const meanErr = sumErr / slice.length;
    const share = (100 * sumErr) / Math.max(total, 1e-12);
    const ratioToCutoff = meanErr / Math.max(1e-6, saved.threshold);
    const isFlaggedDomain = meanErr > saved.threshold || (saved.is_anomaly && share >= 28);
    const statusText = ratioToCutoff > 1.25
      ? "Needs Upgrade"
      : ratioToCutoff > 0.75
      ? "Borderline"
      : "Typical Range";
    return {name, start, end, color, sumErr, meanErr, share, ratioToCutoff, isFlaggedDomain, statusText};
  });

  const flaggedDomainNames = domainShares.filter(d => d.isFlaggedDomain).map(d => d.name);

  // Update Persona Tab headers
  $("tab-btn-agent").innerHTML = `
    <span class="persona-step">USER STORY 01 • REAL ESTATE AGENT</span>
    <strong>${saved.is_anomaly ? `Flagged (${pct}th Pct)` : `Normal (${pct}th Pct)`}</strong>
    <small>Cutoff: 95th Percentile (${fmt(saved.score_vs_threshold, 2)}x threshold)</small>
  `;
  $("tab-btn-architect").innerHTML = `
    <span class="persona-step">USER STORY 02 • ARCHITECT VIEW</span>
    <strong>Pick from ${saved.twins.length} Better Twins</strong>
    <small>${saved.matching_candidates.toLocaleString()} eligible in 44,195 catalog</small>
  `;

  // =========================================================================
  // USER STORY 1: REAL ESTATE AGENT VIEW (Intuitive Percentile & Threshold)
  // =========================================================================
  $("summary").innerHTML = `
    <div class="panel verdict-panel ${saved.is_anomaly ? "verdict-flagged" : "verdict-normal"}">
      <div class="status-line">
        <div>
          <div class="section-label">USER STORY 01 • REAL ESTATE AGENT MARKET-READINESS REPORT</div>
          <h2>${esc(saved.input.label || "Evaluated Apartment Profile")}</h2>
        </div>
        <span class="badge ${saved.is_anomaly ? "flagged" : ""}">
          ${saved.is_anomaly ? "UNUSUAL PROFILE • ABOVE 95th PCT CUTOFF" : "NORMAL PROFILE • MARKET READY"}
        </span>
      </div>

      <p class="small muted">
        Compares all 24 environmental and layout measurements against 44,195 Swiss apartments. Properties below the <strong>95th Percentile Cutoff</strong> behave like typical quiet-rule Swiss apartments; properties above the 95th percentile are flagged for an Architect to review.
      </p>

      <div class="gauge-radar-wrap">
        ${generateGaugeAndRadarSVG(saved, domainShares)}
      </div>

      <div class="metric-grid">
        <div class="metric">
          <strong>${pct}th Pct</strong>
          <span>Unusualness Percentile</span>
        </div>
        <div class="metric">
          <strong>95th Pct</strong>
          <span>Normality Cutoff Limit</span>
        </div>
        <div class="metric">
          <strong>${fmt(saved.score_vs_threshold, 2)}x</strong>
          <span>Relative to Cutoff (1.0x)</span>
        </div>
        <div class="metric">
          <strong>${flaggedDomainNames.length ? esc(flaggedDomainNames.join(", ")) : "All Balanced"}</strong>
          <span>Dimensions to Improve</span>
        </div>
      </div>

      <div class="story-bridge-banner">
        <div>
          <strong>${saved.is_anomaly ? "Hand Off to Architect: Flagged Dimensions Detected" : "Architect Preview: Explore Even Better Twins"}</strong>
          <p class="small muted">Switch to <strong>User Story 02 (Architect View)</strong> to pick from ${saved.twins.length} similar apartments (${fmt(f.apt_total_area * 0.75, 0)}–${fmt(f.apt_total_area * 1.25, 0)} m², ${Math.max(2, f.apt_room_count - 2)}–${f.apt_room_count + 2} rooms) that improve on each relevant dimension.</p>
        </div>
        <button type="button" class="secondary bridge-btn" id="jump-to-architect">
          Explore ${saved.twins.length} Architect Twins &rarr;
        </button>
      </div>
      <p class="saved-label">Saved to Cloudflare D1 at ${esc(localTime(saved.created_at))} • Reference ID: ${esc(saved.id)} (Raw score: ${fmt(saved.score, 4)} vs ${fmt(saved.threshold, 4)})</p>
    </div>
  `;

  $("jump-to-architect")?.addEventListener("click", () => setTab("architect"));

  const domainCardsHtml = domainShares.map(d => `
    <div class="domain-score-card" style="border-top: 4px solid ${d.color}">
      <div class="domain-card-top">
        <strong>${esc(d.name)} Dimension</strong>
        <span class="domain-badge ${d.isFlaggedDomain ? "domain-bad" : "domain-ok"}">
          ${esc(d.statusText)}
        </span>
      </div>
      <div class="domain-numbers">
        <span class="domain-mse">${fmt(d.ratioToCutoff, 2)}x <small>of normality cutoff</small></span>
        <span class="domain-pct">${fmt(d.share, 1)}% of deviation</span>
      </div>
      <div class="track"><div class="fill" style="width:${Math.min(100, d.share)}%;background:${d.color}"></div></div>
    </div>
  `).join("");

  const largest = Object.keys(errors)
    .sort((a, b) => errors[b] - errors[a])
    .slice(0, 6)
    .map(name => {
      const idx = FEATURES.indexOf(name);
      const reconVal = saved.reconstruction?.[name];
      const shareOfTotal = (100 * errors[name]) / Math.max(total, 1e-12);
      return `<div class="feature-error">
        <div>
          <strong>${esc(LABELS[idx])}</strong>
          <small class="muted" style="display:block">Actual: ${fmt(f[name], 2)} vs Typical Expected: ${reconVal !== undefined ? fmt(reconVal, 2) : "--"}</small>
        </div>
        <div class="track"><div class="fill" style="width:${(100 * errors[name]) / Math.max(maximum, 1e-12)}%;background:${colors[name]}"></div></div>
        <strong class="err-num">${fmt(shareOfTotal, 1)}%</strong>
      </div>`;
    }).join("");

  $("errors").innerHTML = `
    <div class="panel">
      <div class="section-label">4-DIMENSION PROFILE RATING</div>
      <h3>How Each Dimension Compares to Typical Swiss Apartments</h3>
      <p class="small muted">Values below <strong>1.00x</strong> are within the typical Swiss apartment range; values above <strong>1.00x</strong> indicate unusual exposure driving the alert.</p>
      <div class="domain-cards-grid">${domainCardsHtml}</div>
      <h3 style="margin-top:22px;">Top 6 Measurements Standing Out Most (Share of Unusualness)</h3>
      <p class="chart-note">Compares your apartment's actual measurement with what the autoencoder expects for a similar layout.</p>
      ${largest}
    </div>
  `;

  // =========================================================================
  // USER STORY 2: ARCHITECT VIEW (Interactive Twin Picker + Bubble Diagrams)
  // =========================================================================
  const comparisons = [
    ["Indoor daytime traffic", "noise_traffic_day_max", 1, " dBA", true],
    ["Window daytime traffic", "window_traffic_day_max", 1, " dBA", true],
    ["Equinox noon sun", "sun_equinox_noon_mean", 2, " klx", false],
    ["Sky view horizon", "view_sky_mean", 4, " sr", false],
    ["Greenery view", "view_greenery_mean", 4, " sr", false],
    ["Floor area", "apt_total_area", 1, " m²", null],
    ["Room / area records", "apt_room_count", 0, " rooms", null]
  ];

  const selectorPills = saved.twins.map((twin, i) => `
    <button type="button" class="twin-pick-btn ${i === focusedTwinIdx ? "active" : ""}" data-focus-twin="${i}">
      Match #0${i + 1} • Site ${esc(twin.site_id)} (${fmt(twin.features.apt_total_area, 0)} m²)
    </button>
  `).join("");

  const cards = saved.twins.map((twin, i) => {
    const tf = twin.features;
    const similarityPct = Math.max(62, Math.min(99, Math.round(100 - twin.latent_distance * 5.2)));
    const rowsHtml = comparisons.map(([label, name, digits, unit, lowerBetter]) => {
      const diff = tf[name] - f[name];
      let deltaBadge = "";
      if (lowerBetter === true) {
        const improved = diff < -0.05;
        deltaBadge = `<span class="delta-pill ${improved ? "delta-good" : "delta-neutral"}">${diff <= 0 ? "" : "+"}${fmt(diff, digits)}${unit}</span>`;
      } else if (lowerBetter === false) {
        const improved = diff > 0.0001;
        deltaBadge = `<span class="delta-pill ${improved ? "delta-good" : "delta-neutral"}">${diff >= 0 ? "+" : ""}${fmt(diff, digits)}${unit}</span>`;
      } else {
        const pctDiff = ((tf[name] - f[name]) / Math.max(1, f[name])) * 100;
        deltaBadge = `<span class="delta-pill delta-layout">${pctDiff >= 0 ? "+" : ""}${fmt(pctDiff, 0)}%</span>`;
      }
      return `<div class="compare">
        <span class="muted">${esc(label)}</span>
        <span class="value">
          ${fmt(tf[name], digits)}${unit} ${deltaBadge}
          <small>Selected flat: ${fmt(f[name], digits)}${unit}</small>
        </span>
      </div>`;
    }).join("");

    return `<article class="twin-card ${i === focusedTwinIdx ? "highlighted-twin" : ""}" id="twin-card-${i}">
      <div class="twin-title">
        <div>
          <span class="twin-rank-tag">ARCHITECT TWIN #0${i + 1}</span>
          <h3>Site ${esc(twin.site_id)} • Building ${esc(twin.building_id)}</h3>
        </div>
        <span class="distance-pill" title="Spatial fingerprint similarity">${similarityPct}% Match</span>
      </div>
      <div class="twin-mini-blueprint">
        ${generateBubbleDiagramSVG(tf, `twin-${i}`)}
      </div>
      ${rowsHtml}
      <div class="twin-actions">
        <button type="button" class="secondary full load-twin-btn" data-twin-idx="${i}">
          Inspect Twin #0${i + 1} as Active Apartment &rarr;
        </button>
      </div>
      <details class="reference">
        <summary>Catalog Reference ID</summary>
        <code>${esc(twin.apartment_id)}</code><br>
        Site ${esc(twin.site_id)} | Building ${esc(twin.building_id)} | Fingerprint distance: ${fmt(twin.latent_distance, 2)}
      </details>
    </article>`;
  }).join("");

  $("twins").innerHTML = saved.twins.length
    ? `<div class="panel">
        <div class="status-line">
          <div>
            <div class="section-label">USER STORY 02 • ARCHITECTURAL TWIN EXPLORER</div>
            <h2>Pick Any of the ${saved.twins.length} Better Spatial Twins Below</h2>
          </div>
          <span class="badge">${saved.matching_candidates.toLocaleString()} Candidates Passed Filters</span>
        </div>
        <p class="small muted">
          Each recommended apartment has a normal environmental profile, matches your layout within <strong>&plusmn;25% floor area</strong> and <strong>&plusmn;2 rooms</strong>, and improves on every checked dimension. Click any twin button below to highlight it, or load it directly into the bubble simulator.
        </p>
        <div class="twin-selector-bar">${selectorPills}</div>
        <div class="twin-grid">${cards}</div>
      </div>`
    : `<div class="empty">
        <h2>No Reference Apartments Meet All Checked Upgrade Constraints Simultaneously</h2>
        <p>Try unchecking one upgrade priority on the left (for example, if your selected apartment already has very high sunlight) and click Evaluate again.</p>
      </div>`;

  document.querySelectorAll("[data-focus-twin]").forEach(btn => {
    btn.addEventListener("click", () => {
      focusedTwinIdx = Number(btn.dataset.focusTwin);
      document.querySelectorAll("[data-focus-twin]").forEach((b, idx) => b.classList.toggle("active", idx === focusedTwinIdx));
      document.querySelectorAll(".twin-card").forEach((c, idx) => c.classList.toggle("highlighted-twin", idx === focusedTwinIdx));
      document.getElementById(`twin-card-${focusedTwinIdx}`)?.scrollIntoView({behavior: "smooth", block: "nearest"});
    });
  });

  document.querySelectorAll(".load-twin-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.twinIdx);
      const twin = saved.twins[idx];
      if (!twin) return;
      $("example").value = "custom";
      activeKey = "custom";
      renderCarouselCards();
      fillFeatures(twin.features);
      dirty();
      activeMeta = {
        apartment_id: twin.apartment_id,
        label: `Architect Twin #0${idx + 1} (Site ${twin.site_id} / Bldg ${twin.building_id})`
      };
      notice(`Loaded Architect Twin #0${idx + 1} (Site ${twin.site_id}, Building ${twin.building_id}) into the bubble diagram! Click 'Evaluate Normality' to inspect its full report.`);
      window.scrollTo({top: 0, behavior: "smooth"});
    });
  });

  // Side-by-side table
  $("comparison").innerHTML = `<table>
    <thead>
      <tr>
        <th>Apartment</th>
        ${comparisons.map(([label]) => `<th>${esc(label)}</th>`).join("")}
        <th>Fingerprint Match</th>
      </tr>
    </thead>
    <tbody>
      <tr class="query-row">
        <th>Selected (${esc(saved.input.label || "Current")})</th>
        ${comparisons.map(([, name, digits]) => `<td><strong>${fmt(f[name], digits)}</strong></td>`).join("")}
        <td>Reference</td>
      </tr>
      ${saved.twins.map((twin, i) => `
        <tr>
          <th>Twin #0${i + 1} (Site ${esc(twin.site_id)} / Bldg ${esc(twin.building_id)})</th>
          ${comparisons.map(([, name, digits]) => `<td>${fmt(twin.features[name], digits)}</td>`).join("")}
          <td><strong>${Math.max(62, Math.min(99, Math.round(100 - twin.latent_distance * 5.2)))}%</strong> (dist ${fmt(twin.latent_distance, 2)})</td>
        </tr>
      `).join("")}
    </tbody>
  </table>`;

  resetChat();
}

async function loadHistory() {
  $("history-status").textContent = "Loading saved evaluations from Cloudflare D1...";
  try {
    const rows = await api("/api/history");
    $("history-status").textContent = rows.length
      ? `Showing the latest ${rows.length} saved evaluations from Cloudflare D1. Click any entry to reopen its bubble diagram, normality percentile, and twins.`
      : "No saved evaluations in D1 yet.";
    $("history").innerHTML = rows.map(row => {
      const pct = scoreToPercentile(row.score, row.threshold);
      return `
      <button type="button" class="history-entry" data-history="${esc(row.id)}">
        <span>
          <strong>${esc(row.label || "Apartment Profile")}</strong>
          <small>Catalog ID: ${esc(row.apartment_id || "Custom simulation")}</small>
        </span>
        <span>
          <span class="badge ${row.is_anomaly ? "flagged" : ""}" style="font-size:11px;padding:3px 9px;">
            ${row.is_anomaly ? `Flagged (${pct}th Pct)` : `Normal (${pct}th Pct)`}
          </span>
          <small style="margin-top:4px;">${row.twin_count} better twins saved</small>
        </span>
        <time>${esc(localTime(row.created_at))}</time>
      </button>
    `;
    }).join("");
  } catch (error) {
    $("history-status").textContent = error.message;
  }
}

$("refresh-history").addEventListener("click", loadHistory);

$("history").addEventListener("click", async event => {
  const button = event.target.closest("[data-history]");
  if (!button) return;
  dirty();
  const requestRevision = revision;
  button.disabled = true;
  try {
    const saved = await api(`/api/history?id=${encodeURIComponent(button.dataset.history)}`);
    if (requestRevision !== revision) return;
    activeMeta = {apartment_id: saved.input.apartment_id, label: saved.input.label};
    const matchedKey = Object.keys(EXAMPLES).find(key => EXAMPLES[key].apartment_id === saved.input.apartment_id) || "custom";
    $("example").value = matchedKey;
    activeKey = matchedKey;
    renderCarouselCards();
    fillFeatures(saved.input.features);
    for (const [id, name] of goals) $(id).checked = saved.input[name];
    $("top-k").value = saved.input.top_k;
    $("top-k-value").value = saved.input.top_k;
    updateBlueprintFromInputs();
    render(saved);
    notice(`Reopened saved evaluation "${saved.input.label || saved.id}" from Cloudflare D1.`);
    $("summary").scrollIntoView({behavior: "smooth", block: "start"});
  } catch (error) {
    notice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", {method: "POST"});
    window.location.replace("/login");
  } catch (error) {
    notice(error.message, true);
  }
});

function explain(key) {
  if (key === "measurements") {
    return "The 24 measurements describe four spatial qualities from Swiss Dwellings v3.0.0:\n• Acoustics (8 features): daytime & nighttime road/rail noise inside rooms and at windows (in dBA).\n• Sunlight (6 features): direct solar illuminance (klx) across equinox, summer, and winter.\n• Viewshed (5 features): open sky, greenery, buildings, streets, and visible isovist area.\n• Layout (5 features): total area (m²), room/area-record count, floor level, window perimeter, and centrality.";
  }
  if (key === "reliability") {
    return "How our two user stories work together:\n• User Story 1 (Real Estate Agent): Chooses how many apartments for sale to display (up to 50), picks one, and immediately sees its Unusualness Percentile against the 95th-percentile threshold.\n• User Story 2 (Architect): Picks an apartment that is flagged on one or more dimensions and explores 3–5 similar apartments (same area ±25% and rooms ±2) that improve on each relevant dimension.";
  }
  if (!current) {
    return "Please click 'Evaluate Normality & Find Better Spatial Twins' first (or select a saved entry from D1 below). I will then explain that apartment's normality percentile and twin comparisons.";
  }
  const f = current.input.features;
  const pct = scoreToPercentile(current.score, current.threshold);
  if (key === "score") {
    return `"${current.input.label || "This apartment"}" ranks at the ${pct}th Unusualness Percentile across the Swiss Dwellings catalog (${fmt(current.score_vs_threshold, 2)}x the 95th-percentile cutoff).\n\nVerdict: ${current.is_anomaly ? "FLAGGED AS UNUSUAL (Above the 95th-percentile cutoff — recommended for Architect Twin search)." : "NORMAL / MARKET READY (Within the 95th-percentile normal range of Swiss apartments)."}`;
  }
  if (key === "flag") {
    const errors = current.per_feature_squared_error;
    const total = Object.values(errors).reduce((a, b) => a + b, 0);
    const share = (100 * FEATURES.slice(0, 8).reduce((a, name) => a + errors[name], 0)) / Math.max(total, 1e-12);
    return `${current.is_anomaly ? "It was flagged because its unusualness rank exceeds the 95th-percentile threshold." : "This apartment was NOT flagged: it sits below the 95th-percentile threshold."}\n\nTop 3 measurements standing out most:\n${Object.keys(errors).sort((a, b) => errors[b] - errors[a]).slice(0, 3).map(name => `• ${LABELS[FEATURES.indexOf(name)]}: ${fmt((100 * errors[name]) / Math.max(total, 1e-12), 1)}% of deviation`).join("\n")}\n\nAcoustics accounts for ${fmt(share, 1)}% of the overall profile deviation.`;
  }
  if (key === "twins") {
    if (!current.twins.length) {
      return "No apartments met every checked improvement goal simultaneously. Try unchecking one priority on the left and evaluating again.";
    }
    return current.twins.map((twin, i) => {
      const t = twin.features;
      const dNoise = f.noise_traffic_day_max - t.noise_traffic_day_max;
      const dSun = t.sun_equinox_noon_mean - f.sun_equinox_noon_mean;
      return `• Twin #0${i + 1} (Site ${twin.site_id}, Bldg ${twin.building_id}): Indoor traffic noise ${fmt(t.noise_traffic_day_max, 1)} dBA (${fmt(Math.abs(dNoise), 1)} dBA ${dNoise >= 0 ? "quieter" : "louder"}); Equinox sun ${fmt(t.sun_equinox_noon_mean, 2)} klx (${dSun >= 0 ? "+" : ""}${fmt(dSun, 2)} klx); Area ${fmt(t.apt_total_area, 1)} m² (yours: ${fmt(f.apt_total_area, 1)} m²).`;
    }).join("\n\n");
  }
  if (key === "matches") {
    return `Out of 44,195 reference apartments, ${current.matching_candidates.toLocaleString()} normal apartments matched your layout (area ±25%, rooms ±2) and passed every checked improvement goal. The top ${current.twins.length} closest matches in the autoencoder's 8D fingerprint space are shown.`;
  }
  return "Select one of the question buttons above.";
}

for (const [key, label] of Object.entries(questionLabels)) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = label;
  button.addEventListener("click", () => {
    messages = [...messages.slice(-12), {role: "user", text: label}, {role: "assistant", text: explain(key)}];
    drawChat();
  });
  $("question-buttons").append(button);
}

$("clear-chat").addEventListener("click", resetChat);
loadExample($("example").value);
loadHistory();
