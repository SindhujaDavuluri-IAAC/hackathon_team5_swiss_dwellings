# Monday — `01_autoencoder/`: Swiss Dwellings Noise Anomaly Detector & Quiet Twin Finder

**Team 5:** Breno Sader, Diego Alpizar, Sindhuja Davuluri, Soumyajyoti Datta  
**Hugging Face Model:** [`iaac-maai/hackathon-team5-swiss-dwellings-ae`](https://huggingface.co/iaac-maai/hackathon-team5-swiss-dwellings-ae)

---

## 1. Use Case

Homebuyers and real-estate analysts evaluating apartments often cannot tell from a listing whether an apartment suffers from **unusual environmental/traffic noise exposure**, or whether a **quieter alternative with the exact same spatial & daylight qualities ("Quiet Twin")** exists.

We train a tabular **Autoencoder (`DenseAE`, `latent_dim=8`)** on normal/quiet residential apartments from the **Swiss Dwellings** dataset:
1. **Anomaly Detection (Acoustic & Contextual Outliers):** Apartments with severe or contextually abnormal traffic/train noise are reconstructed poorly (`MSE > 0.1894`), and the **per-feature squared error** $(x_i - \hat{x}_i)^2$ explains *which* acoustic or contextual attributes triggered the alert.
2. **Latent Space "Quiet Twin" Similarity Search:** Using the encoder's 8-dimensional **Apartment Fingerprint**, we counterfactually set a noisy apartment's acoustic features to normal levels and retrieve the **Top 3 genuinely quiet apartments** that match its floor area, room count, solar exposure, and sky view.

---

## 2. Dataset

| Property | Details |
|---|---|
| **Dataset Name** | **Swiss Dwellings v3.0.0** (`simulations.csv`) |
| **Source & DOI** | Zenodo — [https://zenodo.org/records/7788422](https://zenodo.org/records/7788422) (`10.5281/zenodo.7788422`), curated by Archilyse AG |
| **Licence** | **CC BY 4.0** (Creative Commons Attribution 4.0 International) |
| **Raw Size** | `1.52 GB` (`simulations.csv`, ~370,000 room/area rows $\times$ 375 columns) |
| **Aggregated Dataset** | **~43,700 residential multi-room apartments $\times$ 24 features** grouped by `(site_id, building_id, apartment_id)` across 4 domains: **Acoustics/Noise** (8 cols), **Daylight/Sun** (6 cols), **Viewshed** (5 cols), and **Layout/Centrality** (5 cols) |

---

## 3. How to Run

1. Download `swiss-dwellings-v3.0.0.zip` from [Zenodo Record 7788422](https://zenodo.org/records/7788422) and place `simulations.csv` in the repository root `data/` folder (or leave the zip in `~/Downloads` — the notebook automatically extracts `simulations.csv` into `../../data/`).
2. Install dependencies from `01_autoencoder/`:
   ```bash
   pip install -r requirements.txt
   ```
3. Open and run [`notebook/autoencoder.ipynb`](notebook/autoencoder.ipynb) from top to bottom. It saves:
   - Plots to [`figures/`](figures/) and `models/`
   - `anomaly_ae.onnx` (`47.3 KB`), `anomaly_ae_config.json`, `quiet_twins_catalog.json`, and 4 example apartment JSONs to [`model_app/`](model_app/)

---

## 4. Setups Compared

All three architectures were trained for **35 epochs** (`batch_size=256`, `Adam(lr=1e-3)`, `RANDOM_STATE=42`) on the exact same `building_id`-grouped split of **normal/quiet apartments (`y = 0`)**, with the anomaly threshold fixed at the **95th percentile of normal validation MSE**:

| Setup | Architecture | Latent Dim | Parameters | Val MSE (Normal) | Test MSE (Normal) | Threshold (95th Val) | Test ROC AUC |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `DenseAE (latent=4)` | 4 | 7,540 | ~0.203 | ~0.203 | ~0.460 | ~0.71 |
| **2 (Selected)** | **`DenseAE (latent=8)`** | **8** | **7,800** | **0.074** | **0.074** | **0.1894** | **0.7585** |
| 3 | `Conv1DAE (latent=8)` | 8 | 8,929 | ~0.072 | ~0.072 | ~0.186 | ~0.75 |

**What we conclude:**
- **Bottleneck size (`4` vs. `8`):** Expanding the latent bottleneck from `4` to `8` dimensions cuts normal validation/test reconstruction error by more than 60% (`0.203` $\rightarrow$ `0.074`), because the 24 tabular features span 4 distinct physical dimensions (acoustics, solar radiation, viewshed, and layout) that need at least ~8 latent factors.
- **Dense vs. 1D Convolutional:** `DenseAE (latent=8)` achieves the same low reconstruction error and strong ROC AUC (`0.7585`) as `Conv1DAE (latent=8)` with fewer parameters (`7,800` vs. `8,929`) and simpler direct feature-to-feature connections.

---

## 5. Results & Figures

### Figure 1: Training & Validation Loss Curves
![Training Curves](figures/fig1_training_curves.png)

### Figure 2: Noise Anomaly Detection Histogram & ROC Curve (`ROC AUC = 0.758`)
![Anomaly Histogram and ROC](figures/fig2_anomaly_histogram_roc.png)

### Figure 3: Per-Feature Error Attribution & Top-3 "Quiet Twin" Similarity Search
![Feature Breakdown and Quiet Twins](figures/fig3_feature_breakdown_and_quiet_twins.png)

---

## 6. Limitations

1. **Global 24-Feature MSE Averaging:** Because the reconstruction error averages across all 24 features (only 8 of which are acoustic), an apartment with mildly elevated noise (`~52 dBA`) but completely average layout, sun, and viewshed can stay below the `0.1894` global MSE threshold. Conversely, an apartment with an extreme window perimeter or unusual street view can trigger a high global MSE even with moderate noise — which is why we also display the **per-feature error breakdown** $(x_i - \hat{x}_i)^2$.
2. **Room-Type Agnostic Aggregation:** Taking `.mean()` and `.max()` across all rooms in an apartment does not separate bedrooms from kitchens or balconies; a noisy balcony is much less disruptive than a noisy bedroom.
3. **Static Threshold Trade-off:** Choosing the 95th percentile on normal validation apartments fixes the false-positive rate on normal apartments at ~5%, trading off some recall on borderline noisy apartments.
