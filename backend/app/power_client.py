from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional

import httpx

DAILY_BASE_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
HOURLY_BASE_URL = "https://power.larc.nasa.gov/api/temporal/hourly/point"
DEFAULT_DAILY_PARAMETERS = "T2M,T2M_MAX,T2M_MIN,WS10M,PRECTOT"
DEFAULT_HOURLY_PARAMETERS = "T2M,WS10M,PRECTOT"
DEFAULT_TIMEOUT = 15.0


class PowerAPIError(Exception):
    """Erro genérico ao consultar a API NASA POWER."""


@dataclass
class WeatherFlags:
    rain_risk: bool
    wind_caution: bool
    heat_caution: bool

    def to_dict(self) -> Dict[str, bool]:
        return {
            "rain_risk": self.rain_risk,
            "wind_caution": self.wind_caution,
            "heat_caution": self.heat_caution,
        }


@dataclass
class PowerWeatherRecord:
    date: str
    hour: Optional[int]
    hour_end: Optional[int]
    t2m: Optional[float]
    t2m_max: Optional[float]
    t2m_min: Optional[float]
    ws10m: Optional[float]
    precip_mm: Optional[float]
    flags: WeatherFlags
    accuracy: Optional[Dict[str, float]] = None  # Acurácia por variável (quando IA)

    def to_dict(self) -> Dict[str, object]:
        result = {
            "date": self.date,
            "hour": self.hour,
            "hour_end": self.hour_end,
            "t2m": self.t2m,
            "t2m_max": self.t2m_max,
            "t2m_min": self.t2m_min,
            "ws10m": self.ws10m,
            "precip_mm": self.precip_mm,
            "flags": self.flags.to_dict(),
        }
        if self.accuracy is not None:
            result["accuracy"] = self.accuracy
        return result


@dataclass
class PowerWeatherSummary:
    meta: Dict[str, object]
    records: List[PowerWeatherRecord]
    granularity: str
    series: Optional[List[PowerWeatherRecord]] = None
    ai_prediction: Optional[Dict[str, object]] = None

    def to_dict(self) -> Dict[str, object]:
        result = {
            "meta": self.meta,
            "granularity": self.granularity,
            "data": [record.to_dict() for record in self.records],
            "series": None if self.series is None else [record.to_dict() for record in self.series],
        }
        if self.ai_prediction is not None:
            result["ai_prediction"] = self.ai_prediction
        return result


def _first_non_empty_series(parameters: Dict[str, Dict[str, float]]) -> Optional[Dict[str, float]]:
    for series in parameters.values():
        if series:
            return series
    return None


def _iter_dates(parameters: Dict[str, Dict[str, float]]) -> Iterable[str]:
    series = _first_non_empty_series(parameters)
    if not series:
        return []
    return sorted(series.keys())


def _iter_times(parameters: Dict[str, Dict[str, float]]) -> Iterable[str]:
    series = _first_non_empty_series(parameters)
    if not series:
        return []
    return sorted(series.keys())


def _clean_value(value: Optional[float], fill_value: float) -> Optional[float]:
    if value is None:
        return None
    return None if value == fill_value else value


def _build_daily_record(
    parameters: Dict[str, Dict[str, float]],
    date_key: str,
    fill_value: float,
) -> Optional[PowerWeatherRecord]:
    def value_for(key: str) -> Optional[float]:
        series = parameters.get(key, {})
        return _clean_value(series.get(date_key), fill_value)

    precip_key = "PRECTOTCORR" if "PRECTOTCORR" in parameters else "PRECTOT"
    precip = value_for(precip_key)
    ws10m = value_for("WS10M")
    t2m_max = value_for("T2M_MAX")

    record = PowerWeatherRecord(
        date=f"{date_key[0:4]}-{date_key[4:6]}-{date_key[6:8]}",
        hour=None,
        hour_end=None,
        t2m=value_for("T2M"),
        t2m_max=t2m_max,
        t2m_min=value_for("T2M_MIN"),
        ws10m=ws10m,
        precip_mm=precip,
        flags=WeatherFlags(
            rain_risk=precip is not None and precip >= 2.0,
            wind_caution=ws10m is not None and ws10m >= 6.0,
            heat_caution=t2m_max is not None and t2m_max >= 32.0,
        ),
    )

    all_metrics = [
        record.t2m,
        record.t2m_max,
        record.t2m_min,
        record.ws10m,
        record.precip_mm,
    ]
    if all(metric is None for metric in all_metrics):
        return None
    return record


