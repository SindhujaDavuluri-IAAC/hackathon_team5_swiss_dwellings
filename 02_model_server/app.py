"""Day 2: serve the exported Swiss Dwellings model without training or the CSV.

Run from the repository root: python 02_model_server/app.py
The Gradio page and /predict API share exactly the same inference function.
"""
import hashlib
import io
from html import escape
import json
import os
from pathlib import Path

import gradio as gr
import numpy as np
import onnxruntime as ort
import requests

# Resolve paths from this file, so changing the terminal's folder is harmless.
HERE = Path(__file__).resolve().parent
MODEL_DIR = Path(os.environ.get("MODEL_DIR", HERE.parent / "01_autoencoder" / "model_app"))
HF_REPO = "iaac-maai/hackathon-team5-swiss-dwellings"
# Pin the verified release so later repository uploads cannot change this server.
HF_REVISION = "1f410d690ad7e6e6d46442e856f9232183542973"
# Refuse to pair a different remote model with this run's scaler and threshold.
EXPECTED_ONNX_SHA256 = "884fb2b59c052b72862f0b07e9ef1b3c983c2d9e60494ae4738d35d2c24e77e3"
CONFIG = json.loads((MODEL_DIR / "anomaly_ae_config.json").read_text(encoding="utf-8"))
FEATURES = CONFIG["feature_names"]
MEAN = np.asarray(CONFIG["scaler_mean"], dtype=np.float64)
SCALE = np.asarray(CONFIG["scaler_scale"], dtype=np.float64)
THRESHOLD = float(CONFIG["threshold"])
if len(FEATURES) != 24 or len(set(FEATURES)) != 24:
    raise ValueError("This server expects 24 distinct apartment features.")
if MEAN.shape != (24,) or SCALE.shape != (24,) or not np.isfinite([MEAN, SCALE]).all() or (SCALE <= 0).any():
    raise ValueError("The saved scaler is invalid.")
if not np.isfinite(THRESHOLD) or THRESHOLD <= 0:
    raise ValueError("The saved threshold must be positive.")

# Locally use the existing ONNX. On Render it is ignored by Git, so fetch only
# this small model from Hugging Face, never the original simulations.csv.
model_path = MODEL_DIR / "anomaly_ae.onnx"
if model_path.is_file():
    model_bytes = model_path.read_bytes()
    MODEL_SOURCE = "local Day 1 export"
else:
    response = requests.get(
        f"https://huggingface.co/{HF_REPO}/resolve/{HF_REVISION}/anomaly_ae.onnx", timeout=90
    )
    response.raise_for_status()
    model_bytes = response.content
    MODEL_SOURCE = "Hugging Face (SHA-256 verified)"
MODEL_SHA256 = hashlib.sha256(model_bytes).hexdigest()
if MODEL_SHA256 != EXPECTED_ONNX_SHA256:
    raise RuntimeError("Model hash mismatch. Publish the matching Day 1 export or update the complete bundle together.")

# Load the network once. ONNX Runtime executes it on CPU with few threads.
options = ort.SessionOptions()
options.intra_op_num_threads = 1
options.inter_op_num_threads = 1
SESSION = ort.InferenceSession(model_bytes, sess_options=options, providers=["CPUExecutionProvider"])
INPUT_NAME = SESSION.get_inputs()[0].name
if {o.name for o in SESSION.get_outputs()} != {"reconstruction", "latent"}:
    raise ValueError("Expected both reconstruction and latent ONNX outputs.")


def run_model(scaled):
    """Return reconstructed features and 8-number fingerprints for a batch."""
    return SESSION.run(["reconstruction", "latent"], {INPUT_NAME: np.asarray(scaled, dtype=np.float32)})


def standardize(raw):
    # Match training: subtract the saved training mean, divide by its scale,
    # then convert to float32. Never fit a new scaler on a request or catalog.
    return ((np.asarray(raw, dtype=np.float64) - MEAN) / SCALE).astype(np.float32)


