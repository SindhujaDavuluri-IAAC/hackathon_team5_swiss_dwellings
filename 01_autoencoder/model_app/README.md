---
license: cc-by-4.0
tags:
- autoencoder
- anomaly-detection
- tabular
- onnx
- built-environment
- swiss-dwellings
---

# Swiss Dwellings: autoencoder anomaly detector and Quiet Twin Finder

Team 5 project for **AI Methods I, IAAC MaAI 2026/27**.
The model scores apartment-level environmental/layout features and produces an eight-number apartment fingerprint.
Homebuyers and real-estate analysts can inspect unusual profiles and explore potentially quieter alternatives.

**Team:** Breno Sader, Diego Alpizar, Sindhuja Davuluri, Soumyajyoti Datta.

**Code:** [https://github.com/iaac-maai/hackathon-team5-swiss-dwellings](https://github.com/iaac-maai/hackathon_team5_swiss_dwellings)
**Model:** [Hugging Face repository](https://huggingface.co/iaac-maai/hackathon_team5_swiss_dwellings)
**Notebook:** [01_autoencoder/notebook/autoencoder.ipynb](https://github.com/iaac-maai/hackathon_team5_swiss_dwellings/blob/main/01_autoencoder/notebook/autoencoder.ipynb)

## The autoencoder

| | |
|---|---|
| **Type** | Dense tabular autoencoder. Encoder: 24 -> 64 -> 32 -> 8; decoder: 8 -> 32 -> 64 -> 24; ReLU between hidden layers, linear decoder output. |
| **Trained on** | Swiss Dwellings v3.0.0: 26,248 rule-normal residential apartments; 24 features across acoustics, sun, views and layout. |
| **Use** | Reconstruction-error anomaly detection; experimental similarity search using the 8-dimensional latent vector. |
| **Score** | Mean squared error between the standardized input and reconstruction, averaged across all 24 features. |
| **Threshold** | **0.179895**, the 95th percentile of normal validation error, stored in `anomaly_ae_config.json`. |
| **Test result** | Noise-rule ROC AUC **0.7418**, precision **0.8138**, recall **0.2144**, on a balanced test set. These are preliminary proxy-label metrics; see limitations. |
| **Format** | `anomaly_ae.onnx`, 48,788 bytes, run with CPU ONNX Runtime; PyTorch is unnecessary for inference. |
| **Notebook** | Linked above; saved outputs record the training comparison and five-sample PyTorch/ONNX score agreement. |

**Input:** 24 finite **apartment-level aggregates**, ordered exactly as `config["feature_names"]`.
Apply `(raw - scaler_mean) / scaler_scale` using the exported configuration. The scaler was fitted on normal
training apartments only. Raw room CSV rows cannot be passed directly to this model. Reject missing or nonfinite values;
do not fit a replacement scaler. Stored scaler vectors and example features were rounded by the exporter.

**Output:** ONNX returns `reconstruction` with shape `(batch, 24)` and `latent` with shape `(batch, 8)`.
Application code computes `score`, `threshold`, `is_anomaly`, `score / threshold` and per-feature squared errors.
An error contribution is not a causal explanation or a probability of a defect.

## Dataset

**Swiss Dwellings v3.0.0**, Matthias Standfest et al. / Archilyse AG.
[Source: Zenodo 7788422](https://zenodo.org/records/7788422), DOI **10.5281/zenodo.7788422**.

The published dataset describes 45,176 apartments and approximately 370,000 rooms, distributed in an approximately
932 MB ZIP. The saved run read **367,678 room/area records** from `simulations.csv` (reported as 1,521 MB) and retained
**44,195 apartments** with at least two area records and complete aggregated features.
Grouping keys are `(site_id, building_id, apartment_id)` after residential filtering.

| Feature group | Apartment-level features |
|---|---|
| Acoustics: 8 | Traffic day/night means and maxima, window traffic day/night maxima, daytime train and window-train maxima |
| Sun: 6 | Mean illuminance at equinox noon/afternoon, summer morning/noon/evening, winter noon |
| Views: 5 | Sky, greenery, buildings, isovist and combined street views |
| Layout/centrality: 5 | Summed area, area-record count, mean floor number, summed window perimeter, mean closeness centrality |

Noise means are arithmetic summaries of dBA, not energy-equivalent acoustic averages. `apt_room_count` counts area records
(including ancillary spaces); summed `layout_area` is not independently verified net living area.
Training requires the original simulations; inference needs only this model, its configuration and user feature values.
The current training notebook reads a local CSV rather than streaming directly from Zenodo.

## Training setup and comparison

All setups used seed 42, 35 epochs, batch size 256, Adam at 0.001 and MSE loss on the same normal training/validation split.
Normal validation contains **5,666 apartments**. Evaluation contains **5,648 normals plus 5,648 noisy-rule apartments**.
Each model uses its own normal-validation 95th-percentile reconstruction threshold.

The labels are **noise-rule proxies**, not independently annotated ground truth: indoor daytime traffic above the
full-dataset 90th percentile, window daytime traffic above the 92nd, or indoor daytime train noise above the 95th.
Their union flags **6,633 apartments (15%)**. These percentile rules are not Swiss regulatory limits.

Values below come from the latest saved notebook outputs; preparing this card does not retrain the model.

| Setup | Latent | Params | Train time (s) | Val MSE (normal) | Test MSE (normal) | Threshold | Test ROC AUC | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| DenseAE-4 | 4 | 7,644 | 9.28 | 0.2174 | 0.2041 | 0.6154 | 0.7310 | 0.7797 | 0.1209 |
| **DenseAE-8 (selected)** | **8** | **7,904** | **7.97** | **0.0720** | **0.0716** | **0.1799** | **0.7418** | **0.8138** | **0.2144** |
| Conv1DAE-8 | 8 | 7,033 | 14.57 | 0.0791 | 0.0819 | 0.1899 | 0.6967 | 0.7898 | 0.2056 |

DenseAE-8 has the lowest normal validation MSE and the highest reported noise-rule ROC AUC in this run.
Its validation MSE falls from 0.2174 to 0.0720 compared with DenseAE-4, and its recorded training time is shorter than Conv1DAE-8.
However, recall is only 0.2144 at the chosen threshold, so it misses many rule-noisy apartments despite precision of 0.8138.
These results support a small experimental model, with leakage and independent validation still unresolved.

## Results and figures

### Training and normal-validation reconstruction loss

![Training and validation curves](fig1_training_curves.png)

Compare validation with training loss to assess convergence and the gap between them. The numerical comparison above
reports held-out normal error separately from noisy-rule detection performance.

### Observed features and model reconstructions

![Observed versus reconstructed quiet-rule and noisy-rule examples](fig4_reconstructions.png)

The figure runs the exported ONNX model on two saved apartment examples using the stored scaler configuration.
It compares all 24 observed and reconstructed standardized values. These are descriptive examples, not a new independent
test set. The first eight positions are acoustic features; mismatches elsewhere can also drive an anomaly score.

### Noise-rule anomaly scores and ROC

![Score distribution and ROC curve](fig2_anomaly_histogram_roc.png)

AUC describes ranking across thresholds; the selected decision threshold still has low recall, as shown in the table.

### Error contributions and similarity demonstration

![Per-feature errors and candidate apartment comparison](fig3_feature_breakdown_and_quiet_twins.png)

The prototype replaces eight standardized noise inputs with zero, the normal training **mean**, then encodes the target
and searches a local 300-apartment catalogue. It does not enforce equal area, room count, daylight or a specified noise
reduction. Treat its outputs as candidates for review, not proven quiet twins. The optional catalogue is not published
in this model-card compliance update; it remains in the local Day 1 export.

## Run it locally

Download the model, configuration and an example using the short script below. Install the pinned inference dependencies:

```bash
python -m pip install -r requirements.txt
```

The published `requirements.txt` is for **inference**, with NumPy, ONNX Runtime and huggingface_hub.
Training dependencies remain in `01_autoencoder/requirements.txt` in the code repository.
The ONNX graph is small enough for CPU use. Original CSVs, the full ZIP, scikit-learn and PyTorch are unnecessary
for scoring a new apartment. A valid 24-feature input is still required.

## Call it from a program

This is direct model inference, not a call to an already deployed HTTP API.

```python
import json
import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download

repo_id = "iaac-maai/hackathon-team5-swiss-dwellings"
model_path = hf_hub_download(repo_id, "anomaly_ae.onnx")
config_path = hf_hub_download(repo_id, "anomaly_ae_config.json")
example_path = hf_hub_download(repo_id, "examples/quiet_apartment_1.json")
with open(config_path, encoding="utf-8") as f:
    config = json.load(f)
with open(example_path, encoding="utf-8") as f:
    apartment = json.load(f)

raw = np.array([[apartment["features"][name] for name in config["feature_names"]]], dtype=np.float64)
mean = np.array(config["scaler_mean"], dtype=np.float64)
scale = np.array(config["scaler_scale"], dtype=np.float64)
if not np.isfinite(raw).all() or not np.isfinite(mean).all() or not np.isfinite(scale).all() or (scale <= 0).any():
    raise ValueError("All features and scaler values must be finite, and scales positive.")
x = ((raw - mean) / scale).astype(np.float32)
session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
reconstruction, latent = session.run(None, {"features": x})
feature_error = (x - reconstruction)**2
score = feature_error.mean(axis=1)
threshold = config["threshold"]
print({"score": score.tolist(), "threshold": threshold,
       "is_anomaly": (score > threshold).tolist(),
       "score_multiple": (score / threshold).tolist(), "latent": latent.tolist()})
```

## Files

| File | Contents |
|---|---|
| `README.md` | This model card |
| `anomaly_ae.onnx` | Architecture and weights; reconstruction and latent outputs |
| `anomaly_ae_config.json` | Ordered input features, stored scaler arrays, threshold, latent size and recorded AUC |
| `examples/` | Four apartment-level JSON inputs, retaining CC BY 4.0 attribution |
| `requirements.txt` | Pinned inference dependencies |
| `fig1_training_curves.png` | Three-model training/validation curves |
| `fig4_reconstructions.png` | Observed/reconstructed saved-example feature profiles |
| `fig2_anomaly_histogram_roc.png` | Noise-rule score histogram and ROC |
| `fig3_feature_breakdown_and_quiet_twins.png` | Error contributions and experimental candidate comparison |

Local-only companion exports include PyTorch `anomaly_ae.pt` and the optional `quiet_twins_catalog.json`.
No full dataset, credentials or future-day server implementation is part of this publication.

## Limitations

1. **Evaluation leakage remains unresolved.** Normal apartments are split by building, but anomalies are sampled
   separately from all noisy apartments, so evaluation anomalies can share buildings with training/validation normals.
   Label cutoffs use the full dataset. The reported scores are preliminary, not a fully building-independent evaluation.
   Split all buildings before calibrating labels in a future experiment.
2. **Proxy labels and prevalence.** Noise is both an input and the basis of the label rule; AUC is not independent
   real-world anomaly accuracy. Precision on a 50/50 balanced evaluation set does not establish deployment precision.
3. **Missed noisy apartments.** Recall is 0.2144. A low score does not certify a quiet apartment, and a high score
   can result from unusual geometry or views. The 95th-percentile rule targets roughly 5% of validation normals;
   it does not guarantee a 5% false-positive rate on new buildings.
4. **Aggregation and similarity.** Room roles/spatial arrangement are lost. The catalogue comes from normal test
   apartments, so retrieval needs a separate reference catalogue and independent evaluation. There are no strict
   daylight/layout/noise-improvement filters, nor evidence about listings, price or perceived comfort.
5. **Export precision.** Stored scaler arrays/examples are rounded. Saved notebook outputs show five-sample
   PyTorch/ONNX score agreement, not coverage of every possible input. Validate missing values and schema at serving time.

## AI disclosure

Antigravity, and OpenAI Codex assisted with code and documentation to follow the class example and submission guidelines. The root GitHub README contains the project-wide AI disclosure; the team owns its
interpretation and final submission.
