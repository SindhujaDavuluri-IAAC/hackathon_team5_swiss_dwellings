# Day 2: Quiet & Bright Twin Finder

**Team 5:** Breno Sader, Diego Alpizar, Sindhuja Davuluri, Soumyajyoti Datta.

**Hugging Face synchronization:** latest model and matching artifacts published on 17 November 2026 (commit `1f410d690ad7e6e6d46442e856f9232183542973`). All 15 release files were verified against local SHA-256 checksums. The local server checksum now matches this export.

**Public Render URL:** https://hackathon-team5-swiss-dwellings.onrender.com
Local address: http://127.0.0.1:7860. Local execution does not complete the public deployment requirement.

## What this server does

The server loads our own Day 1 DenseAE-8 model once and answers apartment requests using Gradio and ONNX Runtime on CPU. It flags unusual apartment profiles, explains the reconstruction errors, and searches for quieter, brighter apartments with comparable area and area-record count. It does not train a model or download the original dataset.

| Existing file | Purpose |
|---|---|
| `app.py` | Shared inference function, Gradio page, `/predict` and `/health` APIs |
| [`02_development.ipynb`](02_development.ipynb) | Full explained Tuesday walkthrough: architecture, server code, direct checks, local startup, API calls, Render setup and wake-up helper |
| [`call_api.ipynb`](call_api.ipynb) | Standalone submission caller: embedded apartment example, Gradio client and HTTP calls, printed URL/results; no local model files needed |
| `requirements.txt` | Pinned direct dependencies for server and callers |
| `render.yaml` | Build/start commands, Python version, free CPU service |
| `readme.md` | Deployment instructions, API contract, model explanation and limitations |

## How to use the two notebooks

The development notebook follows Tuesday sections **0, 1, and 2.1-2.7** of the course `02_deployment.ipynb`: setup, architecture, file roles, loading/preprocessing, page/API, direct prediction, local server, Python and HTTP clients, Render deployment and sleeping servers. Its code-view cells print the actual `app.py` sections, so the explanations stay tied to the implementation.

The submission caller is deliberately independent. It embeds one apartment example and checks `/health` before calling `/predict`. It can run from any folder with just the client packages and a reachable service URL. It never imports `app.py`, loads the catalog or retrains the model.

The new development notebook now has the valid filename **`02_development.ipynb`**; the comma in the original empty filename was corrected. Earlier local outputs were cleared from the development walkthrough when switching it to Render; the submission caller contains the verified live results. The standalone caller now contains saved live Render outputs. The development notebook can be rerun for a fresh walkthrough of the same service.

## Latest project changes reviewed

The current Day 1 notebook contains multi-domain twin search across all **44,195** retained apartments, and `model_app/full_apartments_catalog.npz` now supplies the complete derived feature table and fingerprints. Search targets lower acoustic measurements and higher sun/sky/greenery values while filtering area and area-record count. The saved example query is `2e4d7e256fa899bb4acc18722bceb95f`.

The published release remains DenseAE-8 with 24 inputs, threshold **0.179895**, and recorded ROC AUC **0.7418**. The model card and Day 1 README have been updated to the latest saved comparison. Server predictions use the exported model and configuration, not values copied from prose.

Two deliberate deployment improvements: catalog fingerprints are recomputed with the loaded ONNX, and search returns fewer matches when filters cannot be satisfied. The notebook's fallback to all normal apartments could otherwise return candidates that fail the requested goals. The Day 1 notebook was also updated at your request to export only into `model_app/`; duplicate model copies are no longer created.

## Dashboard interface

The Gradio page uses a responsive apartment comparison layout with a forest-green header and clear input/result panels.

1. Choose one of four saved apartment examples, labeled with area and floor.
2. Select lower daytime traffic noise, more equinox sunlight, and/or better sky/greenery views. Choose 1-5 matches.
3. Optionally expand **Review or edit the 24 measurements**; inputs are grouped into Acoustics, Sunlight, Views and Layout tabs and use original units.
4. Click **Analyse profile & find twins**. The result shows the anomaly verdict, score, threshold, domain-error bars and six largest feature mismatches.
5. Compare the twin cards with the query's measurements, or expand the comparison table. Full prediction details are available in a separate accordion.

Changing an apartment, preference or measurement clears the previous results so they cannot be mistaken for the new request. If no reference apartment meets every selected goal, the page shows a no-match message without relaxing filters.

The page calls `analyse_for_page`, which translates form controls into the existing `predict` JSON contract. The public `/predict` and `/health` APIs retain their names and response fields. UI changes require no model training or Hugging Face weight update.

Desktop and mobile Chrome checks passed, including analysis, preference changes, result reset, and a 390-pixel-wide layout without horizontal overflow. The dashboard and public API return the same example score (**0.369311**) and three twins. These checks cover the local dashboard; the redesigned page needs a Git push and Render redeployment before appearing at the public URL.

## Input and output