# Use only the verified team artifact: NPZ IDs require pickle-enabled loading.
# The reference catalog is hosted on Hugging Face rather than committed to Git.
catalog_path = MODEL_DIR / "full_apartments_catalog.npz"
if catalog_path.is_file():
    catalog_bytes = catalog_path.read_bytes()
else:
    response = requests.get(
        f"https://huggingface.co/{HF_REPO}/resolve/{HF_REVISION}/full_apartments_catalog.npz",
        timeout=90,
    )
    response.raise_for_status()
    catalog_bytes = response.content
if hashlib.sha256(catalog_bytes).hexdigest() != "3767804296c99642db74baa6c55deB13D069C5E75132F7A46988D7B08003D59B".lower():
    raise RuntimeError("Reference catalog hash mismatch.")
with np.load(io.BytesIO(catalog_bytes), allow_pickle=True) as saved:
    CATALOG = {k: saved[k].copy() for k in ["apartment_id", "building_id", "site_id", "is_anomaly", "features"]}
RAW = CATALOG["features"]
if RAW.ndim != 2 or RAW.shape[1] != len(FEATURES) or not np.isfinite(RAW).all():
    raise ValueError("Catalog features must be a finite N x 24 matrix.")
if any(len(v) != len(RAW) for v in CATALOG.values()):
    raise ValueError("Catalog rows and identifiers do not align.")
# Re-encode with the actual loaded ONNX, avoiding stale saved latent vectors.
LATENTS = np.concatenate([run_model(standardize(RAW[i:i + 1024]))[1] for i in range(0, len(RAW), 1024)])
COLUMN = {name: i for i, name in enumerate(FEATURES)}


def find_twins(raw, scaled, request):
    """Filter using physical values, then rank matches in the latent space."""
    target = scaled.copy()
    if request.get("improve_acoustics", True):
        target[:8] = -0.5
    if request.get("improve_sunlight", True):
        target[8:14] = np.maximum(target[8:14], 0.8)
    if request.get("improve_view", True):
        target[[14, 15, 17]] = np.maximum(target[[14, 15, 17]], 0.8)
    target_latent = run_model(target[None])[1][0]
    col = lambda name: RAW[:, COLUMN[name]]
    value = lambda name: raw[COLUMN[name]]
    mask = CATALOG["is_anomaly"] == 0
    if request.get("apartment_id") is not None:
        mask &= CATALOG["apartment_id"].astype(str) != str(request["apartment_id"])
    # Exclude an identical feature row even if the caller omitted the ID.
    mask &= ~np.isclose(RAW, raw, rtol=1e-5, atol=1e-4).all(axis=1)
    mask &= (col("apt_total_area") >= value("apt_total_area") * 0.75) & (col("apt_total_area") <= value("apt_total_area") * 1.25)
    mask &= np.abs(col("apt_room_count") - value("apt_room_count")) <= 2
    if request.get("improve_acoustics", True):
        mask &= col("noise_traffic_day_max") < value("noise_traffic_day_max") - 10
        mask &= col("window_traffic_day_max") < value("window_traffic_day_max") - 10
    if request.get("improve_sunlight", True):
        mask &= col("sun_equinox_noon_mean") > value("sun_equinox_noon_mean")
    if request.get("improve_view", True):
        mask &= col("view_sky_mean") > value("view_sky_mean")
        mask &= col("view_greenery_mean") >= value("view_greenery_mean")
    indices = np.flatnonzero(mask)
    distances = np.linalg.norm(LATENTS[indices] - target_latent, axis=1)
    order = np.argsort(distances, kind="stable")[:request.get("top_k", 3)]
    twins = []
    for j in order:
        i = indices[j]
        twins.append({
            "apartment_id": str(CATALOG["apartment_id"][i]),
            "site_id": int(CATALOG["site_id"][i]),
            "building_id": int(CATALOG["building_id"][i]),
            "latent_distance": float(distances[j]),
            "features": dict(zip(FEATURES, map(float, RAW[i]))),
        })
    return twins, int(len(indices))


