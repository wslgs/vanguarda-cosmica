from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from dotenv import load_dotenv

from .google_geocoder import (
    GeocodingServiceError,
    GeocodingTransportError,
    GoogleGeocodeResult,
    GoogleMapsGeocoder,
)
from .google_places import (
    GooglePlacesAutocomplete,
    PlaceSuggestion,
    PlacesServiceError,
    PlacesTransportError,
)
from .power_client import PowerAPIError, fetch_power_weather


load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv()


class GeocodeRequest(BaseModel):
    query: Optional[str] = Field(
        default=None,
        min_length=3,
        description="Place provided by the user (address, point of interest, etc.).",
    )
    place_id: Optional[str] = Field(
        default=None,
        min_length=3,
        description="Unique identifier returned by Google Places Autocomplete.",
    )

    @model_validator(mode="after")
    def validate_input(self) -> "GeocodeRequest":
        if not self.query and not self.place_id:
            raise ValueError("Provide a search text or select a valid suggestion.")
        return self


class GeocodeResponse(BaseModel):
    query: str
    latitude: float
    longitude: float
    formatted_address: Optional[str] = None
    place_id: Optional[str] = None
    google_maps_url: Optional[str] = None


class AutocompleteSuggestion(BaseModel):
    description: str
    place_id: str


class AutocompleteResponse(BaseModel):
    suggestions: list[AutocompleteSuggestion]


class WeatherFlags(BaseModel):
    rain_risk: bool
    wind_caution: bool
    heat_caution: bool


class WeatherRecord(BaseModel):
    date: str
    hour: Optional[int] = Field(default=None, description="Starting hour in the [0, 23] range when the granularity is hourly.")
    hour_end: Optional[int] = Field(
        default=None,
        description="Ending hour (inclusive) for aggregated hourly intervals."
    )
    t2m: Optional[float] = None
    t2m_max: Optional[float] = None
    t2m_min: Optional[float] = None
    ws10m: Optional[float] = None
    precip_mm: Optional[float] = None
    flags: WeatherFlags


class WeatherMeta(BaseModel):
    service: Optional[str] = None
    version: Optional[str] = None
    time_standard: Optional[str] = None
    available_start: Optional[str] = None
    available_end: Optional[str] = None
    units: Dict[str, Optional[str]] = Field(default_factory=dict)


class WeatherSummaryResponse(BaseModel):
    meta: WeatherMeta
    granularity: Literal["daily", "hourly"]
    data: list[WeatherRecord]
    series: Optional[list[WeatherRecord]] = Field(
        default=None,
        description="Detailed series with each requested hour when an interval is provided.",
    )


app = FastAPI(
    title="Geocoder Rain",
    version="0.4.0",
    description=(
        "API simples para transformar descrições de locais em coordenadas latitude/longitude"
        " utilizando o serviço de geocodificação do Google Maps e sugestões do Google Places."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_geocoder() -> GoogleMapsGeocoder:
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Variável de ambiente GOOGLE_MAPS_API_KEY não configurada.",
        )

    timeout = float(os.getenv("GEOCODER_TIMEOUT", "5"))
    return GoogleMapsGeocoder(api_key=api_key, timeout=timeout)


def get_places_autocomplete() -> GooglePlacesAutocomplete:
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Variável de ambiente GOOGLE_MAPS_API_KEY não configurada.",
        )

    timeout = float(os.getenv("GEOCODER_TIMEOUT", "5"))
    return GooglePlacesAutocomplete(api_key=api_key, timeout=timeout)


@app.get("/", tags=["status"])
def read_root() -> dict[str, str]:
    return {"message": "API operacional"}


