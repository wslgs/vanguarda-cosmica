from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import httpx


GOOGLE_GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json"


@dataclass(frozen=True)
class GoogleGeocodeResult:
    latitude: float
    longitude: float
    formatted_address: str
    place_id: Optional[str]


class GoogleMapsGeocoder:
    """Cliente mínimo para o endpoint de geocodificação da Google."""

    def __init__(self, api_key: str, timeout: float = 5.0) -> None:
        if not api_key:
            raise ValueError("Google Maps API key is required")
        self.api_key = api_key
        self.timeout = timeout

    async def geocode(
        self,
        *,
        address: Optional[str] = None,
        place_id: Optional[str] = None,
    ) -> Optional[GoogleGeocodeResult]:
        if not address and not place_id:
            raise ValueError("É necessário informar 'address' ou 'place_id' para geocodificar.")

        params = {"key": self.api_key}
        if place_id:
            params["place_id"] = place_id
        else:
            params["address"] = address

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(GOOGLE_GEOCODE_ENDPOINT, params=params)
        except httpx.RequestError as exc:  # pragma: no cover - erro de rede
            raise GeocodingTransportError("Erro de transporte ao consultar o Google Maps.") from exc

        if response.status_code != httpx.codes.OK:
            raise GeocodingTransportError(
                f"Resposta inesperada do Google Maps ({response.status_code})."
            )

        payload = response.json()
        status = payload.get("status")

        if status == "OK":
            first = payload["results"][0]
            geometry = first.get("geometry", {}).get("location", {})
            try:
                latitude = float(geometry["lat"])
                longitude = float(geometry["lng"])
            except (KeyError, TypeError, ValueError) as exc:  # pragma: no cover - dados inválidos raros
                raise GeocodingServiceError("DADOS_INVALIDOS", "Resposta inesperada do Google Maps.") from exc

            return GoogleGeocodeResult(
                latitude=latitude,
                longitude=longitude,
                formatted_address=first.get("formatted_address", address or ""),
                place_id=first.get("place_id"),
            )

        if status == "ZERO_RESULTS":
            return None

        raise GeocodingServiceError(status or "ERRO_DESCONHECIDO", payload.get("error_message"))


class GeocodingTransportError(RuntimeError):
    """Erros relacionados a transporte (rede/status HTTP)."""


class GeocodingServiceError(RuntimeError):
    """Erros retornados pelo serviço do Google Maps."""

    def __init__(self, status: str, message: Optional[str] = None) -> None:
        self.status = status
        detail = message or status
        super().__init__(detail)