def predict(apartment_json: str) -> dict:
    """API: JSON text containing raw apartment features -> JSON result."""
    try:
        request = json.loads(apartment_json)
    except (json.JSONDecodeError, TypeError) as error:
        raise ValueError("Send valid JSON text containing a features object.") from error
    if not isinstance(request, dict) or not isinstance(request.get("features"), dict):
        raise ValueError('Expected {"features": {"feature_name": number, ...}}.')
    features = request["features"]
    missing = sorted(set(FEATURES) - set(features))
    extra = sorted(set(features) - set(FEATURES))
    if missing or extra:
        raise ValueError(f"Feature mismatch. Missing: {missing}; unexpected: {extra}")
    if any(isinstance(features[k], bool) or not isinstance(features[k], (int, float)) for k in FEATURES):
        raise ValueError("All 24 features must be numbers, not strings, booleans or null.")
    raw = np.asarray([features[k] for k in FEATURES], dtype=np.float64)
    if not np.isfinite(raw).all():
        raise ValueError("All features must be finite: no NaN or infinity.")
    if raw[COLUMN["apt_total_area"]] <= 0 or raw[COLUMN["apt_room_count"]] < 2:
        raise ValueError("Apartment area must be positive and area-record count at least 2.")
    top_k = request.get("top_k", 3)
    if type(top_k) is not int or not 1 <= top_k <= 5:
        raise ValueError("top_k must be an integer between 1 and 5.")
    for flag in ["improve_acoustics", "improve_sunlight", "improve_view"]:
        if flag in request and type(request[flag]) is not bool:
            raise ValueError(f"{flag} must be true or false.")
    scaled = standardize(raw)
    if not np.isfinite(scaled).all():
        raise ValueError("Feature magnitudes are too large for the model.")
    rebuilt, latent = run_model(scaled[None])
    errors = (scaled - rebuilt[0]) ** 2
    if not np.isfinite(errors).all():
        raise ValueError("The input produced non-finite model output.")
    score = float(errors.mean())
    twins, count = find_twins(raw, scaled, request)
    return {
        "score": score,
        "threshold": THRESHOLD,
        "is_anomaly": bool(score > THRESHOLD),
        "score_vs_threshold": score / THRESHOLD,
        "latent": latent[0].tolist(),
        "reconstruction": dict(zip(FEATURES, map(float, rebuilt[0] * SCALE + MEAN))),
        "per_feature_squared_error": dict(zip(FEATURES, map(float, errors))),
        "twins": twins,
        "matching_candidates": count,
        "search_note": "All returned matches pass the requested filters. Fewer matches means fewer eligible apartments.",
        "model_sha256": MODEL_SHA256,
    }


def health() -> dict:
    """Readiness details available to another program at /health."""
    return {"status": "ready", "model_source": MODEL_SOURCE, "model_sha256": MODEL_SHA256,
            "n_features": len(FEATURES), "latent_dim": CONFIG["latent_dim"], "catalog_size": len(RAW), "hf_revision": HF_REVISION}



# ---- Dashboard controls wrap the same prediction function used by the API. ----
EXAMPLES = {p.stem: json.loads(p.read_text(encoding="utf-8"))
            for p in sorted((MODEL_DIR / "examples").glob("*.json"))}
DEFAULT_EXAMPLE = next((k for k in EXAMPLES if k.startswith("noisy")), next(iter(EXAMPLES)))
FEATURE_LABELS = [
    "Indoor traffic: daytime average (dBA)", "Indoor traffic: daytime maximum (dBA)",
    "Indoor traffic: nighttime average (dBA)", "Indoor traffic: nighttime maximum (dBA)",
    "Window traffic: daytime maximum (dBA)", "Window traffic: nighttime maximum (dBA)",
    "Indoor train: daytime maximum (dBA)", "Window train: daytime maximum (dBA)",
    "Equinox sun: noon", "Equinox sun: afternoon", "Summer sun: morning",
    "Summer sun: noon", "Summer sun: evening", "Winter sun: noon",
    "Sky view", "Greenery view", "Building view", "Isovist", "Street view",
    "Total area (m2)", "Area-record count", "Floor number", "Window perimeter (m)", "Closeness centrality",
]
GROUPS = [("Acoustics",0,8,"#ce775b"), ("Sunlight",8,14,"#d5a549"),
          ("Views",14,19,"#469b7e"), ("Layout",19,24,"#728eab")]