Input is **JSON text** with a `features` dictionary of all 24 apartment-level measurements in their original units. Use the feature names in the copyable example below or the Day 1 config. Do not send room rows, pre-scaled numbers, missing values, strings, or NaN/infinity. The model's area-record count includes kitchens, bathrooms and other areas; it is not an official habitable-room count.

Optional request fields:

| Field | Default | Meaning |
|---|---|---|
| `apartment_id` | omitted | Excludes the query ID from matches; identical measurements are also excluded |
| `top_k` | 3 | Return up to 1-5 matches |
| `improve_acoustics` | true | Indoor and window daytime traffic maxima each more than 10 dBA lower |
| `improve_sunlight` | true | Higher equinox-noon solar simulation value |
| `improve_view` | true | Higher sky view and at least equal greenery view |

All returned matches have normal **dataset noise-rule labels**, floor area within +/-25% and area-record count within +/-2. The acoustic filter does not guarantee lower train noise, and no filter guarantees an identical plan. An empty `twins` list is a valid outcome.

Output includes `score`, `threshold`, `is_anomaly`, `score_vs_threshold`, eight latent values, reconstructed measurements in original units, per-feature squared errors in standardized units, `twins`, `matching_candidates`, `search_note`, and `model_sha256`. Latent distance ranks eligible candidates and is not a physical distance or calibrated probability.

## Model and score explained

Swiss Dwellings v3.0.0 (Archilyse; CC BY 4.0) supplies room simulations aggregated into 24 apartment features: acoustics 8, sun 6, views 5, layout/context 5. DenseAE-8 uses encoder `24 -> 64 -> 32 -> 8` and decoder `8 -> 32 -> 64 -> 24`; hidden activations are ReLU and the final layer is linear.

Day 1 trained only normal apartments for 35 epochs with Adam (lr=0.001), batch size 256 and MSE. The training/validation split groups normal apartments by building. The server orders features using the saved list, applies the saved training mean and scale, and casts to float32. It never refits preprocessing.

The anomaly score is the mean of 24 squared differences between standardized input and reconstruction. Scores above the **95th-percentile normal-validation threshold (0.179895)** are flagged. A score/threshold ratio above 1 means flagged; it is not an anomaly probability or a dBA reading. A high per-feature error identifies a reconstruction mismatch, not a causal explanation.

Recorded DenseAE-8 results: normal validation MSE **0.0720**, normal test MSE **0.0716**, ROC AUC **0.7418**, precision **0.8138**, recall **0.2144**. These describe the Day 1 evaluation, not a new Day 2 experiment.

## Run locally

From the **repository root**, use the project Python environment:

```bash
python -m pip install -r 02_model_server/requirements.txt
python 02_model_server/app.py
```

Open http://127.0.0.1:7860. Choose a starting apartment, select improvement goals, optionally edit measurements, and press **Analyse profile & find twins**. Stop with Ctrl+C. While the terminal server remains running, open `call_api.ipynb` and run its cells to capture local API evidence. For the explained walkthrough, open `02_development.ipynb`; it can start and stop its own local server.

The server reads `01_autoencoder/model_app/`: config, examples and the full catalog. Local ONNX is used when present; otherwise the server downloads only `anomaly_ae.onnx` from the existing Hugging Face repository at pinned commit `1f410d690ad7e6e6d46442e856f9232183542973` into memory. Later uploads to `main` do not silently change this service. Its SHA-256 must match the reviewed export: `884fb2b59c052b72862f0b07e9ef1b3c983c2d9e60494ae4738d35d2c24e77e3`.

`MODEL_DIR` can override the artifact directory, but it must contain a matching complete bundle. The NPZ has pickled string identifiers from the team's trusted export: the server reads only this fixed file, never a user-uploaded NPZ. The server recomputes its fingerprints; it does not trust old saved latent vectors.

## Copy-and-run API example

Install `gradio_client==2.7.2`, start the local server, and run this Python example. Replace the URL with the actual Render address to call the online service. This example is self-contained and needs no local dataset or artifact file.

```python
import json
from gradio_client import Client

MODEL_URL = "https://hackathon-team5-swiss-dwellings.onrender.com"
payload = {
    "label": "Noisy Anomaly Apartment #1 (Street Traffic)",
    "site_id": 3879,
    "building_id": 6051,
    "apartment_id": "2e4d7e256fa899bb4acc18722bceb95f",
    "features": {
        "noise_traffic_day_mean": 31.1931,
        "noise_traffic_day_max": 69.0889,
        "noise_traffic_night_mean": 26.4584,
        "noise_traffic_night_max": 60.6665,
        "window_traffic_day_max": 76.639,
        "window_traffic_night_max": 68.2205,
        "noise_train_day_max": 56.3048,
        "window_train_day_max": 63.8077,
        "sun_equinox_noon_mean": 2.5265,
        "sun_equinox_afternoon_mean": 2.2957,
        "sun_summer_morning_mean": 1.7489,
        "sun_summer_noon_mean": 2.3607,
        "sun_summer_evening_mean": 2.0212,
        "sun_winter_noon_mean": 1.5689,
        "view_sky_mean": 0.0344,
        "view_greenery_mean": 0.0525,
        "view_buildings_mean": 0.005,
        "view_isovist_mean": 14983857.9624,
        "view_streets_mean": 0.0023,
        "apt_total_area": 99.0675,
        "apt_room_count": 9.0,
        "apt_floor_number": 4.0,
        "apt_window_perimeter": 11.4342,
        "apt_closeness_centrality": 0.0372
    }
}
payload.update(top_k=3, improve_acoustics=True, improve_sunlight=True, improve_view=True)
client = Client(MODEL_URL, verbose=False)
result = client.predict(json.dumps(payload), api_name="/predict")
print(json.dumps(result, indent=2))
```

