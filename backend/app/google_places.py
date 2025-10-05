from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import httpx


PLACES_AUTOCOMPLETE_ENDPOINT = "https://maps.googleapis.com/maps/api/place/autocomplete/json"


@dataclass(frozen=True)
class PlaceSuggestion:
    description: str
    place_id: str


class PlacesTransportError(RuntimeError):
    """Erros de transporte ao consultar a API do Google Places."""


class PlacesServiceError(RuntimeError):
    """Erros retornados pelo serviço de Places."""

    def __init__(self, status: str, message: Optional[str] = None) -> None:
        self.status = status
        detail = message or status
        super().__init__(detail)


class GooglePlacesAutocomplete:
    """Cliente minimalista para o endpoint de Autocomplete da Google."""

    def __init__(self, api_key: str, timeout: float = 5.0) -> None:
        if not api_key:
            raise ValueError("Google Maps API key is required")
        self.api_key = api_key
        self.timeout = timeout

    async def suggest(
        self,
        *,
        input_text: str,
        session_token: Optional[str] = None,
    language: str = "pt-BR",
    types: Optional[str] = None,
    ) -> List[PlaceSuggestion]:
        params = {
            "input": input_text,
            "key": self.api_key,
            "language": language,
        }

        if types:
            params["types"] = types

        if session_token:
            params["sessiontoken"] = session_token

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(PLACES_AUTOCOMPLETE_ENDPOINT, params=params)
        except httpx.RequestError as exc:  # pragma: no cover - falhas de rede raras
            raise PlacesTransportError("Erro de transporte ao consultar o Google Places.") from exc

        if response.status_code != httpx.codes.OK:
            raise PlacesTransportError(f"Resposta inesperada do Google Places ({response.status_code}).")

        payload = response.json()
        status = payload.get("status")

        if status == "OK":
            predictions = payload.get("predictions", [])
            suggestions: List[PlaceSuggestion] = []
            for item in predictions:
                description = item.get("description")
                place_id = item.get("place_id")
                if not description or not place_id:
                    continue
                suggestions.append(PlaceSuggestion(description=description, place_id=place_id))
            return suggestions

        if status == "ZERO_RESULTS":
            return []

        raise PlacesServiceError(status or "ERRO_DESCONHECIDO", payload.get("error_message"))