# Native HTML charts avoid another plotting dependency on the small CPU server.
CARD_CSS = """
:host { font-family: Arial, sans-serif; color: #183d36; }
* { box-sizing: border-box; } h1,h2,h3,p { margin: 0; }
.hero { background: radial-gradient(ellipse at right top,#407b61,transparent 65%),#123e35; border-radius:22px; padding:34px 38px; color:white; }
.eyebrow,.section-label { font-size:11px; letter-spacing:1.8px; text-transform:uppercase; font-weight:700; margin-bottom:12px; }
.eyebrow { color:#bfdbcd; } .section-label { color:#687f6f; }
.hero h1 { color:white; font-size:clamp(30px,4vw,44px); letter-spacing:-1.5px; line-height:1.1; margin:12px 0; }
.hero p { max-width:660px; color:#d7e9de; font-size:15px; line-height:1.7; }
.pills { display:flex; flex-wrap:wrap; gap:10px; margin-top:22px; }
.pill { border:1px solid #729286; border-radius:30px; padding:7px 12px; color:#e4efe8; font-size:12px; }
.panel { padding:24px; background:white; border:1px solid #e0e7de; border-radius:16px; }
h2 { color:#183d36; font-size:22px; letter-spacing:-.5px; margin-bottom:8px; }
h3 { color:#183d36; font-size:17px; margin-bottom:8px; }
.copy { color:#68796e; font-size:13px; line-height:1.65; }
.badge { display:inline-block; padding:6px 10px; font-size:12px; border-radius:20px; background:#e9f3ec; color:#256047; font-weight:700; }
.badge.flagged { color:#99482e; background:#fae9e0; }
.status-line { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:16px; }
.metric-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:20px 0 14px; }
.metric { background:#f4f7f2; padding:14px; border-radius:10px; }
.metric strong { display:block; font-size:25px; color:#193f34; }
.metric span { display:block; margin-top:5px; font-size:11px; color:#69796e; }
.empty { background:#f6f8f3; border:1px dashed #c6d3c7; padding:25px; border-radius:15px; }
.chart-row { margin:14px 0; }
.chart-heading { display:flex; justify-content:space-between; gap:14px; font-size:12px; color:#475e50; margin-bottom:6px; }
.track { height:8px; background:#eff3ed; border-radius:8px; overflow:hidden; }
.fill { height:100%; border-radius:8px; }
.chart-note { margin:20px 0 12px; font-size:11px; color:#718173; line-height:1.6; }
.feature-row { display:grid; grid-template-columns:minmax(120px,1.6fr) 1fr 45px; gap:10px; align-items:center; font-size:11px; margin:11px 0; color:#526557; }
.feature-row .track { height:5px; } .feature-row strong { text-align:right; }
.twin-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:14px; margin-top:16px; }
.twin { padding:20px; border:1px solid #dce6dc; border-radius:14px; background:white; }
.twin:first-child { border-top:3px solid #438064; }
.twin-title { display:flex; justify-content:space-between; gap:8px; margin-bottom:14px; align-items:center; }
.twin-title strong { font-size:17px; } .twin-title span { font-size:11px; color:#667e6b; }
.compare { display:flex; justify-content:space-between; align-items:baseline; gap:10px; padding:10px 0; border-top:1px solid #eef2eb; font-size:12px; }
.compare .label { color:#6e7f70; } .compare .value { color:#233e30; font-weight:700; text-align:right; }
.compare small { display:block; margin-top:4px; color:#718173; font-weight:400; }
.twin details { font-size:10px; color:#788678; margin-top:12px; line-height:1.6; overflow-wrap:anywhere; }
.footer { font-size:11px; line-height:1.7; color:#708071; padding:12px 4px; }
@media(max-width:560px) { .hero { padding:26px 22px; } .panel { padding:18px; } .metric-grid { gap:6px; } .metric { padding:10px; } .metric strong { font-size:20px; } }
"""
PAGE_CSS = """
.gradio-container { max-width:1260px !important; margin:auto !important; }
body,.gradio-container { background:#f5f6f0 !important; }
#workspace { gap:22px; margin-top:14px; }
#input-panel { background:white; border:1px solid #e0e7de; border-radius:16px; padding:22px; }
#analyse-button { min-height:48px; border-radius:10px; font-weight:700; }
"""
EMPTY_SUMMARY = '<div class="empty"><h3>Your apartment, at a glance</h3><p class="copy">Choose a starting apartment, set your priorities, then analyse its profile.</p></div>'
EMPTY_ERRORS = '<div class="empty"><h3>Understand the profile</h3><p class="copy">The chart will show which measurements the model found unusual.</p></div>'
EMPTY_TWINS = '<div class="empty"><h3>Discover comparable apartments</h3><p class="copy">Matching apartments will appear here after analysis.</p></div>'


