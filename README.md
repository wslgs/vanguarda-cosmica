# Vanguarda Cósmica – Weather Intelligence

*A full‑stack, AI‑powered weather forecaster that blends trusted NASA POWER data with robust machine learning to fill gaps and predict the future.*

## 🚀 Why this project

Vanguarda Cósmica turns raw geospatial data into **actionable, trustworthy forecasts**. When official data is missing (very recent or future dates), the system trains an on‑the‑fly ensemble (SARIMAX, Gradient Boosting, Random Forest) over **6 years** of local history to generate accurate day‑ahead predictions — and exposes **clear confidence/accuracy** signals for users.

## ✨ Highlights

* **Smart Location Search**: Google Places autocomplete + geocoding.
* **Authoritative Data**: NASA POWER daily climate variables (temperature, wind, precipitation).
* **AI Ensemble**: Three complementary models with **auto-selection** per variable.
* **Accuracy Signals**: Frontend badges show % confidence derived from model RMSE; precipitation badges reflect the same heuristic percentage, while the raw **F1 score** is exposed in the API response.
* **Bilingual UX**: Full PT‑BR and EN support.
* **Interactive Visuals**: Clean charts for daily or hourly exploration.

## 🧠 AI System (Computational Power)

* **Parallel, async data ingestion** (httpx + asyncio) for fast multi‑year retrieval.
* **Feature engineering at scale**: vectorized lags/rolling stats (NumPy/Pandas) + cyclical time encoding.
* **Three model families**:

  * **SARIMAX**: seasonal time‑series with weekly seasonality for structure and trend.
  * **Gradient Boosting**: powerful, bias‑variance balanced regressor.
  * **Random Forest**: robust, low‑overfit baseline with parallel inference.
* **Model selection per variable**:

  * **Model choice**: currently selects whichever model yields the **lowest RMSE** for each variable. For precipitation we still report the F1 score, enabling future rule updates without breaking the schema.
  * **Confidence & Accuracy**:

    * **Temperature/Wind**: confidence % is derived from the chosen model’s **RMSE** via a linear heuristic (smaller RMSE ⇒ higher %).
    * **Precipitation occurrence**: UI confidence % uses the same heuristic; the exact **F1 score** is available in `ai_prediction.chosen.PRECTOTCORR.F1` for consumers that need classification metrics.
* **Resilience**: When remote data fails or is incomplete, a deterministic **synthetic climatology** generator preserves continuity for demos/dev, clearly flagged as synthetic.

## 🏗️ Architecture

* **Backend (`/backend`)**: FastAPI • httpx • Pandas/NumPy • scikit‑learn • statsmodels
* **Frontend (`/frontend`)**: React • Vite • Chart.js
* **Infra ready**: stateless API, simple to containerize; async I/O; CPU‑parallel tree models.

## 🔌 API Endpoints

* `POST /api/geocode` → free‑text place → `{ lat, lon }`
* `GET /api/place-autocomplete?q=...` → location suggestions
* `GET /api/weather-summary?lat=..&lon=..&start_date=YYYYMMDD[&end_date=YYYYMMDD][&hour_start=&hour_end=]` → unified weather summary

  * Uses NASA POWER when available; otherwise triggers AI prediction.

### Example (daily)

```bash
curl "http://localhost:8000/api/weather-summary?lat=-7.12&lon=-34.88&start_date=20251004"
```

Response (abridged):

```json
{
  "meta": { "service": "POWER", "units": {"T2M": "C", "WS10M": "m/s", "PRECTOT": "mm"} },
  "granularity": "daily",
  "data": [
    {
      "date": "2025-10-04",
      "t2m": 25.7,
      "t2m_max": 31.2,
      "t2m_min": 21.3,
      "ws10m": 5.6,
      "precip_mm": 1.8,
      "flags": { "rain_risk": false, "wind_caution": false, "heat_caution": false }
    }
  ]
}
```

### Hourly slice

