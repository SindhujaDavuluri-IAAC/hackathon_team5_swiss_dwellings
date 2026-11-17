"""Day 2: serve the exported Swiss Dwellings model without training or the CSV.

Run from the repository root: python 02_model_server/app.py
The Gradio page and /predict API share exactly the same inference function.
"""
import hashlib
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


# This NPZ is a trusted, team-produced artifact checked into this repository.
# Its apartment IDs are object arrays, hence allow_pickle=True. Never accept
# uploaded NPZ files here. Only this fixed artifact path is read.
with np.load(MODEL_DIR / "full_apartments_catalog.npz", allow_pickle=True) as saved:
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


EXAMPLES = {p.stem: p.read_text(encoding="utf-8") for p in sorted((MODEL_DIR / "examples").glob("*.json"))}
with gr.Blocks(title="Quiet & Bright Twin Finder") as demo:
    gr.Markdown(
        "# Quiet & Bright Twin Finder\n"
        "Choose an apartment example or paste its 24 apartment-level measurements. "
        "The model flags unusual profiles and searches for comparable apartments with "
        "lower daytime traffic noise, more equinox sunlight, and better sky/greenery views. "
        "Change the optional search flags in the JSON to choose your goals.\n\n"
        "A normal result does not certify quietness. Matches are dataset examples, not available property listings."
    )
    example = gr.Dropdown(choices=list(EXAMPLES), value=next(iter(EXAMPLES), None), label="Example apartment")
    text = gr.Textbox(value=next(iter(EXAMPLES.values()), ""), label="Apartment measurements (JSON)", lines=16)
    example.change(lambda name: EXAMPLES[name], inputs=example, outputs=text, api_visibility="private")
    button = gr.Button("Analyse and find twins", variant="primary")
    output = gr.JSON(label="Anomaly score, explanation, and matching apartments")
    button.click(predict, inputs=text, outputs=output, api_name="predict")
    gr.api(health, api_name="health")

if __name__ == "__main__":
    # Render supplies PORT; 7860 is convenient for local use.
    demo.queue(max_size=16, default_concurrency_limit=1).launch(
        server_name="0.0.0.0", server_port=int(os.environ.get("PORT", "7860")),
        show_error=True, allowed_paths=[],
    )