def _build_hourly_record(
    parameters: Dict[str, Dict[str, float]],
    time_key: str,
    fill_value: float,
) -> Optional[PowerWeatherRecord]:
    def value_for(key: str) -> Optional[float]:
        series = parameters.get(key, {})
        return _clean_value(series.get(time_key), fill_value)

    precip_key = "PRECTOTCORR" if "PRECTOTCORR" in parameters else "PRECTOT"
    precip = value_for(precip_key)
    ws10m = value_for("WS10M")
    t2m = value_for("T2M")

    record = PowerWeatherRecord(
        date=f"{time_key[0:4]}-{time_key[4:6]}-{time_key[6:8]}",
        hour=int(time_key[8:10]),
        hour_end=None,
        t2m=t2m,
        t2m_max=None,
        t2m_min=None,
        ws10m=ws10m,
        precip_mm=precip,
        flags=WeatherFlags(
            rain_risk=precip is not None and precip >= 1.0,
            wind_caution=ws10m is not None and ws10m >= 8.0,
            heat_caution=t2m is not None and t2m >= 32.0,
        ),
    )

    all_metrics = [record.t2m, record.ws10m, record.precip_mm]
    if all(metric is None for metric in all_metrics):
        return None
    return record


def _aggregate_hourly_records(records: List[PowerWeatherRecord]) -> PowerWeatherRecord:
    if not records:
        raise ValueError("Nenhum registro horário disponível para agregação.")

    def mean(values: List[Optional[float]]) -> Optional[float]:
        filtered = [value for value in values if value is not None]
        if not filtered:
            return None
        return sum(filtered) / len(filtered)

    precip_values = [record.precip_mm for record in records]
    ws_values = [record.ws10m for record in records]
    t_values = [record.t2m for record in records]

    first_record = records[0]
    last_record = records[-1]

    return PowerWeatherRecord(
        date=first_record.date,
        hour=first_record.hour,
        hour_end=last_record.hour if first_record.date == last_record.date else last_record.hour,
        t2m=mean(t_values),
        t2m_max=None,
        t2m_min=None,
        ws10m=mean(ws_values),
        precip_mm=mean(precip_values),
        flags=WeatherFlags(
            rain_risk=any(record.flags.rain_risk for record in records),
            wind_caution=any(record.flags.wind_caution for record in records),
            heat_caution=any(record.flags.heat_caution for record in records),
        ),
    )


def _extract_meta(payload: Dict[str, object]) -> Dict[str, object]:
    header = payload.get("header", {})
    parameters_meta = payload.get("parameters", {})

    units: Dict[str, Optional[str]] = {}
    for key in ("T2M", "T2M_MAX", "T2M_MIN", "WS10M", "PRECTOT", "PRECTOTCORR"):
        units[key] = None
        if isinstance(parameters_meta, dict):
            units[key] = parameters_meta.get(key, {}).get("units")  # type: ignore[arg-type]

    return {
        "service": header.get("api", {}).get("name"),
        "version": header.get("api", {}).get("version"),
        "time_standard": header.get("time_standard"),
        "available_start": header.get("start"),
        "available_end": header.get("end"),
        "units": units,
    }


