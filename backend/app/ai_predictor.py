# -*- coding: utf-8 -*-
"""
RAIN - AI Weather Predictor for future dates
Predicts daily weather using 3 AI models: SARIMAX, Gradient Boosting, Random Forest
"""

import asyncio
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import httpx
import pandas as pd
import numpy as np

from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
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
            except httpx.HTTPError as e:
                if attempt == RETRY - 1:
                    raise
                await asyncio.sleep(RETRY_BACKOFF * (attempt + 1))
    
    par = data.get("properties", {}).get("parameter", {})
    if not par:
        raise RuntimeError("POWER: response without 'properties.parameter'.")

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
        raise RuntimeError("POWER: no date keys in variables.")
    
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


def _eval_forecast(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """Calculate forecast metrics"""
    return {
        "MAE": float(mean_absolute_error(y_true, y_pred)),
        "RMSE": float(mean_squared_error(y_true, y_pred, squared=False))
    }


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

    # Prepare future features
    last_idx = feat.index[-1]
    tgt_idx = last_idx + pd.Timedelta(days=1)
    base_future = feat.iloc[[-1]].copy()
    doy = tgt_idx.timetuple().tm_yday
    base_future["DOY"] = doy
    base_future["DOY_SIN"] = math.sin(2 * math.pi * doy / 365.0)
    base_future["DOY_COS"] = math.cos(2 * math.pi * doy / 365.0)

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
            results[v]["SARIMAX"] = _eval_forecast(y_val.values, sarimax_fc.values)

            # Refit with full history
            sarimax_full = _fit_sarimax_daily(dfi[v].dropna())
            predictions[v]["SARIMAX"] = float(sarimax_full.forecast(steps=1).iloc[0])
        except Exception:
            # Fallback: persistence
            results[v]["SARIMAX"] = {"MAE": float("inf"), "RMSE": float("inf")}
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
            results[v]["GradientBoosting"] = _eval_forecast(y_val_g.values, yhat_g)

            # Predict future
            frow = base_future.copy()
            frow[v] = dfi[v].iloc[-1]
            for L in LAGS:
                frow[f"{v}_lag{L}"] = dfi[v].shift(L).iloc[-1]
            for R in ROLLS:
                frow[f"{v}_roll{R}"] = dfi[v].rolling(R, min_periods=max(1, R // 2)).mean().iloc[-1]
            frow = frow.reindex(columns=feat_cols_all, fill_value=np.nan)
            predictions[v]["GradientBoosting"] = float(gbrt.predict(frow)[0])
        except Exception:
            results[v]["GradientBoosting"] = {"MAE": float("inf"), "RMSE": float("inf")}
            predictions[v]["GradientBoosting"] = float(dfi[v].iloc[-1]) if len(dfi[v]) > 0 else 0.0

        # ============ Random Forest ============
        try:
            rf = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
            rf.fit(X_train_g, y_train_g)
            yhat_rf = rf.predict(X_val_g)
            results[v]["RandomForest"] = _eval_forecast(y_val_g.values, yhat_rf)

            frow_rf = base_future.copy()
            frow_rf[v] = dfi[v].iloc[-1]
            for L in LAGS:
                frow_rf[f"{v}_lag{L}"] = dfi[v].shift(L).iloc[-1]
            for R in ROLLS:
                frow_rf[f"{v}_roll{R}"] = dfi[v].rolling(R, min_periods=max(1, R // 2)).mean().iloc[-1]
            frow_rf = frow_rf.reindex(columns=feat_cols_all, fill_value=np.nan)
            predictions[v]["RandomForest"] = float(rf.predict(frow_rf)[0])
        except Exception:
            results[v]["RandomForest"] = {"MAE": float("inf"), "RMSE": float("inf")}
            predictions[v]["RandomForest"] = float(dfi[v].iloc[-1]) if len(dfi[v]) > 0 else 0.0

        # ============ Auto model selection ============
        rmse_by_model = {m: results[v][m]["RMSE"] for m in results[v]}
        best_model = min(rmse_by_model, key=rmse_by_model.get)
        chosen[v] = {
            "best_model": best_model,
            "value": predictions[v][best_model],
            "RMSE": results[v][best_model]["RMSE"],
            "MAE": results[v][best_model]["MAE"]
        }

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

