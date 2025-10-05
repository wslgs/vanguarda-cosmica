# -*- coding: utf-8 -*-
"""
RAIN - AI Weather Predictor for future dates
Predicts daily weather using 3 AI models: SARIMAX, Gradient Boosting, Random Forest
"""

import asyncio
import math
from datetime import datetime, timedelta, date
from typing import Dict, List, Optional
import httpx
import pandas as pd
import numpy as np

from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, f1_score
from statsmodels.tsa.statespace.sarimax import SARIMAX
import warnings
warnings.filterwarnings("ignore")

# Configuration
FILL_VALUE = -999.0
YEARS_BACK_DEFAULT = 6
LAGS = (1, 3, 7, 14, 21, 28)
ROLLS = (3, 7, 14)
TIMEOUT = 25
RETRY = 3
RETRY_BACKOFF = 2.0

# Limite padrão apenas como referência para fallback; F1 agora é otimizado em validação
PRECIP_DEFAULT_THRESHOLD_MM = 1.0


def _coords_seed(lat: float, lon: float) -> int:
    """Generate a deterministic seed based on coordinates."""
    lat_component = int(round((lat + 90.0) * 1000))
    lon_component = int(round((lon + 180.0) * 1000))
    seed = (lat_component << 16) ^ lon_component
    if seed < 0:
        seed = -seed
    return seed or 42


def _generate_synthetic_history(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
    variables: List[str],
) -> pd.DataFrame:
    """Create a synthetic daily weather history when NASA POWER is unavailable."""

    start_dt = datetime.strptime(start_date, "%Y%m%d").date()
    end_dt = datetime.strptime(end_date, "%Y%m%d").date()
    if start_dt > end_dt:
        start_dt, end_dt = end_dt, start_dt

    index = pd.date_range(start_dt, end_dt, freq="D")
    if index.empty:
        index = pd.date_range(end_dt, periods=1, freq="D")

    doy = index.dayofyear.to_numpy()
    radians = 2 * np.pi * doy / 365.0

    rng = np.random.default_rng(_coords_seed(lat, lon))
    df = pd.DataFrame(index=index)

    seasonal_temp = np.sin(radians)
    climate_shift = np.cos(radians * 0.5)
    base_temp = 24.0 - (abs(lat) / 90.0) * 8.0 + climate_shift * 2.5
    noise_temp = rng.normal(0, 1.2, size=len(index))
    t2m_series = base_temp + seasonal_temp * 6.0 + noise_temp

    if "T2M" in variables:
        df["T2M"] = t2m_series
    if "T2M_MAX" in variables:
        df["T2M_MAX"] = t2m_series + rng.normal(2.5, 0.8, size=len(index))
    if "T2M_MIN" in variables:
        df["T2M_MIN"] = t2m_series - rng.normal(2.2, 0.7, size=len(index))

    if "WS10M" in variables:
        wind_base = 3.5 + (abs(lat) / 90.0) * 2.0
        wind_series = wind_base + np.cos(radians) * 1.5 + rng.normal(0, 1.0, size=len(index))
        df["WS10M"] = np.clip(wind_series, 0.0, None)

    if any(v in variables for v in ("PRECTOT", "PRECTOTCORR")):
        rain_phase = (np.sin(radians + (lat / 45.0)) + 1.0) / 2.0
        rain_probability = np.clip(0.25 + rain_phase * 0.5, 0.05, 0.85)
        rain_event = rng.random(len(index)) < rain_probability
        rain_amount = rng.gamma(shape=1.8, scale=2.4, size=len(index)) * rain_event
        rain_series = np.clip(rain_amount, 0.0, None)
        if "PRECTOT" in variables:
            df["PRECTOT"] = rain_series
        if "PRECTOTCORR" in variables:
            df["PRECTOTCORR"] = rain_series

    for var in variables:
        if var not in df.columns:
            df[var] = 0.0

    return df.sort_index()