async def fetch_power_weather(
    *,
    latitude: float,
    longitude: float,
    start: str,
    end: str,
    hour_start: Optional[int] = None,
    hour_end: Optional[int] = None,
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.AsyncClient] = None,
) -> PowerWeatherSummary:
    # AI is available for all cases (will predict daily values)
    can_use_ai = True
    is_hourly_request = hour_start is not None
    
    # Parse dates for reference
    today = datetime.now().date()
    start_date = datetime.strptime(start, "%Y%m%d").date()
    end_date = datetime.strptime(end, "%Y%m%d").date()
    
    # Check if request is for recent/future dates (NASA POWER may not have data yet)
    is_recent_or_future = start_date >= (today - timedelta(days=7))
    
    # Try normal NASA POWER first
    use_ai_fallback = False
    normal_data_failed = False
    
    base_url = DAILY_BASE_URL if hour_start is None else HOURLY_BASE_URL
    parameters_str = DEFAULT_DAILY_PARAMETERS if hour_start is None else DEFAULT_HOURLY_PARAMETERS

    params = {
        "parameters": parameters_str,
        "community": "SB",
        "latitude": f"{latitude}",
        "longitude": f"{longitude}",
        "start": start,
        "end": end,
        "format": "JSON",
    }

    headers = {
        "Accept": "application/json",
        "User-Agent": "rain/1.0",
    }

    close_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=timeout)
        close_client = True

    response = None
    parameters = {}
    meta = {}
    fill_value = -999.0
    
    try:
        response = await client.get(base_url, params=params, headers=headers)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if can_use_ai:
            use_ai_fallback = True
            normal_data_failed = True
        else:
            status_code = exc.response.status_code if exc.response is not None else 503
            raise PowerAPIError(
                f"Error querying NASA POWER (status {status_code})."
            ) from exc
    except httpx.HTTPError as exc:
        if can_use_ai:
            use_ai_fallback = True
            normal_data_failed = True
        else:
            raise PowerAPIError("Communication failure with NASA POWER.") from exc
    finally:
        if close_client:
            await client.aclose()

    # If normal request succeeded, process it
    if not normal_data_failed and response is not None:
        payload = response.json()
        parameters = payload.get("properties", {}).get("parameter", {})

        if not isinstance(parameters, dict) or not parameters:
            if is_recent_or_future and can_use_ai:
                use_ai_fallback = True
            else:
                raise PowerAPIError("NASA POWER response without parameter data.")

        if not use_ai_fallback:
            fill_value = payload.get("header", {}).get("fill_value", -999.0)
            meta = _extract_meta(payload)

            if hour_start is None:
                dates = list(_iter_dates(parameters))
                if not dates:
                    if is_recent_or_future and can_use_ai:
                        use_ai_fallback = True
                    else:
                        raise PowerAPIError("No dates available in NASA POWER response.")

                if not use_ai_fallback:
                    records: List[PowerWeatherRecord] = []
                    for date_key in dates:
                        record = _build_daily_record(parameters, date_key, fill_value)
                        if record is not None:
                            records.append(record)

                    # Check if all records have -999 values (no real data)
                    has_real_data = False
                    for record in records:
                        if record.t2m is not None or record.precip_mm is not None or record.ws10m is not None:
                            has_real_data = True
                            break
                    
                    if not records or not has_real_data:
                        if can_use_ai:
                            use_ai_fallback = True
                        else:
                            raise PowerAPIError("No usable weather data found for the specified period.")

                    if not use_ai_fallback:
                        return PowerWeatherSummary(meta=meta, records=records, granularity="daily")
    
    # Use AI if needed
    if use_ai_fallback and can_use_ai:
        from .ai_predictor import predict_day, chance_within_tau_from_rmse, DEFAULT_TOLERANCES

        try:
            # For single date or date range, predict the start date
            ai_results = await predict_day(
                lat=latitude,
                lon=longitude,
                date_str=start_date.strftime("%Y-%m-%d"),
                years_back=6,
                variables=["T2M", "T2M_MAX", "T2M_MIN", "WS10M", "PRECTOTCORR"]
            )
        except Exception as exc:  # pragma: no cover - handled by caller tests
            raise PowerAPIError("Erro ao gerar previsão com IA.") from exc
        
        # Build record from AI prediction
        # Calculate accuracy scores based on RMSE usando as funções do ai_predictor
        chosen = ai_results["ai_models"]["chosen"]
        
        # Calcular acurácia usando as tolerâncias padrão configuradas
        accuracy_scores = {}
        for var, info in chosen.items():
            # Para precipitação, usa F1 diretamente
            if var.upper().startswith("PREC") and "F1" in info:
                accuracy_scores[var] = round(info["F1"] * 100.0, 1)
            elif "RMSE" in info:
                # Para variáveis contínuas, usa chance_within_tau_from_rmse
                rmse = info["RMSE"]
                tolerance_cfg = DEFAULT_TOLERANCES.get(var, {})
                tau = tolerance_cfg.get("tau", 1.0)  # Default ±1 se não especificado
                
                # Calcula a probabilidade de estar dentro da tolerância
                probability = chance_within_tau_from_rmse(rmse, tau)
                accuracy_scores[var] = round(probability * 100.0, 1)
        
        # Determine flags from predictions
        t2m = chosen.get("T2M", {}).get("value", 25.0)
        precip = chosen.get("PRECTOTCORR", {}).get("value", 0.0)
        ws10m = chosen.get("WS10M", {}).get("value", 0.0)
        
        # Format date as YYYY-MM-DD to match NASA POWER format
        formatted_date = f"{start[0:4]}-{start[4:6]}-{start[6:8]}"
        
        # If hourly request, convert daily prediction to hourly format
        if is_hourly_request:
            # Use T2M for hourly (no max/min for hourly data)
            flags_hourly = WeatherFlags(
                rain_risk=precip >= 1.0,
                wind_caution=ws10m >= 8.0,
                heat_caution=t2m >= 32.0
            )
            
            ai_record = PowerWeatherRecord(
                date=formatted_date,
                hour=hour_start,
                hour_end=hour_end,
                t2m=chosen.get("T2M", {}).get("value"),
                t2m_max=None,  # No max/min for hourly
                t2m_min=None,
                ws10m=chosen.get("WS10M", {}).get("value"),
                precip_mm=chosen.get("PRECTOTCORR", {}).get("value"),
                flags=flags_hourly,
                accuracy=accuracy_scores
            )
            
            meta = {
                "service": "AI Prediction",
                "version": "1.0",
                "time_standard": "LST",
                "available_start": start,
                "available_end": end,
                "units": {
                    "T2M": "C",
                    "WS10M": "m/s",
                    "PRECTOTCORR": "mm"
                }
            }
            
            return PowerWeatherSummary(
                meta=meta,
                records=[ai_record],
                granularity="hourly",
                ai_prediction={
                    **ai_results["ai_models"],
                    "input": ai_results["input"]
                }
            )
        else:
            # Daily request
            flags = WeatherFlags(
                rain_risk=precip >= 1.0,
                wind_caution=ws10m >= 15.0,
                heat_caution=t2m >= 35.0
            )
            
            ai_record = PowerWeatherRecord(
                date=formatted_date,
                hour=None,
                hour_end=None,
                t2m=chosen.get("T2M", {}).get("value"),
                t2m_max=chosen.get("T2M_MAX", {}).get("value"),
                t2m_min=chosen.get("T2M_MIN", {}).get("value"),
                ws10m=chosen.get("WS10M", {}).get("value"),
                precip_mm=chosen.get("PRECTOTCORR", {}).get("value"),
                flags=flags,
                accuracy=accuracy_scores
            )
            
            meta = {
                "service": "AI Prediction",
                "version": "1.0",
                "time_standard": "LST",
                "available_start": start,
                "available_end": end,
                "units": {
                    "T2M": "C",
                    "T2M_MAX": "C",
                    "T2M_MIN": "C",
                    "WS10M": "m/s",
                    "PRECTOTCORR": "mm"
                }
            }
            
            return PowerWeatherSummary(
                meta=meta,
                records=[ai_record],
                granularity="daily",
                ai_prediction={
                    **ai_results["ai_models"],
                    "input": ai_results["input"]
                }
            )
    
    # If we got here with hourly request, continue with hourly logic
    if hour_start is not None:
        # If data failed and we're using AI, we already returned above
        if normal_data_failed or use_ai_fallback:
            # Should have been handled by AI fallback above
            raise PowerAPIError("No data available for hourly request.")
            
        # Hourly query with interval support
        if not (0 <= hour_start <= 23):
            raise PowerAPIError("Invalid start hour. Use values between 0 and 23.")

        if hour_end is not None and not (0 <= hour_end <= 23):
            raise PowerAPIError("Invalid end hour. Use values between 0 and 23.")

        multi_day_interval = end != start

        effective_hour_end = hour_start
        if hour_end is not None:
            effective_hour_end = hour_end
        elif multi_day_interval:
            effective_hour_end = 23

        if not (0 <= effective_hour_end <= 23):
            raise PowerAPIError("Invalid end hour. Use values between 0 and 23.")

        if not multi_day_interval and effective_hour_end < hour_start:
            raise PowerAPIError("End hour must be greater than or equal to start hour.")

        time_keys = list(_iter_times(parameters))
        if not time_keys:
            # No hourly data available - try AI fallback with multiple hourly predictions
            if can_use_ai and (is_recent_or_future or normal_data_failed):
                from .ai_predictor import predict_day, predict_multiple_days, chance_within_tau_from_rmse, DEFAULT_TOLERANCES
                
                # Generate list of dates to predict
                current = start_date
                dates_to_predict = []
                while current <= end_date:
                    dates_to_predict.append(current.strftime("%Y-%m-%d"))
                    current += timedelta(days=1)
                
                # Predict all dates in parallel
                try:
                    if len(dates_to_predict) > 1:
                        all_predictions = await predict_multiple_days(
                            lat=latitude,
                            lon=longitude,
                            dates=dates_to_predict,
                            years_back=6,
                            variables=["T2M", "T2M_MAX", "T2M_MIN", "WS10M", "PRECTOTCORR"]
                        )
                    else:
                        # Single date
                        single_pred = await predict_day(
                            lat=latitude,
                            lon=longitude,
                            date_str=dates_to_predict[0],
                            years_back=6,
                            variables=["T2M", "T2M_MAX", "T2M_MIN", "WS10M", "PRECTOTCORR"]
                        )
                        all_predictions = [single_pred]
                except Exception as exc:  # pragma: no cover - handled by caller tests
                    raise PowerAPIError("Erro ao gerar previsão com IA.") from exc
                
                # Build hourly records from AI predictions
                ai_hourly_records = []
                for pred_result in all_predictions:
                    pred_date_str = pred_result["input"]["date"]
                    chosen = pred_result["ai_models"]["chosen"]
                    
                    # Calculate accuracy usando as funções do ai_predictor
                    accuracy_scores = {}
                    for var, info in chosen.items():
                        # Para precipitação, usa F1 diretamente
                        if var.upper().startswith("PREC") and "F1" in info:
                            accuracy_scores[var] = round(info["F1"] * 100.0, 1)
                        elif "RMSE" in info:
                            # Para variáveis contínuas, usa chance_within_tau_from_rmse
                            rmse = info["RMSE"]
                            tolerance_cfg = DEFAULT_TOLERANCES.get(var, {})
                            tau = tolerance_cfg.get("tau", 1.0)
                            
                            probability = chance_within_tau_from_rmse(rmse, tau)
                            accuracy_scores[var] = round(probability * 100.0, 1)
                    
                    t2m_base = chosen.get("T2M", {}).get("value", 25.0)
                    precip_base = chosen.get("PRECTOTCORR", {}).get("value", 0.0)
                    ws10m_base = chosen.get("WS10M", {}).get("value", 0.0)
                    
                    # Generate hourly records for this day
                    for h in range(hour_start, effective_hour_end + 1):
                        # Add realistic hourly variation
                        import random
                        hour_variation = 1 + (random.random() - 0.5) * 0.1
                        
                        t2m = round(t2m_base * hour_variation, 2)
                        ws10m = round(max(0, ws10m_base * hour_variation), 2)
                        precip = round(max(0, precip_base * hour_variation), 2)
                        
                        flags_hourly = WeatherFlags(
                            rain_risk=precip >= 1.0,
                            wind_caution=ws10m >= 8.0,
                            heat_caution=t2m >= 32.0
                        )
                        
                        ai_record = PowerWeatherRecord(
                            date=pred_date_str,
                            hour=h,
                            hour_end=None,
                            t2m=t2m,
                            t2m_max=None,
                            t2m_min=None,
                            ws10m=ws10m,
                            precip_mm=precip,
                            flags=flags_hourly,
                            accuracy=accuracy_scores
                        )
                        ai_hourly_records.append(ai_record)
                
                meta = {
                    "service": "AI Prediction",
                    "version": "1.0",
                    "time_standard": "LST",
                    "available_start": start,
                    "available_end": end,
                    "units": {"T2M": "C", "WS10M": "m/s", "PRECTOTCORR": "mm"}
                }
                
                # Aggregate AI prediction info from all predictions
                total_execution_time = sum(p["ai_models"]["execution_time"] for p in all_predictions)
                first_pred = all_predictions[0]
                
                return PowerWeatherSummary(
                    meta=meta,
                    records=ai_hourly_records,
                    granularity="hourly",
                    series=ai_hourly_records,
                    ai_prediction={
                        "chosen": first_pred["ai_models"]["chosen"],
                        "execution_time": round(total_execution_time, 2),
                        "input": {
                            "latitude": latitude,
                            "longitude": longitude,
                            "dates": dates_to_predict,
                            "years_back": 6,
                            "total_predictions": len(all_predictions)
                        }
                    }
                )
            else:
                raise PowerAPIError("No temporal data available in NASA POWER response.")

        # Multi-day with hour interval: filter only specific hours from each day
        if multi_day_interval:
            range_records: List[PowerWeatherRecord] = []
            for time_key in time_keys:
                # time_key format: YYYYMMDDHH
                if len(time_key) >= 10:
                    date_part = time_key[:8]  # YYYYMMDD
                    hour_part = int(time_key[8:10])  # HH
                    
                    # Check if date is in range
                    if start <= date_part <= end:
                        # Check if hour is in specified interval
                        if hour_start <= hour_part <= effective_hour_end:
                            record = _build_hourly_record(parameters, time_key, fill_value)
                            if record is not None:
                                range_records.append(record)
        else:
            # Single day mode: get all hours in interval
            start_key = f"{start}{hour_start:02d}"
            end_key = f"{end}{effective_hour_end:02d}"
            
            range_records: List[PowerWeatherRecord] = []
            for time_key in time_keys:
                if start_key <= time_key <= end_key:
                    record = _build_hourly_record(parameters, time_key, fill_value)
                    if record is not None:
                        range_records.append(record)

        if not range_records:
            # Try AI fallback for recent/future dates - generate predictions for each point
            if can_use_ai and is_recent_or_future:
                from .ai_predictor import predict_day, predict_multiple_days, chance_within_tau_from_rmse, DEFAULT_TOLERANCES
                
                # Generate list of dates to predict
                current = start_date
                dates_to_predict = []
                while current <= end_date:
                    dates_to_predict.append(current.strftime("%Y-%m-%d"))
                    current += timedelta(days=1)
                
                # Predict all dates in parallel
                try:
                    if len(dates_to_predict) > 1:
                        all_predictions = await predict_multiple_days(
                            lat=latitude,
                            lon=longitude,
                            dates=dates_to_predict,
                            years_back=6,
                            variables=["T2M", "T2M_MAX", "T2M_MIN", "WS10M", "PRECTOTCORR"]
                        )
                    else:
                        # Single date - use regular predict_day
                        single_pred = await predict_day(
                            lat=latitude,
                            lon=longitude,
                            date_str=dates_to_predict[0],
                            years_back=6,
                            variables=["T2M", "T2M_MAX", "T2M_MIN", "WS10M", "PRECTOTCORR"]
                        )
                        all_predictions = [single_pred]
                except Exception as exc:  # pragma: no cover - handled by caller tests
                    raise PowerAPIError("Erro ao gerar previsão com IA.") from exc
                
                # Build hourly records from AI predictions
                ai_hourly_records = []
                for pred_result in all_predictions:
                    pred_date_str = pred_result["input"]["date"]
                    pred_date = datetime.strptime(pred_date_str, "%Y-%m-%d").date()
                    chosen = pred_result["ai_models"]["chosen"]
                    
                    # Calculate accuracy usando as funções do ai_predictor
                    accuracy_scores = {}
                    for var, info in chosen.items():
                        # Para precipitação, usa F1 diretamente
                        if var.upper().startswith("PREC") and "F1" in info:
                            accuracy_scores[var] = round(info["F1"] * 100.0, 1)
                        elif "RMSE" in info:
                            # Para variáveis contínuas, usa chance_within_tau_from_rmse
                            rmse = info["RMSE"]
                            tolerance_cfg = DEFAULT_TOLERANCES.get(var, {})
                            tau = tolerance_cfg.get("tau", 1.0)
                            
                            probability = chance_within_tau_from_rmse(rmse, tau)
                            accuracy_scores[var] = round(probability * 100.0, 1)
                    
                    t2m = chosen.get("T2M", {}).get("value", 25.0)
                    precip = chosen.get("PRECTOTCORR", {}).get("value", 0.0)
                    ws10m = chosen.get("WS10M", {}).get("value", 0.0)
                    
                    # Generate hourly records for this day
                    for h in range(hour_start, effective_hour_end + 1):
                        # Add small variation for each hour (±5% random)
                        import random
                        hour_variation = 1 + (random.random() - 0.5) * 0.1
                        
                        flags_hourly = WeatherFlags(
                            rain_risk=precip >= 1.0,
                            wind_caution=ws10m >= 8.0,
                            heat_caution=t2m >= 32.0
                        )
                        
                        ai_record = PowerWeatherRecord(
                            date=pred_date_str,
                            hour=h,
                            hour_end=None,
                            t2m=round(t2m * hour_variation, 2),
                            t2m_max=None,
                            t2m_min=None,
                            ws10m=round(max(0, ws10m * hour_variation), 2),
                            precip_mm=round(max(0, precip * hour_variation), 2),
                            flags=flags_hourly,
                            accuracy=accuracy_scores
                        )
                        ai_hourly_records.append(ai_record)
                
                meta = {
                    "service": "AI Prediction",
                    "version": "1.0",
                    "time_standard": "LST",
                    "available_start": start,
                    "available_end": end,
                    "units": {"T2M": "C", "WS10M": "m/s", "PRECTOTCORR": "mm"}
                }
                
                # Aggregate AI prediction info from all predictions
                total_execution_time = sum(p["ai_models"]["execution_time"] for p in all_predictions)
                first_pred = all_predictions[0]
                
                return PowerWeatherSummary(
                    meta=meta,
                    records=ai_hourly_records,
                    granularity="hourly",
                    series=ai_hourly_records,
                    ai_prediction={
                        "chosen": first_pred["ai_models"]["chosen"],
                        "execution_time": round(total_execution_time, 2),
                        "input": {
                            "latitude": latitude,
                            "longitude": longitude,
                            "dates": dates_to_predict,
                            "years_back": 6,
                            "total_predictions": len(all_predictions)
                        }
                    }
                )
            else:
                raise PowerAPIError("No usable weather data found for the specified interval.")

        if len(range_records) == 1:
            return PowerWeatherSummary(meta=meta, records=range_records, granularity="hourly")

        aggregated = _aggregate_hourly_records(range_records)
        return PowerWeatherSummary(meta=meta, records=[aggregated], granularity="hourly", series=range_records)
    
    # Should not reach here - return error
    raise PowerAPIError("Invalid request configuration.")
