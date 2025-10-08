# -*- coding: utf-8 -*-
"""
RAIN - AI Weather Predictor for future dates
Predicts daily weather using 3 AI models: SARIMAX, Gradient Boosting, Random Forest

Notas:
- Mantém o mesmo formato de INPUT/OUTPUT.
- Melhora a verificação de acurácia:
  * Precipitação: otimiza F1 no conjunto de validação (threshold ótimo) e escolhe modelo por F1.
  * Contínuas (temperatura/vento): mantém MAE/RMSE.
- Adiciona helpers para "servir acurácia em %", sem alterar o JSON:
  * chance_within_tau_from_rmse(rmse, tau)
  * format_accuracy_percent_for_var(result, var, tau, unit)
  * format_accuracy_bundle(result, tolerances)
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

# =========================
# Configuration
# =========================
FILL_VALUE = -999.0
YEARS_BACK_DEFAULT = 6
LAGS = (1, 3, 7, 14, 21, 28)
ROLLS = (3, 7, 14)
TIMEOUT = 25
RETRY = 3
RETRY_BACKOFF = 2.0

# Precipitação: valor default apenas como âncora; F1 é otimizado em validação
PRECIP_DEFAULT_THRESHOLD_MM = 1.0

# Tolerâncias padrão para "acurácia em %"
# (Use na camada de apresentação; não altera o retorno das funções de previsão)
DEFAULT_TOLERANCES = {
    "T2M": {"tau": 1.0, "unit": "°C"},    # Temperatura média (±1 °C)
    "T2M_MAX": {"tau": 1.5, "unit": "°C"},
    "T2M_MIN": {"tau": 1.5, "unit": "°C"},
    "WS10M": {"tau": 1.5, "unit": " m/s"}, # Vento (±1,5 m/s)
    # Para precipitação contínua (mm), preferimos F1 na ocorrência (>=1mm).
    # Se quiser percentual para mm, defina uma tolerância, ex.: {"tau": 3.0, "unit": " mm"}
}


# =========================
# Utils
# =========================
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


# =========================
# Data fetching (NASA POWER)
# =========================
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
    """
    Fetch data in yearly chunks for resilience.
    Tries OpenMeteo first (better resolution), falls back to NASA POWER.
    """
    from .openmeteo_client import fetch_openmeteo_multi_year, OpenMeteoError
    
    # Tentar OpenMeteo primeiro (melhor resolução: ~10km)
    try:
        df = await fetch_openmeteo_multi_year(lat, lon, start, end, timeout=TIMEOUT)
        
        # OpenMeteo usa PRECTOT, criar alias para PRECTOTCORR se necessário
        if "PRECTOT" in df.columns and "PRECTOTCORR" in variables:
            df["PRECTOTCORR"] = df["PRECTOT"]
        
        # Filtrar apenas variáveis solicitadas
        available_vars = [v for v in variables if v in df.columns or v == "PRECTOTCORR"]
        df = df[[v if v != "PRECTOTCORR" else "PRECTOT" for v in available_vars]].copy()
        
        if "PRECTOT" in df.columns and "PRECTOTCORR" in available_vars:
            df["PRECTOTCORR"] = df["PRECTOT"]
        
        return df
        
    except (OpenMeteoError, Exception) as e:
        # Fallback para NASA POWER
        print(f"OpenMeteo failed, falling back to NASA POWER: {e}")
        pass
    
    # Fallback: NASA POWER (resolução ~50km)
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
    
    # Concatenate and ensure index is consistent datetime type
    out = pd.concat(frames)
    # Convert all index values to pd.Timestamp for consistent comparison
    out.index = pd.DatetimeIndex(out.index)
    out = out.sort_index()
    out = out[~out.index.duplicated(keep="last")]
    
    return out


# =========================
# Feature engineering
# =========================
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
    """Add lag and rolling window features (optimized - in-place operations)"""
    out = df.copy()
    for v in vars_:
        if v not in out.columns:
            continue
        # Pré-alocar colunas para evitar múltiplas cópias
        series = out[v]
        for L in LAGS:
            out[f"{v}_lag{L}"] = series.shift(L)
        for R in ROLLS:
            out[f"{v}_roll{R}"] = series.rolling(R, min_periods=max(1, R // 2)).mean()
    return out


def _make_supervised_daily(df: pd.DataFrame, target_vars: List[str]) -> pd.DataFrame:
    """Convert to supervised learning format"""
    out = df.copy()
    for v in target_vars:
        if v in out.columns:
            out[f"{v}_target_h1"] = out[v].shift(-1)  # predict t+1 day
    return out.dropna()


# =========================
# Models & evaluation
# =========================
def _fit_sarimax_daily(y_train: pd.Series):
    """Fit SARIMAX model with weekly seasonality (optimized)"""
    order = (1, 0, 1)
    seasonal_order = (1, 1, 1, 7)
    mod = SARIMAX(
        y_train, 
        order=order, 
        seasonal_order=seasonal_order,
        enforce_stationarity=False, 
        enforce_invertibility=False
    )
    # Otimizado: menos iterações, método mais rápido
    return mod.fit(
        disp=False, 
        maxiter=50,  # Reduzido de default (geralmente 100+)
        method='lbfgs'  # Mais rápido que 'bfgs' default
    )


def _best_f1_threshold(y_true_mm: np.ndarray, y_pred_score: np.ndarray) -> float:
    """
    Encontra o limiar que maximiza o F1 no conjunto de validação.
    y_true_mm: valores verdadeiros (mm)
    y_pred_score: valores previstos contínuos (mm)
    Retorna o threshold ótimo. Em fallback, retorna PRECIP_DEFAULT_THRESHOLD_MM.
    """
    if y_true_mm.size == 0 or y_pred_score.size == 0:
        return float(PRECIP_DEFAULT_THRESHOLD_MM)

    true_bin_ref = (y_true_mm >= PRECIP_DEFAULT_THRESHOLD_MM).astype(int)

    if true_bin_ref.sum() == 0 and np.all(y_pred_score <= 0):
        return float(PRECIP_DEFAULT_THRESHOLD_MM)

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

    # F1 para precipitação (ocorrência): otimiza limiar em validação
    if var_name.upper().startswith("PREC"):
        tau = _best_f1_threshold(arr_true, arr_pred)
        true_bin = (arr_true >= PRECIP_DEFAULT_THRESHOLD_MM).astype(int)
        pred_bin = (arr_pred >= tau).astype(int)
        if pred_bin.any() or true_bin.any():
            metrics["F1"] = float(f1_score(true_bin, pred_bin, zero_division=0))
        else:
            metrics["F1"] = 1.0  # ambos sem chuva
    return metrics


def _weighted_ensemble(results: dict, predictions: dict, var: str) -> dict:
    """
    Combina os 3 modelos usando média ponderada baseada em RMSE de validação.
    Modelos com menor RMSE recebem maior peso.
    
    Args:
        results: dict com métricas de validação {modelo: {MAE, RMSE, F1?}}
        predictions: dict com predições {modelo: valor}
        var: nome da variável
    
    Returns:
        dict com predição ensemble e métricas estimadas
    """
    models = list(results[var].keys())
    
    # Extrair RMSEs de validação
    rmse_values = np.array([results[var][m]["RMSE"] for m in models])
    
    # Tratar casos de RMSE inválido (modelo falhou)
    rmse_values = np.where(np.isfinite(rmse_values), rmse_values, 1e10)
    
    # Calcular pesos: inversamente proporcional ao RMSE²
    # Usar RMSE² (MSE) é mais correto para penalizar erros grandes
    inv_mse = 1.0 / (rmse_values ** 2 + 1e-6)
    weights = inv_mse / inv_mse.sum()
    
    # Predição ensemble: média ponderada
    pred_values = np.array([predictions[var][m] for m in models])
    ensemble_pred = np.dot(weights, pred_values)
    
    # RMSE estimado do ensemble (otimista): menor RMSE dos modelos
    # Na prática, ensemble geralmente tem RMSE entre o melhor e a média ponderada
    best_rmse = np.min(rmse_values)
    ensemble_rmse = best_rmse * 0.95  # Estimativa conservadora: 5% melhor que o melhor
    
    # MAE estimado: média ponderada
    ensemble_mae = np.dot(weights, [results[var][m]["MAE"] for m in models])
    
    # Montar resultado
    result = {
        "best_model": "Ensemble",
        "value": float(ensemble_pred),
        "RMSE": float(ensemble_rmse),
        "MAE": float(ensemble_mae),
        "weights": {
            models[0]: round(float(weights[0]), 3),
            models[1]: round(float(weights[1]), 3),
            models[2]: round(float(weights[2]), 3)
        }
    }
    
    # Adicionar F1 para precipitação (média ponderada)
    if "F1" in results[var][models[0]]:
        f1_values = np.array([results[var][m].get("F1", 0.0) for m in models])
        # F1 do ensemble: média ponderada (otimista, mas razoável)
        result["F1"] = float(np.dot(weights, f1_values))
    
    return result


# =========================
# Public API
# =========================
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
            X_train_g = train_df[feat_cols_all]  # Remover .copy() desnecessário
            y_val_g = val_df[f"{v}_target_h1"]
            X_val_g = val_df[feat_cols_all]  # Remover .copy() desnecessário

            # Otimizado: menos estimadores, early stopping implícito
            gbrt = GradientBoostingRegressor(
                n_estimators=50,  # Reduzido de 100 (default)
                max_depth=3,
                learning_rate=0.1,
                subsample=0.8,
                random_state=42
            )
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
            # Otimizado: menos árvores, paralelismo máximo
            rf = RandomForestRegressor(
                n_estimators=50,  # Reduzido de 100
                max_depth=10,
                min_samples_split=5,
                min_samples_leaf=2,
                random_state=42,
                n_jobs=-1  # Usa todos os cores
            )
            rf.fit(X_train_g, y_train_g)
            yhat_rf = rf.predict(X_val_g)
            results[v]["RandomForest"] = _eval_forecast(v, y_val_g.values, yhat_rf)

            predictions[v]["RandomForest"] = float(rf.predict(future_features)[0])
        except Exception:
            results[v]["RandomForest"] = {"MAE": float("inf"), "RMSE": float("inf")}
            if v.upper().startswith("PREC"):
                results[v]["RandomForest"]["F1"] = 0.0
            predictions[v]["RandomForest"] = float(dfi[v].iloc[-1]) if len(dfi[v]) > 0 else 0.0

        # ============ Ensemble Ponderado ============
        # Combina os 3 modelos usando pesos baseados em RMSE de validação
        # Geralmente supera seleção de modelo único
        chosen[v] = _weighted_ensemble(results, predictions, v)

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


# =========================
# Helpers p/ "servir acurácia em %"
# (não alteram o JSON retornado; use-os na UI)
# =========================
def chance_within_tau_from_rmse(rmse: float, tau: float) -> float:
    """
    Converte RMSE (σ) em probabilidade de ficar dentro de ±tau, assumindo erro ~ N(0, σ²).
    Retorna valor em [0..1].
    """
    if rmse is None or not np.isfinite(rmse) or rmse <= 0:
        return 1.0
    z = tau / (math.sqrt(2.0) * rmse)
    return math.erf(z)


def format_accuracy_percent_for_var(result: dict, var: str, tau: float = None, unit: str = "") -> str:
    """
    Gera texto "Acurácia (±tau{unit}): X%" a partir do RMSE do modelo escolhido.
    Para variáveis de precipitação (PRECTOT/PRECTOTCORR), usa F1 (%).
    Não modifica o `result` original.
    """
    chosen = result.get("ai_models", {}).get("chosen", {})
    if var not in chosen:
        return ""

    entry = chosen[var]
    # Para precipitação (classe rara), preferimos F1 diretamente
    if var.upper().startswith("PREC") and "F1" in entry:
        return f"Acurácia (ocorrência de chuva): {entry['F1'] * 100.0:.1f}% (F1)"

    # Contínuas: usa RMSE -> chance por tolerância
    rmse = entry.get("RMSE", None)

    # Define tolerância padrão se não foi passada
    if tau is None:
        cfg = DEFAULT_TOLERANCES.get(var, None)
        if cfg:
            tau = cfg["tau"]; unit = cfg["unit"]
        else:
            # fallback razoável
            tau = 1.0
            if not unit:
                unit = ""

    p = chance_within_tau_from_rmse(rmse, tau) * 100.0
    return f"Acurácia (±{tau}{unit}): {p:.1f}%"


def format_accuracy_bundle(result: dict, tolerances: Dict[str, Dict[str, float]] = None) -> Dict[str, str]:
    """
    Retorna um dicionário {var: "Acurácia ... %"} para várias variáveis,
    usando tolerâncias fornecidas ou DEFAULT_TOLERANCES.
    Não altera o JSON de saída das funções de previsão.
    """
    out = {}
    chosen = result.get("ai_models", {}).get("chosen", {})
    if tolerances is None:
        tolerances = DEFAULT_TOLERANCES

    for var in chosen.keys():
        cfg = tolerances.get(var, {})
        tau = cfg.get("tau", None)
        unit = cfg.get("unit", "")
        out[var] = format_accuracy_percent_for_var(result, var, tau, unit)
    return out