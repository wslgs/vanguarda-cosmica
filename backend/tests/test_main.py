import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from httpx import Response
import respx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app, get_geocoder, get_places_autocomplete  # noqa: E402
from app.power_client import DAILY_BASE_URL, HOURLY_BASE_URL  # noqa: E402


class DummyGeocoder:
    def __init__(self):
        paulista = SimpleNamespace(
            latitude=-23.561187,
            longitude=-46.655957,
            formatted_address="Avenida Paulista, São Paulo - SP, Brasil",
            place_id="teste-paulista",
        )
        brasilia = SimpleNamespace(
            latitude=-15.79945,
            longitude=-47.861667,
            formatted_address="Praça dos Três Poderes - Brasília, DF, Brasil",
            place_id="teste-brasilia",
        )
        self._by_address = {
            "avenida paulista": paulista,
            "praça dos três poderes": brasilia,
        }
        self._by_place_id = {
            paulista.place_id: paulista,
            brasilia.place_id: brasilia,
        }

    async def geocode(self, *, address=None, place_id=None):  # noqa: ANN001
        if place_id and place_id in self._by_place_id:
            return self._by_place_id[place_id]
        if address:
            return self._by_address.get(address.lower())
        return None


class DummyAutocomplete:
    async def suggest(self, *, input_text, session_token=None, language="pt-BR", types=None):  # noqa: ANN001
        fixtures = {
            "avenida": [
                {"description": "Avenida Paulista, São Paulo - SP, Brasil", "place_id": "teste-paulista"},
                {"description": "Avenida Brasil, Rio de Janeiro - RJ, Brasil", "place_id": "teste-brasil"},
            ],
            "praça": [
                {"description": "Praça dos Três Poderes, Brasília - DF, Brasil", "place_id": "teste-brasilia"},
            ],
        }
        results = fixtures.get(input_text.lower())
        if not results:
            return []
        return [SimpleNamespace(**item) for item in results]


client = TestClient(app)


def override_geocoder():
    return DummyGeocoder()


def override_autocomplete():
    return DummyAutocomplete()


def setup_module(_: object) -> None:  # pragma: no cover - hook do pytest
    app.dependency_overrides[get_geocoder] = override_geocoder
    app.dependency_overrides[get_places_autocomplete] = override_autocomplete


def teardown_module(_: object) -> None:  # pragma: no cover - hook do pytest
    app.dependency_overrides.clear()


def test_root_status():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["message"] == "API operacional"


def test_geocode_success():
    payload = {"query": "Avenida Paulista"}
    response = client.post("/api/geocode", json=payload)

    assert response.status_code == 200
    body = response.json()

    assert body["latitude"] == -23.561187
    assert body["longitude"] == -46.655957
    assert body["query"].lower() == payload["query"].lower()
    assert body["google_maps_url"].startswith("https://www.google.com/maps/search/")


def test_geocode_not_found():
    payload = {"query": "Portal Secreto"}
    response = client.post("/api/geocode", json=payload)

    assert response.status_code == 404
    assert "não encontrada" in response.json()["detail"].lower()