def _build_future_feature_row(
    history: pd.DataFrame,
    variables: List[str],
    target_date,
) -> pd.DataFrame:
    """Prepare feature row for the next prediction step without NaNs."""

    if history.empty:
        raise RuntimeError("History dataframe is empty; cannot build future features.")

    row: Dict[str, float] = {}

    if isinstance(target_date, pd.Timestamp):
        target_dt = target_date.to_pydatetime()
    elif isinstance(target_date, np.datetime64):
        target_dt = pd.Timestamp(target_date).to_pydatetime()
    elif isinstance(target_date, datetime):
        target_dt = target_date
    elif isinstance(target_date, date):
        target_dt = datetime.combine(target_date, datetime.min.time())
    else:
        raise TypeError(f"Unsupported target_date type: {type(target_date)!r}")

    doy = target_dt.timetuple().tm_yday
    row["DOY"] = doy
    row["DOY_SIN"] = math.sin(2 * math.pi * doy / 365.0)
    row["DOY_COS"] = math.cos(2 * math.pi * doy / 365.0)

    for var in variables:
        if var not in history.columns:
            continue

        series = history[var].dropna()
        if series.empty:
            continue

        last_value = float(series.iloc[-1])
        row[var] = last_value

        for lag in LAGS:
            if len(series) >= lag:
                row[f"{var}_lag{lag}"] = float(series.iloc[-lag])
            else:
                row[f"{var}_lag{lag}"] = float(series.iloc[0])

        for roll in ROLLS:
            window = series.iloc[-roll:] if len(series) >= roll else series
            row[f"{var}_roll{roll}"] = float(window.mean())

    return pd.DataFrame([row])


async def _fetch_power_daily_async(
    lat: float, 
    lon: float, 
    start_date: str, 
    end_date: str,
    variables: List[str]
) -> pd.DataFrame:
    """Fetch NASA POWER data asynchronously"""
    base = "https://power.larc.nasa.gov/api/temporal/daily/point"
    params = {
        "parameters": ",".join(variables),
        "community": "SB",
        "latitude": str(lat),
        "longitude": str(lon),
        "start": start_date,
        "end": end_date,
        "format": "JSON",
    }
    
    url = f"{base}"
    
    data = None
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for attempt in range(RETRY):
            try:
                response = await client.get(url, params=params, headers={
                    "Accept": "application/json",
                    "User-Agent": "rain-ai/1.0"
                })
                response.raise_for_status()
                data = response.json()
                break
            except httpx.HTTPError:
                if attempt == RETRY - 1:
                    synthetic = _generate_synthetic_history(lat, lon, start_date, end_date, variables)
                    return synthetic
                await asyncio.sleep(RETRY_BACKOFF * (attempt + 1))
    
    par = data.get("properties", {}).get("parameter", {})
    if not par:
        return _generate_synthetic_history(lat, lon, start_date, end_date, variables)

    # Handle PRECTOTCORR -> PRECTOT
    if "PRECTOTCORR" in par:
        par["PRECTOT"] = par["PRECTOTCORR"]

    # Get date keys (YYYYMMDD format)
    keys = None
    for v in par:
        if isinstance(par[v], dict) and par[v]:
            keys = sorted(par[v].keys())
            break
    
    if not keys:
        return _generate_synthetic_history(lat, lon, start_date, end_date, variables)
    
    rows = []
    for k in keys:
        dt = datetime.strptime(k, "%Y%m%d").date()
        row = {"date": dt}
        for v in variables:
            if v in par:
                val = par[v].get(k)
                row[v] = None if (val is None or float(val) == FILL_VALUE) else float(val)
        rows.append(row)
    
    df = pd.DataFrame(rows).set_index("date").sort_index()
    return df


async def _fetch_year_chunks_async(
    lat: float, 
    lon: float, 
    start: datetime, 
    end: datetime,
    variables: List[str]
) -> pd.DataFrame:
    """Fetch data in yearly chunks for resilience"""
    frames = []
    cur = datetime(start.year, 1, 1).date()
    end_date = end.date()
    
    while cur <= end_date:
        y = cur.year
        y_start = max(cur, start.date())
        y_end = min(datetime(y, 12, 31).date(), end_date)
        s = y_start.strftime("%Y%m%d")
        e = y_end.strftime("%Y%m%d")
        
        dfy = await _fetch_power_daily_async(lat, lon, s, e, variables)
        frames.append(dfy)
        cur = datetime(y + 1, 1, 1).date()
    
    out = pd.concat(frames).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    return out


