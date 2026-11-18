Swiss Dwellings Acoustic Anomaly Detector & Quiet Twin Finder

**Team 5:** Breno Sader, Diego Alpizar, Sindhuja Davuluri, Soumyajyoti Datta

---

## Project Overview

We build an end-to-end AI tool for homebuyers, architects, and real-estate analysts using the **Swiss Dwellings v3.0.0** dataset ([Zenodo 7788422](https://zenodo.org/records/7788422), CC BY 4.0). By aggregating room-level environmental and geometric simulations into **24 apartment-level features** and training a tabular **Autoencoder (`DenseAE`, `latent_dim=8`)** on normal/quiet apartments, our system:
1. **Flags Acoustic & Contextual Anomalies:** Detects apartments with unusual traffic/train noise exposure and breaks down the reconstruction error $(x_i - \hat{x}_i)^2$ per feature category.
2. **Finds "Quiet Twins" in Latent Space:** Uses the 8-dimensional latent **Apartment Fingerprint** to rank reference apartments after filtering approximate area/count and selected noise, sun and view improvements. A match does not establish an identical floor plan or measured comfort.

---

## Links & Daily Milestones

| Milestone | Folder / Resource | Link |
|---|---|---|
| **Monday — Autoencoder** | `01_autoencoder/` | [`01_autoencoder/readme.md`](01_autoencoder/readme.md) |
| **Monday — Notebook** | `01_autoencoder/notebook/autoencoder.ipynb` | [`autoencoder.ipynb`](01_autoencoder/notebook/autoencoder.ipynb) |
| **Hugging Face Model** | `iaac-maai/hackathon-team5-swiss-dwellings` | [https://huggingface.co/iaac-maai/hackathon-team5-swiss-dwellings](https://huggingface.co/iaac-maai/hackathon-team5-swiss-dwellings) |
| **Tuesday - Model Server** | `02_model_server/` | [Server and API](02_model_server/readme.md) / [Live Render service](https://hackathon-team5-swiss-dwellings.onrender.com) |
| **Wednesday - Web App** | `03_app/` | [Cloudflare app and setup](03_app/README.md) / [Live Pages site](https://team5-swiss-dwellings.pages.dev) |
| **Thursday — Final Submission** | `04_final/` | *(Planned for Thursday)* |

---

## AI Usage Disclosure

| Question | Disclosure |
|---|---|
| **Tools** | Antigravity coding assistant; OpenAI Codex |
| **Why** | To inspect the 369-column `simulations.csv` schema quickly, design a room-to-apartment aggregation pipeline and review its remaining evaluation leakage, scaffold the PyTorch/ONNX comparison notebook, and troubleshoot local Anaconda environment package conflicts (`torch`, `onnxruntime`, `numpy<2`). |
| **Where** | **Monday (`01_autoencoder/`):** Schema inspection of `simulations.csv`, apartment-level aggregation code (`24` features), `DenseAE` vs. `Conv1DAE` training loop, visualization code (`figures/`), ONNX export wrapper, and initial README/Model Card structure. |
| **How** | We defined the domain problem (using a tabular autoencoder on Swiss Dwellings to identify noisy apartments and find similar quieter apartments) and reviewed the 369 simulation columns. We accepted the 24-feature aggregation across Acoustics, Daylight, Viewshed, and Layout, verified that splitting by `building_id` happens before `StandardScaler` fitting, and inspected the resulting ROC AUC (`0.7418`) and per-feature error attribution plots (`fig3`) to understand where global MSE succeeds and where non-acoustic layout outliers contribute to reconstruction error. |

**Lessons learned:** On a 24-feature multi-domain tabular dataset, training an autoencoder on normal/quiet apartments captures joint correlations between street view, window glazing perimeter, and noise; however, global MSE alone can be triggered by extreme geometric features (like huge window perimeters), making per-feature squared error decomposition essential for explainability.


## Wednesday implementation

The new [Cloudflare app](03_app/README.md) provides a password-protected numeric form, calls the existing Render model through a Pages Function, and saves complete analyses in D1 for history/replay. It carries the navy/slate design, original analysis colors and predefined question helper. No file uploads are used, so R2 is unnecessary. Pages and D1 are configured and deployed at https://team5-swiss-dwellings.pages.dev. Live login and D1 history work; the Render prediction connection returned HTTP 503 and requires troubleshooting before online prediction/storage can be confirmed.

**Wednesday AI use:** Codex adapted the course Cloudflare Pages example to the project's 24 apartment features, prepared the authentication/API/D1 handlers and frontend, generated the sequence diagram, and performed local checks. The team reviews the code and results, provides account/resource configuration and secrets privately, and completes production verification.
