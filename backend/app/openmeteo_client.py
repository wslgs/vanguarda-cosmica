# -*- coding: utf-8 -*-
"""
OpenMeteo Historical Weather Data Client
Provides high-resolution (1-11km) historical weather data as alternative to NASA POWER
"""

from datetime import datetime, timedelta
from typing import List, Optional
import httpx
import pandas as pd
import numpy as np


OPENMETEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
DEFAULT_TIMEOUT = 20.0


class OpenMeteoError(Exception):
    """Erro ao consultar OpenMeteo API"""


async def fetch_openmeteo_daily(
    lat: float,
    lon: float,
    start_date: str,  # YYYYMMDD
    end_date: str,    # YYYYMMDD
    timeout: float = DEFAULT_TIMEOUT
) -> pd.DataFrame:
    """
    Busca dados históricos diários do OpenMeteo Archive API.
    
    Args:
        lat: Latitude em graus decimais
        lon: Longitude em graus decimais
        start_date: Data inicial no formato YYYYMMDD
        end_date: Data final no formato YYYYMMDD
        timeout: Timeout em segundos
        
    Returns:
        DataFrame com index=date e colunas: T2M, T2M_MAX, T2M_MIN, WS10M, PRECTOT
        
    Raises:
        OpenMeteoError: Se houver erro na requisição
    """
    # Converter datas de YYYYMMDD para YYYY-MM-DD
    start_dt = datetime.strptime(start_date, "%Y%m%d")
    end_dt = datetime.strptime(end_date, "%Y%m%d")
    
    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")
    
    # Parâmetros da requisição
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_str,
        "end_date": end_str,
        "daily": [
            "temperature_2m_mean",      # Temperatura média (T2M)
            "temperature_2m_max",        # Temperatura máxima (T2M_MAX)
            "temperature_2m_min",        # Temperatura mínima (T2M_MIN)
            "windspeed_10m_max",         # Vento máximo (WS10M)
            "precipitation_sum"          # Precipitação total (PRECTOT)
        ],
        "timezone": "auto"
    }
    
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(OPENMETEO_ARCHIVE_URL, params=params)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        raise OpenMeteoError(f"Erro ao buscar dados do OpenMeteo: {exc}") from exc
    
    # Extrair dados diários
    daily_data = data.get("daily", {})
    
    if not daily_data:
        raise OpenMeteoError("Resposta do OpenMeteo sem dados diários")
    
    # Construir DataFrame
    dates_str = daily_data.get("time", [])
    dates = [datetime.strptime(d, "%Y-%m-%d").date() for d in dates_str]
    
    df = pd.DataFrame({
        "T2M": daily_data.get("temperature_2m_mean", []),
        "T2M_MAX": daily_data.get("temperature_2m_max", []),
        "T2M_MIN": daily_data.get("temperature_2m_min", []),
        "WS10M": daily_data.get("windspeed_10m_max", []),
        "PRECTOT": daily_data.get("precipitation_sum", []),
    }, index=dates)
    
    # Converter None para NaN
    df = df.replace({None: np.nan})
    
    # OpenMeteo retorna vento em km/h, converter para m/s
    if "WS10M" in df.columns:
        df["WS10M"] = df["WS10M"] / 3.6
    
    return df


async def fetch_openmeteo_multi_year(
    lat: float,
    lon: float,
    start: datetime,
    end: datetime,
    timeout: float = DEFAULT_TIMEOUT
) -> pd.DataFrame:
    """
    Busca dados do OpenMeteo dividindo em chunks anuais para maior robustez.
    Similar à estratégia usada com NASA POWER.
    
    Args:
        lat: Latitude
        lon: Longitude
        start: Data inicial (datetime)
        end: Data final (datetime)
        timeout: Timeout por chunk
        
    Returns:
        DataFrame concatenado com todos os anos
    """
    # OpenMeteo Archive tem dados até ~3-5 dias atrás
    # Limitar end_date para evitar erro 400
    from datetime import date
    today = date.today()
    max_end = today - timedelta(days=5)  # Dados disponíveis até 5 dias atrás
    
    end_date = min(end.date(), max_end)
    
    # Se data inicial é posterior aos dados disponíveis, retornar vazio
    if start.date() > end_date:
        raise OpenMeteoError(f"OpenMeteo não tem dados para período solicitado (após {max_end})")
    
    frames = []
    current = start.replace(month=1, day=1)
    
    while current.date() <= end_date:
        year = current.year
        year_start = max(current.date(), start.date())
        year_end = min(datetime(year, 12, 31).date(), end_date)
        
        start_str = year_start.strftime("%Y%m%d")
        end_str = year_end.strftime("%Y%m%d")
        
        try:
            df_year = await fetch_openmeteo_daily(lat, lon, start_str, end_str, timeout)
            frames.append(df_year)
        except OpenMeteoError as e:
            # Se um ano falha, continua com os outros
            print(f"Warning: OpenMeteo failed for year {year}: {e}")
            pass
        
        current = datetime(year + 1, 1, 1)
    
    if not frames:
        raise OpenMeteoError("Nenhum dado recuperado do OpenMeteo")
    
    # Concatenar e ordenar
    result = pd.concat(frames)
    result = result.sort_index()
    result = result[~result.index.duplicated(keep="last")]
    
    return result
