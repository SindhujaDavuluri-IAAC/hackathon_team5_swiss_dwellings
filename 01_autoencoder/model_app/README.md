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

# Swiss Dwellings: autoencoder anomaly detector

Team 5 project for **AI Methods I, IAAC MaAI 2026/27**. This model learns patterns in apartment features and identifies profiles that differ from the apartments used for training. It also produces a compact numerical fingerprint that can be used to compare apartments.

**Team:** Breno Sader, Diego Alpizar, Sindhuja Davuluri, Soumyajyoti Datta.

**Model:** [Hugging Face repository](https://huggingface.co/iaac-maai/hackathon-team5-swiss-dwellings)  
**Notebook:** [autoencoder.ipynb](https://github.com/iaac-maai/hackathon-team5-swiss-dwellings/blob/main/01_autoencoder/notebook/autoencoder.ipynb)

## The autoencoder

| | |
|---|---|
| **Type** | Dense autoencoder: 24 inputs → 64 → 32 → 8-number fingerprint → 32 → 64 → 24 reconstructed inputs. |
| **Trained on** | 26,248 residential apartments from [Swiss Dwellings v3.0.0](https://zenodo.org/records/7788422) that were classified as normal using noise rules. |
| **Use** | Flag unusual combinations of apartment features and produce fingerprints for experimental similarity searches. |
| **Score** | Mean squared difference between the standardized input features and their reconstructions. |
| **Threshold** | **0.179895**, the 95th percentile of reconstruction errors for normal validation apartments. A score above this value is flagged. |
| **Test result** | ROC AUC **0.7418**, precision **0.8138**, and recall **0.2144** on a balanced evaluation set using noise-rule labels. |
| **Format** | ONNX (`anomaly_ae.onnx`), with a PyTorch state dictionary also provided. |
| **Notebook** | `01_autoencoder/notebook/autoencoder.ipynb` in the project repository. |

**Input:** 24 apartment-level features covering noise (8), sun (6), views (5), and layout (5). Features must be supplied in the exact order in `anomaly_ae_config.json`, with no missing or non-finite values. Standardize them using the saved means and scales: `(value - scaler_mean) / scaler_scale`. These are aggregates of room records; individual room rows cannot be used directly.

**Output:** The ONNX model returns a reconstruction of the 24 standardized inputs and an eight-number latent fingerprint. The reconstruction error and saved threshold can be used to calculate an anomaly flag. A fingerprint can be compared with fingerprints in a reference catalog to explore similar apartments.

The source dataset is **Swiss Dwellings v3.0.0** by Matthias Standfest et al. / Archilyse AG, [Zenodo DOI 10.5281/zenodo.7788422](https://doi.org/10.5281/zenodo.7788422), licensed CC BY 4.0. The training notebook aggregated residential room records into 44,195 complete apartments with at least two area records.

## Run it locally

Install the inference dependencies from this folder:

```bash
python -m pip install -r requirements.txt
```

Scoring an apartment requires the model, its configuration and 24 input values. It does not require the original dataset or PyTorch. Similarity search also needs a reference catalog.

## Call it from a program

Run the following from the folder containing the model files:

```python
import json
import numpy as np
import onnxruntime as ort

# Load the model's feature order, scaling values and anomaly threshold.
with open("anomaly_ae_config.json", encoding="utf-8") as file:
    config = json.load(file)

# Load one example apartment's raw, aggregated features.
with open("examples/quiet_apartment_1.json", encoding="utf-8") as file:
    apartment = json.load(file)

# Put the features in the order expected by the model and standardize them.
raw = np.array([[apartment["features"][name] for name in config["feature_names"]]], dtype=np.float64)
mean = np.array(config["scaler_mean"], dtype=np.float64)
scale = np.array(config["scaler_scale"], dtype=np.float64)
if not np.isfinite(raw).all() or not np.isfinite(mean).all() or not np.isfinite(scale).all() or (scale <= 0).any():
    raise ValueError("Features and scaling values must be finite, with positive scales.")
inputs = ((raw - mean) / scale).astype(np.float32)

# Reconstruct the input and produce the apartment fingerprint.
session = ort.InferenceSession("anomaly_ae.onnx", providers=["CPUExecutionProvider"])
reconstruction, fingerprint = session.run(
    ["reconstruction", "latent"], {session.get_inputs()[0].name: inputs}
)

# Compare the reconstruction error with the saved threshold.
score = float(np.mean((inputs - reconstruction) ** 2))
threshold = config["threshold"]
print({"score": score, "threshold": threshold, "is_anomaly": score > threshold,
       "fingerprint": fingerprint[0].tolist()})
```

## Files

| File | Contents |
|---|---|
| `README.md` | This model card. |
| `anomaly_ae.onnx` | Trained model, including reconstruction and fingerprint outputs. |
| `anomaly_ae.pt` | Trained PyTorch state dictionary. |
| `anomaly_ae_config.json` | Feature order, scaling values, anomaly threshold, and model metadata. |
| `examples/` | Example apartment feature inputs. |
| `requirements.txt` | Inference dependencies. |
| `full_apartments_catalog.npz` | Apartment features and fingerprints for experimental similarity search. |
| `quiet_twins_catalog.json` | Smaller reference catalog. |
| `fig1_training_curves.png`, `fig2_anomaly_histogram_roc.png`, `fig3_feature_breakdown_and_quiet_twins.png`, `fig4_reconstructions.png` | Training and evaluation illustrations; the reconstruction figure is from an earlier export. |

ONNX SHA-256: `884fb2b59c052b72862f0b07e9ef1b3c983c2d9e60494ae4738d35d2c24e77e3`. Keep the model, configuration and reference fingerprints from the same export together.

## Limitations

- The anomaly labels are based on noise percentiles in this dataset; they are not independently verified labels or Swiss regulatory limits. Noise is also among the model inputs.
- The balanced evaluation set does not represent real-world prevalence. Recall of **0.2144** means the model missed many apartments identified as noisy by the chosen rule.
- Normal apartments were split by building, but noisy evaluation apartments were sampled separately and may share buildings with training or validation apartments. Label thresholds were also calculated using the full dataset, so results may be optimistic.
- A high score can reflect unusual light, views or layout as well as noise; a low score does not guarantee a quiet apartment. Scores are not probabilities.
- Aggregation loses room roles and spatial arrangement. Similar fingerprints do not establish identical floor plans, availability, price or actual comfort. Similarity results have not been independently benchmarked.
- Noise means are arithmetic summaries of dBA, not energy-equivalent acoustic averages. The room count includes ancillary area records, and total area is not verified net living area. Scaler values and examples were rounded when exported.
- The catalog contains derived dataset measurements. Retain dataset attribution when sharing it; its object-array identifiers require pickle-enabled loading, so only load trusted copies.

## AI disclosure

Antigravity and OpenAI Codex assisted with code and documentation. The team is responsible for the model and its interpretation.