Both notebooks implement ordinary HTTP: POST `/gradio_api/call/predict` with `{"data": [json.dumps(payload)]}`, then GET `/gradio_api/call/predict/<event_id>` and read the `event: complete` result. `/health` is a Gradio API called via `client.predict(api_name="/health")`; it is not a plain GET `/health` route. Render checks `/` for HTTP readiness.

## Deploy from this team repository

1. Make sure the matching ONNX is published to the existing [Hugging Face model repository](https://huggingface.co/iaac-maai/hackathon-team5-swiss-dwellings). Git ignores model weights, so Render obtains them from Hugging Face. Commit the config, examples, full NPZ and these Day 2 files to the team GitHub repository.
2. In Render choose **New > Blueprint**, select the existing repository, and set Blueprint Path to `02_model_server/render.yaml`. Leave Root Directory blank. This deployment reads both day folders and needs no duplicate model folder or separate server repository.
3. Follow build and runtime logs. Settings are Python 3.12.8, build `pip install -r 02_model_server/requirements.txt`, start `python 02_model_server/app.py`, plan `free`. The app binds `0.0.0.0` and Render's `PORT`.
4. Copy the assigned public URL from the dashboard to the top of this README and to `MODEL_URL` in both notebooks (or set the environment variable). Run `call_api.ipynb` against it and save the outputs. Do not label local outputs as online evidence.
5. Push the final reviewed files to `main` before **Wednesday 18 November 2026, 10:00 Europe/Madrid**.

Render's free service sleeps after **15 minutes** of inactivity. The first request can take **about one minute** to wake it; both notebooks have a retry helper. Wake it before presenting.

If startup says hash mismatch, the remote ONNX does not match this bundle. Publish the matching export; do not disable the check. Missing catalog/config errors indicate wrong paths or uncommitted artifacts. Invalid input errors identify missing or malformed features.

## Limitations

Noise labels are percentile-based proxies rather than independently measured ground truth. Label cutoffs use the full dataset, and held-out anomalies may share buildings with training normals, so reported evaluation has leakage limitations. Precision was measured on a balanced test set and may change in real use. Low recall means a normal result does not certify quietness. Features lose room arrangement; daylight/sun proxies are not a complete lighting assessment. Catalog apartments are historical examples, not live listings.

The Day 2 server is deployed as a public Tuesday model API. Its live health and prediction calls were verified on 17 November 2026. Password protection, database storage and the Cloudflare app belong to Wednesday's submission.

## Submission status and links

- **Verified locally:** all four examples, direct inference, Gradio client, HTTP event-stream caller, and invalid-input handling. The three call methods agree on score **0.369311** for the saved noisy query and return the same three twins. See executed `call_api.ipynb` outputs.
- Tested ONNX Runtime **1.20.1**; the course example version 1.31.1 caused a Windows native import crash here. The pinned environment passes `pip check`.
- **Verified online on 17 November 2026:** https://hackathon-team5-swiss-dwellings.onrender.com. `/health` confirms the published model checksum and release; `call_api.ipynb` contains successful Gradio client and HTTP predictions with matching score **0.369311** and the same three twins.
- [Development walkthrough](02_development.ipynb)
- [Submission API caller](call_api.ipynb)
- [Day 1 notebook](../01_autoencoder/notebook/autoencoder.ipynb)
- [Exported model config](../01_autoencoder/model_app/anomaly_ae_config.json)
- [Existing model card](../01_autoencoder/model_app/README.md)
- [Hugging Face model](https://huggingface.co/iaac-maai/hackathon-team5-swiss-dwellings)
- [Team GitHub repository](https://github.com/iaac-maai/hackathon-team5-swiss-dwellings)
- [Render Blueprint reference](https://render.com/docs/blueprint-spec)

**AI use:** Codex reviewed the updated artifacts and course Tuesday instructions and adapted the course Tuesday sections into `02_development.ipynb`, updated the existing server/caller files, and ran local checks. The empty `02_development,ipynb` file was renamed to a valid `.ipynb` extension. The team reviews the code, confirms live Render calls, and supplies the public URL. No additional submission folders were created.
