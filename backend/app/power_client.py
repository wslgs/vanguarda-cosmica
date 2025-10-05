from __future__ import annotations

from dataclasses import dataclass
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

    def to_dict(self) -> Dict[str, object]:
        return {
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


@dataclass
class PowerWeatherSummary:
    meta: Dict[str, object]
    records: List[PowerWeatherRecord]
    granularity: str
    series: Optional[List[PowerWeatherRecord]] = None

    def to_dict(self) -> Dict[str, object]:
        return {
            "meta": self.meta,
            "granularity": self.granularity,
            "data": [record.to_dict() for record in self.records],
            "series": None if self.series is None else [record.to_dict() for record in self.series],
        }


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

    try:
        response = await client.get(base_url, params=params, headers=headers)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else 503
        raise PowerAPIError(
            f"Erro ao consultar a NASA POWER (status {status_code})."
        ) from exc
    except httpx.HTTPError as exc:  # pragma: no cover - erros de rede raros
        raise PowerAPIError("Falha de comunicação com a NASA POWER.") from exc
    finally:
        if close_client:
            await client.aclose()

    payload = response.json()
    parameters = payload.get("properties", {}).get("parameter", {})

    if not isinstance(parameters, dict) or not parameters:
        raise PowerAPIError("Resposta da NASA POWER sem dados de parâmetros.")

    fill_value = payload.get("header", {}).get("fill_value", -999.0)
    meta = _extract_meta(payload)

    if hour_start is None:
        dates = list(_iter_dates(parameters))
        if not dates:
            raise PowerAPIError("Nenhuma data disponível na resposta da NASA POWER.")

        records: List[PowerWeatherRecord] = []
        for date_key in dates:
            record = _build_daily_record(parameters, date_key, fill_value)
            if record is not None:
                records.append(record)

        if not records:
            raise PowerAPIError("Nenhum dado meteorológico utilizável encontrado para o período informado.")

        return PowerWeatherSummary(meta=meta, records=records, granularity="daily")

    # Consulta horária com suporte a intervalos
    if not (0 <= hour_start <= 23):
        raise PowerAPIError("Hora inicial inválida. Utilize valores entre 0 e 23.")

    if hour_end is not None and not (0 <= hour_end <= 23):
        raise PowerAPIError("Hora final inválida. Utilize valores entre 0 e 23.")

    multi_day_interval = end != start

    effective_hour_end = hour_start
    if hour_end is not None:
        effective_hour_end = hour_end
    elif multi_day_interval:
        effective_hour_end = 23

    if not (0 <= effective_hour_end <= 23):
        raise PowerAPIError("Hora final inválida. Utilize valores entre 0 e 23.")

    if not multi_day_interval and effective_hour_end < hour_start:
        raise PowerAPIError("A hora final deve ser maior ou igual à hora inicial.")

    time_keys = list(_iter_times(parameters))
    if not time_keys:
        raise PowerAPIError("Nenhum dado temporal disponível na resposta da NASA POWER.")

    # Se for multi-dia com intervalo de horas, filtra apenas as horas específicas de cada dia
    if multi_day_interval:
        range_records: List[PowerWeatherRecord] = []
        for time_key in time_keys:
            # time_key formato: YYYYMMDDHH
            if len(time_key) >= 10:
                date_part = time_key[:8]  # YYYYMMDD
                hour_part = int(time_key[8:10])  # HH
                
                # Verifica se a data está no range
                if start <= date_part <= end:
                    # Verifica se a hora está no intervalo especificado
                    if hour_start <= hour_part <= effective_hour_end:
                        record = _build_hourly_record(parameters, time_key, fill_value)
                        if record is not None:
                            range_records.append(record)
    else:
        # Modo de dia único: pega todas as horas do intervalo
        start_key = f"{start}{hour_start:02d}"
        end_key = f"{end}{effective_hour_end:02d}"
        
        range_records: List[PowerWeatherRecord] = []
        for time_key in time_keys:
            if start_key <= time_key <= end_key:
                record = _build_hourly_record(parameters, time_key, fill_value)
                if record is not None:
                    range_records.append(record)

    if not range_records:
        raise PowerAPIError("Nenhum dado meteorológico utilizável encontrado para o intervalo informado.")

    if len(range_records) == 1:
        return PowerWeatherSummary(meta=meta, records=range_records, granularity="hourly")

    aggregated = _aggregate_hourly_records(range_records)
    return PowerWeatherSummary(meta=meta, records=[aggregated], granularity="hourly", series=range_records)
