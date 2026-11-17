# Team 5 Changelog — Multi-Domain & Full-Database Upgrade (`01_autoencoder/`)

**Date:** Tuesday, 17 November 2026  
**Summary for Teammates:** This log documents the targeted enhancements made to `01_autoencoder/notebook/autoencoder.ipynb`, `fig3_feature_breakdown_and_quiet_twins.png`, and `01_autoencoder/model_app/full_apartments_catalog.npz` on top of commit `9666f1e` (PR #4).

---

## 1. What Did NOT Change (Zero Breaking Changes)

- **Trained Model Weights & Config Are Untouched:** `anomaly_ae.onnx`, `anomaly_ae.pt`, and `anomaly_ae_config.json` (`threshold = 0.179895`, `test_roc_auc = 0.7418`) were **not** retrained or modified. They remain 100% identical to what is published on Hugging Face (`iaac-maai/hackathon-team5-swiss-dwellings`).
- **Existing READMEs & Figures 1, 2, 4 Are Untouched:** `README.md`, `01_autoencoder/readme.md`, `01_autoencoder/model_app/README.md`, `fig1_training_curves.png`, `fig2_anomaly_histogram_roc.png`, and `fig4_reconstructions.png` are unchanged.

---

## 2. What Changed & Why

### Change 1: Expanded Similarity Search from `300` Sample $\rightarrow$ Full Database (`44,195` Apartments)
- **What changed:**
  - In **Block 9 (`cell-010`)** of `autoencoder.ipynb`, we now encode all **`44,195` residential apartments** (`X_all` $\rightarrow$ `Z_all` of shape `(44195, 8)`) instead of searching only the 300-apartment subset.
  - In **Block 10 (`cell-011`)**, we export `01_autoencoder/model_app/full_apartments_catalog.npz` (`5.2 MB` compressed NumPy archive containing all `44,195` apartment IDs, building IDs, 24 raw features, and 8D latent vectors), while keeping `quiet_twins_catalog.json` (`300` apartments) for backwards compatibility.
- **Why:**
  - Encoding all 44,195 apartments takes `< 0.1s` offline, and querying all 44,195 apartments takes `~2 ms` in NumPy using only `~6 MB` of RAM on Render. Searching the full dataset gives much closer spatial twins when filtering across multiple criteria.

---

### Change 2: Multi-Domain "Better Twin" Search (Acoustics + Sunlight + Viewshed)
- **What changed:**
  - In **Block 9 (`cell-010`)**, we replaced the single-purpose noise search with a generalizable function:
    ```python
    find_better_twins(
        query_scaled,
        query_raw_row,
        improve_acoustics=True,
        improve_sunlight=True,
        improve_view=True,
        top_k=3,
    )
    ```
  - It steers whichever domain(s) are enabled (`Acoustics` $\rightarrow -0.5\sigma$, `Sunlight` $\rightarrow +0.8\sigma$, `Viewshed` $\rightarrow +0.8\sigma$) while locking the **Spatial Layout** (`apt_total_area` within $\pm 25\%$ and `apt_room_count` within $\pm 2$ rooms), encodes the counterfactual target into 8D latent space, and filters for normal apartments in the 44,195-apartment database that genuinely improve the selected domains.
- **Why:**
  - Directly addresses the limitation noted in our Monday Model Card (*"It does not enforce equal area, room count, daylight or a specified noise reduction"*).
  - Unlocks a much richer feature for our **Tuesday Model Server (`02_model_server/`)** and **Wednesday/Thursday Web App (`03_app/`)**: users can now search for spatial twins that are **Quieter**, **Sunnier**, have a **Better View**, or **any combination of the three**.

---

### Change 3: 4-Color Domain Breakdown & Acoustic-Driven Query Example in `fig3`
- **What changed:**
  - Updated `01_autoencoder/figures/fig3_feature_breakdown_and_quiet_twins.png` and `01_autoencoder/model_app/fig3_feature_breakdown_and_quiet_twins.png` (and the embedded output in `cell-010`):
    - **Left Panel:** Color-codes all 24 features by their 4 domains with a legend:
      - **Red (`#e53e3e`):** Acoustics / Noise (`8 features`)
      - **Amber (`#dd6b20`):** Sunlight / Daylight (`6 features`)
      - **Green (`#38a169`):** Viewshed (`5 features`)
      - **Blue (`#3182ce`):** Layout & Centrality (`5 features`)
    - **Query Selection:** Selects a flagged apartment (`f500821caf424e8ab0bccc7cd02b8b57`, `MSE = 0.39 > 0.19`) where the **8 Red Acoustic bars** clearly drive the anomaly, rather than an 18-room layout outlier.
    - **Right Panel & Table:** Shows the Top 3 **Better Twins** matching layout (`~66–84 m²`, `6–9 rooms` vs. query's `75.2 m²`, `8 rooms`) while simultaneously improving **Acoustics** (`68.8 dBA` $\rightarrow$ `30.9–47.3 dBA`), **Equinox Sunlight** (`3.41` $\rightarrow$ `4.36`), **Sky View** (`0.048` $\rightarrow$ `0.049–0.057`), and **Greenery View** (`0.044` $\rightarrow$ `0.045–0.051`).
- **Why:**
  - Makes `fig3` visually self-explanatory for slides and finals, clearly separating the 4 built-environment domains.

---

### Change 4: Synchronized Numbers in `cell-007b` (`## Interpretation of Setup Comparison`)
- **What changed:**
  - Updated the inline numbers in the `cell-007b` Markdown text inside `autoencoder.ipynb` (`Val MSE` `0.2174` $\rightarrow$ `0.0720`, `Test MSE` `0.2041` $\rightarrow$ `0.0716`, `Train Time` `14.57s` vs. `7.97s`, `ROC AUC = 0.7418`, `Precision = 0.8138`, `Recall = 0.2144`, `Threshold = 0.1799`).
- **Why:**
  - Ensures the written interpretation paragraph in `autoencoder.ipynb` matches the exact numbers in the Block 6 comparison table right above it and in `readme.md` / `model_app/README.md`.