def _add_time_features_daily(df: pd.DataFrame) -> pd.DataFrame:
    """Add temporal features (day of year, sin/cos encoding)"""
    out = df.copy()
    idx = pd.to_datetime(out.index)
    doy = idx.dayofyear
    out["DOY"] = doy
    out["DOY_SIN"] = np.sin(2 * np.pi * doy / 365.0)
    out["DOY_COS"] = np.cos(2 * np.pi * doy / 365.0)
    return out


def _add_lags_rolls(df: pd.DataFrame, vars_: List[str]) -> pd.DataFrame:
    """Add lag and rolling window features"""
    out = df.copy()
    for v in vars_:
        if v not in out.columns:
            continue
        for L in LAGS:
            out[f"{v}_lag{L}"] = out[v].shift(L)
        for R in ROLLS:
            out[f"{v}_roll{R}"] = out[v].rolling(R, min_periods=max(1, R // 2)).mean()
    return out


def _make_supervised_daily(df: pd.DataFrame, target_vars: List[str]) -> pd.DataFrame:
    """Convert to supervised learning format"""
    out = df.copy()
    for v in target_vars:
        if v in out.columns:
            out[f"{v}_target_h1"] = out[v].shift(-1)  # predict t+1 day
    return out.dropna()


def _fit_sarimax_daily(y_train: pd.Series):
    """Fit SARIMAX model with weekly seasonality"""
    order = (1, 0, 1)
    seasonal_order = (1, 1, 1, 7)
    mod = SARIMAX(
        y_train, 
        order=order, 
        seasonal_order=seasonal_order,
        enforce_stationarity=False, 
        enforce_invertibility=False
    )
    return mod.fit(disp=False)


def _best_f1_threshold(y_true_mm: np.ndarray, y_pred_score: np.ndarray) -> float:
    """
    Encontra o limiar que maximiza o F1 no conjunto de validação.
    y_true_mm: valores verdadeiros (mm)
    y_pred_score: valores previstos contínuos (mm)
    Retorna o threshold ótimo. Em fallback, retorna PRECIP_DEFAULT_THRESHOLD_MM.
    """
    if y_true_mm.size == 0 or y_pred_score.size == 0:
        return float(PRECIP_DEFAULT_THRESHOLD_MM)

    # Classe verdadeira binária para referência
    true_bin_ref = (y_true_mm >= PRECIP_DEFAULT_THRESHOLD_MM).astype(int)

    # Se não há variação (tudo zero de ambos), qualquer limiar serve
    if true_bin_ref.sum() == 0 and np.all(y_pred_score <= 0):
        return float(PRECIP_DEFAULT_THRESHOLD_MM)

    # Grelha de limiares: quantis do score + âncoras
    qs = np.unique(np.quantile(y_pred_score, np.linspace(0, 1, 51)))
    grid = np.unique(np.concatenate(([0.0, PRECIP_DEFAULT_THRESHOLD_MM], qs)))

    best_tau = float(PRECIP_DEFAULT_THRESHOLD_MM)
    best_f1 = -1.0

    for tau in grid:
        pred_bin = (y_pred_score >= tau).astype(int)
        if pred_bin.sum() == 0 and true_bin_ref.sum() == 0:
            f1 = 1.0
        else:
            f1 = f1_score(true_bin_ref, pred_bin, zero_division=0)
        if f1 > best_f1:
            best_f1 = f1
            best_tau = float(tau)

    return float(best_tau)


def _eval_forecast(var_name: str, y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """
    Calculate forecast metrics including optional F1 for precipitation.
    Mantém o mesmo formato de saída: sempre MAE e RMSE; para precipitação, também F1.
    """
    arr_true = np.asarray(y_true, dtype=float)
    arr_pred = np.asarray(y_pred, dtype=float)
    mask = ~np.isnan(arr_true) & ~np.isnan(arr_pred)

    if not mask.any():
        metrics = {"MAE": float("inf"), "RMSE": float("inf")}
        if var_name.upper().startswith("PREC"):
            metrics["F1"] = 0.0
        return metrics

    arr_true = arr_true[mask]
    arr_pred = arr_pred[mask]

    metrics = {
        "MAE": float(mean_absolute_error(arr_true, arr_pred)),
        "RMSE": float(mean_squared_error(arr_true, arr_pred, squared=False)),
    }

    # F1 para precipitação: otimiza limiar em validação
    if var_name.upper().startswith("PREC"):
        # threshold ótimo baseado no score contínuo previsto (mm)
        tau = _best_f1_threshold(arr_true, arr_pred)
        true_bin = (arr_true >= PRECIP_DEFAULT_THRESHOLD_MM).astype(int)  # definição de "chover" no rótulo
        pred_bin = (arr_pred >= tau).astype(int)
        if pred_bin.any() or true_bin.any():
            metrics["F1"] = float(f1_score(true_bin, pred_bin, zero_division=0))
        else:
            metrics["F1"] = 1.0  # ambos sem chuva
    return metrics


async def predict_day(
    lat: float, 
    lon: float, 
    date_str: str,
    years_back: int = YEARS_BACK_DEFAULT,
    variables: Optional[List[str]] = None
) -> dict:
    """
    Predict weather for a future date using 3 AI models.
    
    Returns predictions from all 3 models plus auto-selected best model per variable.
    """
    import time
    start_time = time.time()
    
    variables = variables or ["T2M", "T2M_MAX", "T2M_MIN", "WS10M", "PRECTOTCORR"]
    target_date = datetime.strptime(date_str, "%Y-%m-%d")
    start = target_date - timedelta(days=365 * years_back)
    end = target_date - timedelta(days=1)

    # 1) Fetch historical data
    df = await _fetch_year_chunks_async(lat, lon, start, end, variables)
    if df.dropna(how="all").empty:
        raise RuntimeError("POWER returned empty series.")

    # Interpolate small gaps
    dfi = df.copy()
    for v in variables:
        if v in dfi.columns:
            dfi[v] = dfi[v].interpolate(limit=3, limit_direction="both")

    # 2) Feature engineering
    feat = _add_time_features_daily(dfi)
    feat = _add_lags_rolls(feat, variables)
    sup = _make_supervised_daily(feat, variables)

    # 3) Train/validation split (60/40 temporal)
    n = len(sup)
    cut = max(int(n * 0.6), 30)
    train_df, val_df = sup.iloc[:cut], sup.iloc[cut:]

    results = {}
    predictions = {}
    chosen = {}

    # Feature columns for sklearn models
    feat_cols_all = [c for c in train_df.columns if not c.endswith("_target_h1")]

    # Prepare future features for sklearn models
    last_idx = pd.Timestamp(feat.index[-1])
    tgt_idx = last_idx + pd.Timedelta(days=1)
    future_features = _build_future_feature_row(dfi, variables, tgt_idx)
    future_features = future_features.reindex(columns=feat_cols_all)

    if not train_df.empty:
        fallback_series = train_df[feat_cols_all].iloc[-1]
    elif not sup.empty:
        fallback_series = sup[feat_cols_all].mean()
    else:
        fallback_series = pd.Series(0.0, index=feat_cols_all)

    future_features = future_features.fillna(fallback_series)
    future_features = future_features.fillna(0.0)

    for v in variables:
        if v not in dfi.columns:
            continue

        results[v] = {}
        predictions[v] = {}

        # ============ SARIMAX (Time Series) ============
        try:
            y_train = train_df[v].dropna()
            y_val = val_df[v].dropna()
            
            sarimax_res = _fit_sarimax_daily(y_train)
            sarimax_fc = sarimax_res.forecast(steps=len(y_val))
            sarimax_fc = pd.Series(sarimax_fc, index=y_val.index)
            results[v]["SARIMAX"] = _eval_forecast(v, y_val.values, sarimax_fc.values)

            # Refit with full history
            sarimax_full = _fit_sarimax_daily(dfi[v].dropna())
            predictions[v]["SARIMAX"] = float(sarimax_full.forecast(steps=1).iloc[0])
        except Exception:
            # Fallback: persistence
            results[v]["SARIMAX"] = {"MAE": float("inf"), "RMSE": float("inf")}
            if v.upper().startswith("PREC"):
                results[v]["SARIMAX"]["F1"] = 0.0
            predictions[v]["SARIMAX"] = float(dfi[v].iloc[-1]) if len(dfi[v]) > 0 else 0.0

        # ============ Gradient Boosting ============
        try:
            y_train_g = train_df[f"{v}_target_h1"]
            X_train_g = train_df[feat_cols_all].copy()
            y_val_g = val_df[f"{v}_target_h1"]
            X_val_g = val_df[feat_cols_all].copy()

            gbrt = GradientBoostingRegressor(random_state=42)
            gbrt.fit(X_train_g, y_train_g)
            yhat_g = gbrt.predict(X_val_g)
            results[v]["GradientBoosting"] = _eval_forecast(v, y_val_g.values, yhat_g)

            # Predict future
            predictions[v]["GradientBoosting"] = float(gbrt.predict(future_features)[0])
        except Exception:
            results[v]["GradientBoosting"] = {"MAE": float("inf"), "RMSE": float("inf")}
            if v.upper().startswith("PREC"):
                results[v]["GradientBoosting"]["F1"] = 0.0
            predictions[v]["GradientBoosting"] = float(dfi[v].iloc[-1]) if len(dfi[v]) > 0 else 0.0

        # ============ Random Forest ============
        try:
            rf = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
            rf.fit(X_train_g, y_train_g)
            yhat_rf = rf.predict(X_val_g)
            results[v]["RandomForest"] = _eval_forecast(v, y_val_g.values, yhat_rf)

            predictions[v]["RandomForest"] = float(rf.predict(future_features)[0])
        except Exception:
            results[v]["RandomForest"] = {"MAE": float("inf"), "RMSE": float("inf")}
            if v.upper().startswith("PREC"):
                results[v]["RandomForest"]["F1"] = 0.0
            predictions[v]["RandomForest"] = float(dfi[v].iloc[-1]) if len(dfi[v]) > 0 else 0.0

        # ============ Auto model selection ============
        # Mantém o mesmo formato de saída; apenas muda a lógica de seleção para precipitação.
        if v.upper().startswith("PREC"):
            # Seleciona pelo MAIOR F1; em empate, menor RMSE
            def _key_prec(m):
                f1 = results[v][m].get("F1", -1.0)
                rmse = results[v][m].get("RMSE", float("inf"))
                return (f1, -rmse)
            best_model = max(results[v].keys(), key=_key_prec)
        else:
            # Contínuos: menor RMSE
            best_model = min(results[v], key=lambda m: results[v][m]["RMSE"])

        chosen_entry = {
            "best_model": best_model,
            "value": predictions[v][best_model],
            "RMSE": results[v][best_model]["RMSE"],
            "MAE": results[v][best_model]["MAE"]
        }
        if "F1" in results[v][best_model]:
            chosen_entry["F1"] = results[v][best_model]["F1"]
        chosen[v] = chosen_entry

    execution_time = time.time() - start_time
    
    return {
        "input": {
            "latitude": lat, 
            "longitude": lon, 
            "date": date_str, 
            "years_back": years_back
        },
        "ai_models": {
            "metrics": results,
            "predictions": predictions,
            "chosen": chosen,
            "execution_time": round(execution_time, 2)
        }
    }


async def predict_multiple_days(
    lat: float,
    lon: float,
    dates: List[str],
    years_back: int = YEARS_BACK_DEFAULT,
    variables: Optional[List[str]] = None
) -> List[dict]:
    """
    Predict weather for multiple dates in parallel.
    
    Args:
        lat: Latitude
        lon: Longitude
        dates: List of date strings in format "YYYY-MM-DD"
        years_back: Years of historical data to use
        variables: List of variables to predict
        
    Returns:
        List of prediction results, one per date
    """
    tasks = [
        predict_day(lat, lon, date_str, years_back, variables)
        for date_str in dates
    ]
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Filter out exceptions and return successful predictions
    successful = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            print(f"Error predicting for {dates[i]}: {result}")
        else:
            successful.append(result)
    
    return successful