def example_label(key):
    row = EXAMPLES[key]
    kind = "Noisy example" if key.startswith("noisy") else "Quiet-rule example"
    return f"{kind} {key.rsplit('_',1)[-1]} | {row['features']['apt_total_area']:.0f} m2 | floor {row['features']['apt_floor_number']:g}"


def reset_results():
    """Remove stale results when the user changes measurements or preferences."""
    return EMPTY_SUMMARY, EMPTY_ERRORS, EMPTY_TWINS, [], None


def select_example(key):
    return (*[EXAMPLES[key]["features"][name] for name in FEATURES], *reset_results(), key)


def render_summary(result):
    flagged = result["is_anomaly"]
    title = "An unusual apartment profile" if flagged else "Within the model's learned range"
    badge_class = "badge flagged" if flagged else "badge"
    badge = "Flagged as unusual" if flagged else "Not flagged"
    return f"""<div class="panel"><div class="status-line"><div class="section-label">Apartment profile</div><span class="{badge_class}">{badge}</span></div>
    <h2>{title}</h2><p class="copy">The model compares all 24 measurements with patterns learned from rule-normal apartments.</p>
    <div class="metric-grid"><div class="metric"><strong>{result['score_vs_threshold']:.2f}x</strong><span>score / threshold</span></div>
    <div class="metric"><strong>{result['score']:.4f}</strong><span>reconstruction score</span></div>
    <div class="metric"><strong>{result['threshold']:.4f}</strong><span>decision threshold</span></div></div>
    <p class="copy">A score above the threshold is flagged. This is not a noise rating or a probability; a non-flagged result does not certify quietness.</p></div>"""


def render_errors(result):
    errors = result["per_feature_squared_error"]
    total = sum(errors.values())
    bars, colors = [], {}
    for label, start, end, color in GROUPS:
        share = 100 * sum(errors[name] for name in FEATURES[start:end]) / max(total, 1e-12)
        bars.append(f'<div class="chart-row"><div class="chart-heading"><span>{label}</span><strong>{share:.1f}%</strong></div><div class="track"><div class="fill" style="width:{share:.3f}%;background:{color}"></div></div></div>')
        colors.update({name:color for name in FEATURES[start:end]})
    maximum = max(errors.values())
    rows = []
    for name in sorted(errors, key=errors.get, reverse=True)[:6]:
        width = 100 * errors[name] / max(maximum, 1e-12)
        label = escape(FEATURE_LABELS[COLUMN[name]])
        rows.append(f'<div class="feature-row"><span>{label}</span><div class="track"><div class="fill" style="width:{width:.3f}%;background:{colors[name]}"></div></div><strong>{errors[name]:.3f}</strong></div>')
    return '<div class="panel"><div class="section-label">What stands out?</div><h3>Reconstruction error by domain</h3><p class="copy">Share of total squared error, not a measurement of harm.</p>' + ''.join(bars) + '<p class="chart-note">Largest feature mismatches below. Bar lengths are relative to the largest feature error; values are squared errors in standardized units.</p>' + ''.join(rows) + '</div>'