@app.post(
    "/api/geocode",
    response_model=GeocodeResponse,
    status_code=status.HTTP_200_OK,
    tags=["geocode"],
)
async def geocode_location(
    payload: GeocodeRequest,
    geocoder: GoogleMapsGeocoder = Depends(get_geocoder),
) -> GeocodeResponse:
    query = payload.query.strip() if payload.query else None

    try:
        geocoded: Optional[GoogleGeocodeResult] = await geocoder.geocode(
            address=query,
            place_id=payload.place_id,
        )
    except GeocodingTransportError as exc:  # pragma: no cover - erros de rede raros
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Falha ao contactar o serviço de geocodificação do Google Maps.",
        ) from exc
    except GeocodingServiceError as exc:
        if exc.status in {"REQUEST_DENIED", "INVALID_REQUEST"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Solicitação rejeitada pelo Google Maps. Verifique os parâmetros enviados.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço de geocodificação temporariamente indisponível."
            if exc.status in {"OVER_QUERY_LIMIT", "UNKNOWN_ERROR"}
            else "Erro ao consultar o Google Maps.",
        ) from exc

    if geocoded is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Localização não encontrada.",
        )

    original_query = payload.query or geocoded.formatted_address or ""

    return GeocodeResponse(
        query=original_query,
        latitude=geocoded.latitude,
        longitude=geocoded.longitude,
        formatted_address=geocoded.formatted_address,
        place_id=geocoded.place_id,
        google_maps_url=(
            f"https://www.google.com/maps/search/?api=1&query={geocoded.latitude},{geocoded.longitude}"
            + (f"&query_place_id={geocoded.place_id}" if geocoded.place_id else "")
        ),
    )


@app.get(
    "/api/place-autocomplete",
    response_model=AutocompleteResponse,
    status_code=status.HTTP_200_OK,
    tags=["geocode"],
)
async def place_autocomplete(
    *,
    input: str = Query(..., min_length=2, description="Termo parcial informado pelo usuário."),
    session_token: Optional[str] = Query(None, description="Token de sessão para a API Google Places."),
    autocomplete: GooglePlacesAutocomplete = Depends(get_places_autocomplete),
) -> AutocompleteResponse:
    try:
        suggestions: list[PlaceSuggestion] = await autocomplete.suggest(
            input_text=input,
            session_token=session_token,
        )
    except PlacesTransportError as exc:  # pragma: no cover - erros de rede raros
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Falha ao contactar a API Google Places.",
        ) from exc
    except PlacesServiceError as exc:
        if exc.status in {"REQUEST_DENIED", "INVALID_REQUEST"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Solicitação rejeitada pelo Google Places. Verifique os parâmetros enviados.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço de autocomplete temporariamente indisponível.",
        ) from exc

    return AutocompleteResponse(
        suggestions=[
            AutocompleteSuggestion(description=suggestion.description, place_id=suggestion.place_id)
            for suggestion in suggestions
        ]
    )


@app.get(
    "/api/weather-summary",
    response_model=WeatherSummaryResponse,
    status_code=status.HTTP_200_OK,
    tags=["weather"],
)
async def weather_summary(
    *,
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude em graus decimais."),
    lon: float = Query(..., ge=-180.0, le=180.0, description="Longitude em graus decimais."),
    start_date: str = Query(
        ...,
        pattern=r"^\d{8}$",
        description="Data inicial no formato YYYYMMDD (tempo solar local).",
    ),
    end_date: Optional[str] = Query(
        None,
        pattern=r"^\d{8}$",
        description="Data final no formato YYYYMMDD. Quando omitida, utiliza a mesma data inicial.",
    ),
    hour_start: Optional[int] = Query(
        None,
        ge=0,
        le=23,
        description="Hora inicial (0-23). Quando informada, a resposta retornará dados horários ou agregados.",
    ),
    hour_end: Optional[int] = Query(
        None,
        ge=0,
        le=23,
        description=(
            "Hora final (0-23). Quando omitida em consultas horárias, assume o mesmo valor da hora inicial "
            "ou 23h caso o intervalo abranja várias datas."
        ),
    ),
) -> WeatherSummaryResponse:
    try:
        if hour_end is not None and hour_start is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Informe a hora inicial para consultar um intervalo horário.",
            )

        effective_start = start_date
        effective_end = end_date or start_date

        if effective_end < effective_start:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A data final deve ser maior ou igual à data inicial.",
            )

        resolved_hour_end = hour_end
        if hour_start is not None and resolved_hour_end is None and effective_end > effective_start:
            resolved_hour_end = 23

        summary = await fetch_power_weather(
            latitude=lat,
            longitude=lon,
            start=effective_start,
            end=effective_end,
            hour_start=hour_start,
            hour_end=resolved_hour_end,
        )
    except PowerAPIError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return WeatherSummaryResponse.model_validate(summary.to_dict())