def test_geocode_with_place_id():
    payload = {"place_id": "teste-brasilia"}
    response = client.post("/api/geocode", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["place_id"] == "teste-brasilia"
    assert body["formatted_address"].startswith("Praça dos Três Poderes")


def test_place_autocomplete_success():
    response = client.get("/api/place-autocomplete", params={"input": "avenida"})

    assert response.status_code == 200
    body = response.json()
    assert len(body["suggestions"]) == 2
    assert body["suggestions"][0]["place_id"] == "teste-paulista"


def test_place_autocomplete_empty():
    response = client.get("/api/place-autocomplete", params={"input": "xyz"})

    assert response.status_code == 200
    body = response.json()
    assert body["suggestions"] == []


@respx.mock
def test_weather_summary_success(respx_mock: respx.MockRouter):
    mock_payload = {
        "header": {
            "api": {"name": "POWER", "version": "2"},
            "time_standard": "LST",
            "start": "20251001",
            "end": "20251001",
            "fill_value": -999.0,
        },
        "parameters": {
            "T2M": {"units": "C"},
            "WS10M": {"units": "m/s"},
            "PRECTOT": {"units": "mm"},
        },
        "properties": {
            "parameter": {
                "T2M": {"20251001": 25.0},
                "T2M_MAX": {"20251001": 30.0},
                "T2M_MIN": {"20251001": 20.0},
                "WS10M": {"20251001": 5.0},
                "PRECTOT": {"20251001": 1.0},
            }
        },
    }

    respx_mock.get(DAILY_BASE_URL).mock(return_value=Response(200, json=mock_payload))

    response = client.get(
        "/api/weather-summary",
        params={"lat": -7.12, "lon": -34.86, "start_date": "20251001"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["available_start"] == "20251001"
    assert body["granularity"] == "daily"
    assert len(body["data"]) == 1
    assert body["data"][0]["date"] == "2025-10-01"
    assert body["data"][0]["flags"]["rain_risk"] is False
    assert body["series"] is None


@respx.mock
def test_weather_summary_daily_range(respx_mock: respx.MockRouter):
    mock_payload = {
        "header": {
            "api": {"name": "POWER", "version": "2"},
            "time_standard": "LST",
            "start": "20251001",
            "end": "20251003",
            "fill_value": -999.0,
        },
        "parameters": {
            "T2M": {"units": "C"},
            "WS10M": {"units": "m/s"},
            "PRECTOT": {"units": "mm"},
        },
        "properties": {
            "parameter": {
                "T2M": {"20251001": 24.0, "20251002": 25.5, "20251003": 27.0},
                "T2M_MAX": {"20251001": 29.0, "20251002": 31.0, "20251003": 32.5},
                "T2M_MIN": {"20251001": 20.0, "20251002": 21.5, "20251003": 22.0},
                "WS10M": {"20251001": 4.0, "20251002": 5.5, "20251003": 6.0},
                "PRECTOT": {"20251001": 0.0, "20251002": 4.0, "20251003": 8.0},
            }
        },
    }

    respx_mock.get(DAILY_BASE_URL).mock(return_value=Response(200, json=mock_payload))

    response = client.get(
        "/api/weather-summary",
        params={
            "lat": -7.12,
            "lon": -34.86,
            "start_date": "20251001",
            "end_date": "20251003",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["granularity"] == "daily"
    assert len(body["data"]) == 3
    assert body["data"][1]["date"] == "2025-10-02"


@respx.mock
def test_weather_summary_service_failure(respx_mock: respx.MockRouter):
    respx_mock.get(DAILY_BASE_URL).mock(return_value=Response(500, json={"error": "fail"}))

    response = client.get(
        "/api/weather-summary",
        params={"lat": 0, "lon": 0, "start_date": "20251001"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ai_prediction"] is not None
    assert isinstance(payload.get("meta"), dict)
    assert len(payload["data"]) >= 1


@respx.mock
def test_weather_summary_hourly_success(respx_mock: respx.MockRouter):
    mock_payload = {
        "header": {
            "api": {"name": "POWER", "version": "2"},
            "time_standard": "UTC",
            "start": "20251001",
            "end": "20251001",
            "fill_value": -999.0,
        },
        "parameters": {
            "T2M": {"units": "C"},
            "WS10M": {"units": "m/s"},
            "PRECTOT": {"units": "mm"},
        },
        "properties": {
            "parameter": {
                "T2M": {"2025100110": 26.0},
                "WS10M": {"2025100110": 8.5},
                "PRECTOT": {"2025100110": 0.0},
            }
        },
    }

    respx_mock.get(HOURLY_BASE_URL).mock(return_value=Response(200, json=mock_payload))

    response = client.get(
        "/api/weather-summary",
        params={"lat": -7.12, "lon": -34.86, "start_date": "20251001", "hour_start": 10},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["granularity"] == "hourly"
    assert len(body["data"]) == 1
    assert body["data"][0]["hour"] == 10
    assert body["data"][0]["hour_end"] is None
    assert body["data"][0]["flags"]["wind_caution"] is True
    assert body["series"] is None


@respx.mock
def test_weather_summary_hourly_interval_success(respx_mock: respx.MockRouter):
    mock_payload = {
        "header": {
            "api": {"name": "POWER", "version": "2"},
            "time_standard": "UTC",
            "start": "20251001",
            "end": "20251001",
            "fill_value": -999.0,
        },
        "parameters": {
            "T2M": {"units": "C"},
            "WS10M": {"units": "m/s"},
            "PRECTOT": {"units": "mm"},
        },
        "properties": {
            "parameter": {
                "T2M": {"2025100109": 24.0, "2025100110": 26.0, "2025100111": 28.0},
                "WS10M": {"2025100109": 5.0, "2025100110": 7.0, "2025100111": 9.0},
                "PRECTOT": {"2025100109": 1.0, "2025100110": 2.0, "2025100111": 3.0},
            }
        },
    }

    respx_mock.get(HOURLY_BASE_URL).mock(return_value=Response(200, json=mock_payload))

    response = client.get(
        "/api/weather-summary",
        params={
            "lat": -7.12,
            "lon": -34.86,
            "start_date": "20251001",
            "hour_start": 9,
            "hour_end": 11,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["granularity"] == "hourly"
    assert len(body["data"]) == 1
    entry = body["data"][0]
    assert entry["hour"] == 9
    assert entry["hour_end"] == 11
    assert entry["t2m"] == 26.0
    assert entry["ws10m"] == 7.0
    assert entry["precip_mm"] == 2.0
    assert entry["flags"]["rain_risk"] is True
    assert body["series"] is not None
    assert len(body["series"]) == 3
    assert [item["hour"] for item in body["series"]] == [9, 10, 11]