def render_twins(result, features):
    if not result["twins"]:
        return '<div class="empty"><h3>No apartments meet all selected goals</h3><p class="copy">Try turning off one improvement goal. We keep the area/count and selected improvement filters even when fewer matches are available.</p></div>'
    cards = []
    for rank, twin in enumerate(result["twins"], start=1):
        f = twin["features"]
        comparisons = [("Indoor daytime traffic","noise_traffic_day_max",".1f"," dBA"),
                       ("Window daytime traffic","window_traffic_day_max",".1f"," dBA"),
                       ("Equinox noon sun","sun_equinox_noon_mean",".2f",""),
                       ("Sky view","view_sky_mean",".4f",""),
                       ("Greenery view","view_greenery_mean",".4f",""),
                       ("Area","apt_total_area",".1f"," m2"),("Area records","apt_room_count",".0f","")]
        rows = ''.join(f'<div class="compare"><span class="label">{label}</span><span class="value">{format(f[name],fmt)}{unit}<small>your apartment: {format(features[name],fmt)}{unit}</small></span></div>' for label,name,fmt,unit in comparisons)
        cards.append(f'<article class="twin"><div class="twin-title"><strong>Match {rank:02d}</strong><span>distance {twin["latent_distance"]:.2f}</span></div>{rows}<details><summary>Apartment reference</summary>{escape(twin["apartment_id"])}<br>Site {twin["site_id"]} | building {twin["building_id"]}</details></article>')
    return f'<div class="section-label">Your alternatives</div><h2>{len(cards)} matching apartments</h2><p class="copy">{result["matching_candidates"]:,} candidates pass your filters. Smaller latent distance means a closer learned fingerprint.</p><div class="twin-grid">' + ''.join(cards) + '</div>'


TABLE_FEATURES = ["noise_traffic_day_max","window_traffic_day_max","sun_equinox_noon_mean",
                  "view_sky_mean","view_greenery_mean","apt_total_area","apt_room_count"]
TABLE_HEADERS = ["Apartment","Traffic day (dBA)","Window day (dBA)","Equinox sun",
                 "Sky view","Greenery view","Area (m2)","Area records","Latent distance"]


def analyse_for_page(example_key, loaded_key, acoustics, sunlight, views, top_k, *measurements):
    """Translate friendly controls to the existing JSON prediction contract."""
    try:
        if loaded_key != example_key:
            raise ValueError("The selected apartment is still loading. Please try again in a moment.")
        if len(measurements) != len(FEATURES) or any(v is None for v in measurements):
            raise ValueError("Provide a number for every apartment measurement.")
        features = dict(zip(FEATURES, map(float, measurements)))
        request = {"apartment_id":EXAMPLES[example_key]["apartment_id"],"features":features,
                   "improve_acoustics":acoustics,"improve_sunlight":sunlight,
                   "improve_view":views,"top_k":int(top_k)}
        result = predict(json.dumps(request))
    except (ValueError,TypeError,KeyError) as error:
        raise gr.Error(str(error)) from error
    def row(label, values, distance):
        return [label,*[round(float(values[name]),4) for name in TABLE_FEATURES],distance]
    rows = [row("Your apartment",features,None)]
    rows.extend(row(f"Match {i}",twin["features"],round(twin["latent_distance"],3))
                for i,twin in enumerate(result["twins"],start=1))
    return render_summary(result),render_errors(result),render_twins(result,features),rows,result


