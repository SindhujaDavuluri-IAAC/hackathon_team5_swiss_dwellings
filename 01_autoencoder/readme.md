# Day 1: Swiss Dwellings Autoencoder

**Team 5:** Breno Sader, Diego Alpizar, Sindhuja Davuluri, Soumyajyoti Datta.

Train an autoencoder to flag unusual apartment profiles and explore candidate quieter apartments with similar
light, views and layout characteristics.

## Dataset

- **Source:** [Swiss Dwellings v3.0.0, Zenodo](https://zenodo.org/records/7788422), Matthias Standfest et al. / Archilyse AG. DOI: `10.5281/zenodo.7788422`.
- **Licence:** CC BY 4.0
- **Size:** approximately 932 MB ZIP; the saved run loaded 367,678 room/area records and retained 44,195 apartments.
- **Input:** 24 apartment-level features: acoustics (8), sun/daylight (6), views (5), and layout/centrality (5).
- **Local file:** `01_autoencoder/data/simulations.csv`. Training reads the local CSV; it does not stream from Zenodo.

Residential room/area records are grouped by `(site_id, building_id, apartment_id)`. Apartments with fewer than two
area records or missing aggregated features are removed. Area-record count is not an official habitable-room count.

## Setup

From `01_autoencoder/`, install the pinned training dependencies:

```bash
python -m pip install -r requirements.txt
```

Open [notebook/autoencoder.ipynb](notebook/autoencoder.ipynb), select that Python environment and run the cells in order.
Relative paths support the repository root, `01_autoencoder/`, and its `notebook/` folder.

All three setups use the same normal-apartment split and seed **42**, **35 epochs**, batch size **256**,
**Adam (learning rate 0.001)** and **MSE loss**. StandardScaler is fitted only on normal training apartments.
Each model's anomaly threshold is its normal-validation reconstruction error's 95th percentile.
Noise labels are percentile-rule proxies, not independently annotated ground truth.

The selected **DenseAE-8** uses an encoder `24 -> 64 -> 32 -> 8` and mirrored decoder, with ReLU hidden layers and
linear output. It returns a reconstruction and an eight-dimensional apartment fingerprint.
Exported ONNX weights, preprocessing configuration and examples are in `model_app/`; inference needs no original CSV
or PyTorch. The optional similarity catalogue remains a separate local artifact.

## Results

Recorded notebook results:

| Setup | Latent | Parameters | Train time (s) | Val MSE (normal) | Test MSE (normal) | ROC AUC | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| DenseAE-4 | 4 | 7,644 | 9.28 | 0.2174 | 0.2041 | 0.7310 | 0.7797 | 0.1209 |
| **DenseAE-8 (selected)** | **8** | **7,904** | **7.97** | **0.0720** | **0.0716** | **0.7418** | **0.8138** | **0.2144** |
| Conv1DAE-8 | 8 | 7,033 | 14.57 | 0.0791 | 0.0819 | 0.6967 | 0.7898 | 0.2056 |

DenseAE-8 achieves the lowest normal validation error and highest reported noise-rule ROC AUC in this run.
Its decision threshold is **0.179895**. Recall remains low: a low reconstruction score does not certify a quiet apartment.

**Training and validation loss**

![Training and validation curves](figures/fig1_training_curves.png)

**Observed and reconstructed saved examples**

![Observed versus reconstructed apartment features](figures/fig4_reconstructions.png)

**Limitations:** evaluation anomalies may share buildings with training normals, and noise-label cutoffs use the full
dataset. Metrics are preliminary and measured on an artificially balanced test set. Room aggregation loses spatial
arrangement; similarity has no explicit noise-improvement or layout/daylight guarantees. See the model card for details.

## Links

- [Published model and model card](https://huggingface.co/iaac-maai/hackathon-team5-swiss-dwellings)
- [Local model card source](models/README.md)
- [Training notebook](notebook/autoencoder.ipynb)
- [Pinned training requirements](requirements.txt)
- [Exported preprocessing configuration](model_app/anomaly_ae_config.json)
- [Example inputs](model_app/examples/)
- [Additional result figures](figures/)
- [Team GitHub repository](https://github.com/iaac-maai/hackathon-team5-swiss-dwellings)
- [Project overview and AI usage disclosure](../README.md)