```bash
curl "http://localhost:8000/api/weather-summary?lat=-7.12&lon=-34.86&date=20251004&hour_start=10&hour_end=13"
```

Returns an aggregated block **plus** the underlying hourly `series` for charting.

## 📊 Accuracy Display (Frontend)

Each variable renders a **purple badge** next to the metric:

* **Temperature**: `T:72%`
* **Wind**: `W:69%`
* **Precipitation (occurrence)**: `P:84%`

> The percentages are computed from the model selected per variable using the RMSE-based confidence heuristic. For precipitation, the UI shows the same heuristic %, while the precise F1 score is available via API/tooltips.

## ⚙️ Backend Setup

```bash
cp .env.example .env  # configure GOOGLE_MAPS_API_KEY and FRONTEND_ALLOWED_ORIGINS
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## 🖥️ Frontend Setup

```bash
cd frontend
npm install
cat <<'EOF' > .env.local
VITE_GOOGLE_MAPS_API_KEY=your-google-key
VITE_API_BASE=http://localhost:8000
EOF
npm run dev
```

Open `http://localhost:5173`.

## 🌐 GitHub Pages Deployment

> GitHub Pages serves only static files. Host the FastAPI backend elsewhere (Fly.io, Railway, Render, VPS, etc.) and expose it through `VITE_API_BASE`.

1. Configure HTTPS URLs in your `.env` (backend) and `frontend/.env.production` (served build). Example:

  ```bash
  # frontend/.env.production
  VITE_API_BASE=https://weather-api.example.com
  VITE_GOOGLE_MAPS_API_KEY=your-google-key
  ```

  ```bash
  # .env
  GOOGLE_MAPS_API_KEY=your-google-key
  FRONTEND_ALLOWED_ORIGINS=https://your-user.github.io/vanguarda-cosmica
  ```

2. In the repository **Settings → Pages**, select **Source: GitHub Actions**. This enables deployments produced by the workflow.
3. Push (or merge) into `main`. The workflow **Deploy Frontend to GitHub Pages** will:
  * install and build the React app from `/frontend`
  * publish `dist/` to the `github-pages` environment

4. Once the job succeeds, your site becomes available at `https://<github-user>.github.io/vanguarda-cosmica/` (the Vite build already uses the repository subpath). The workflow also supports manual re-deploys via **Actions → Deploy Frontend to GitHub Pages → Run workflow**.

## 🧪 Quick AI Test

Force a date likely to require AI prediction:

```bash
curl "http://localhost:8000/api/weather-summary?lat=-7.12&lon=-34.88&start_date=20251004&end_date=20251004"
```

Response includes:

* `ai_prediction.chosen` → best model per variable
* `data[0].accuracy` (UI‑level percentage badges derived from RMSE/F1)
* `meta.source = "AI Prediction"`

## 🔒 Reliability & Performance

* **Async I/O** for NASA POWER → faster multi‑year pulls.
* **Deterministic seeds** per (lat, lon) to stabilize synthetic fallbacks.
* **Temporal validation (60/40)** to avoid leakage; weekly seasonality in SARIMAX.
* **Vectorized features** (lags/rolling windows) for speed and reproducibility.
* **Graceful degradation**: even with missing remote data, the pipeline remains usable for demos and testing.

## 📈 Roadmap

* Walk‑forward cross‑validation (TimeSeriesSplit) for even stabler metrics.
* Probabilistic precipitation (Brier score, PR‑AUC) and calibrated probabilities.
* Conformal prediction intervals with empirical coverage reporting (e.g., 80/90%).
* Containerization + CI/CD (GitHub Actions) for one‑click deploys.
* Map extras: zoom presets, satellite layers, recent‑search history.

## 📦 Dependencies

**Backend**: `fastapi`, `uvicorn[standard]`, `httpx`, `pydantic`, `pandas`, `numpy`, `scikit-learn`, `statsmodels`

**Frontend**: `react`, `vite`, `chart.js`, `react-chartjs-2`