with gr.Blocks(title="Quiet & Bright | Swiss Dwellings", analytics_enabled=False) as demo:
    gr.HTML(f"""<header class="hero"><div class="eyebrow">Swiss Dwellings / Team 5</div>
    <h1>A quieter place.<br>A brighter possibility.</h1>
    <p>Explore an apartment's environmental profile and discover comparable spaces with the qualities you care about.</p>
    <div class="pills"><span class="pill">{len(RAW):,} reference apartments</span><span class="pill">Noise / sunlight / views / layout</span><span class="pill">Quiet &amp; Bright Twin Finder</span></div></header>""",css_template=CARD_CSS)
    loaded_example = gr.State(DEFAULT_EXAMPLE)
    with gr.Row(elem_id="workspace"):
        with gr.Column(scale=4,min_width=310,elem_id="input-panel"):
            gr.Markdown("### 01 / Choose your starting point\nSelect one of four saved examples, then choose what you would like to improve.")
            example = gr.Dropdown(choices=[(example_label(key),key) for key in EXAMPLES],value=DEFAULT_EXAMPLE,label="Starting apartment",interactive=True)
            gr.Markdown("### 02 / Set your priorities")
            acoustics = gr.Checkbox(value=True,label="Lower daytime traffic noise")
            sunlight = gr.Checkbox(value=True,label="More equinox sunlight")
            views = gr.Checkbox(value=True,label="Better sky and greenery views")
            top_k = gr.Slider(minimum=1,maximum=5,value=3,step=1,label="Number of matches",interactive=True)
            gr.Markdown("Matches have area within +/-25% and area-record count within +/-2. Fewer may meet all your goals.")
            with gr.Accordion("Review or edit the 24 measurements",open=False):
                gr.Markdown("Values use the dataset's original units. Sun and view inputs are simulation measures; area records include ancillary spaces.")
                inputs = []
                with gr.Tabs():
                    for label,start,end,_ in GROUPS:
                        with gr.Tab(label):
                            for i in range(start,end):
                                inputs.append(gr.Number(value=EXAMPLES[DEFAULT_EXAMPLE]["features"][FEATURES[i]],label=FEATURE_LABELS[i],interactive=True))
            button = gr.Button("Analyse profile & find twins",variant="primary",elem_id="analyse-button")
        with gr.Column(scale=7,min_width=310):
            summary = gr.HTML(EMPTY_SUMMARY,css_template=CARD_CSS)
            error_chart = gr.HTML(EMPTY_ERRORS,css_template=CARD_CSS)
    twins = gr.HTML(EMPTY_TWINS,css_template=CARD_CSS)
    with gr.Accordion("Compare all measurements at a glance",open=False):
        comparison = gr.Dataframe(headers=TABLE_HEADERS,datatype=["str"]+["number"]*8,value=[],interactive=False,wrap=True,label="Query and matching apartments")
    with gr.Accordion("Full prediction details",open=False):
        raw_details = gr.JSON(label="Prediction response")
    gr.HTML('<div class="footer">Research prototype using Swiss Dwellings v3.0.0 (Archilyse, CC BY 4.0). Reference apartments are historical examples, not live listings. Area/count similarity does not establish an identical plan. Noise-rule metrics are preliminary, and a normal prediction does not certify quietness.</div>',css_template=CARD_CSS)
    result_outputs = [summary,error_chart,twins,comparison,raw_details]
    # A selector change updates 24 fields. Disable analysis until that update
    # completes, and retain the loaded key to reject any earlier click safely.
    example.change(lambda: gr.update(interactive=False),outputs=button,
                   api_visibility="private",queue=False).then(
        select_example,inputs=example,outputs=[*inputs,*result_outputs,loaded_example],
        api_visibility="private",queue=False).then(
        lambda: gr.update(interactive=True),outputs=button,api_visibility="private",queue=False)
    for control in [acoustics,sunlight,views,top_k,*inputs]:
        control.input(reset_results,outputs=result_outputs,api_visibility="private",queue=False)
    button.click(analyse_for_page,inputs=[example,loaded_example,acoustics,sunlight,views,top_k,*inputs],outputs=result_outputs,api_visibility="private")
    # Keep the original public API for the notebooks and the future web app.
    gr.api(predict,api_name="predict")
    gr.api(health,api_name="health")

if __name__ == "__main__":
    demo.queue(max_size=16,default_concurrency_limit=1).launch(
        server_name="0.0.0.0",server_port=int(os.environ.get("PORT","7860")),
        show_error=True,allowed_paths=[],css=PAGE_CSS,
        theme=gr.themes.Soft(primary_hue="emerald",neutral_hue="slate",font=["Arial","sans-serif"]),
    )
