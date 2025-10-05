import pytest
import respx
from httpx import Response

from app.power_client import (
    DAILY_BASE_URL,
    HOURLY_BASE_URL,
    PowerAPIError,
    fetch_power_weather,
)


@pytest.mark.asyncio
@respx.mock
async def test_fetch_power_weather_success(respx_mock: respx.MockRouter):
    mock_payload = {
        "header": {
            "api": {"name": "POWER Test", "version": "1.0"},
            "time_standard": "LST",
            "start": "20251001",
            "end": "20251001",
            "fill_value": -999.0,
        },
        "parameters": {
            "T2M": {"units": "C"},
            "T2M_MAX": {"units": "C"},
            "WS10M": {"units": "m/s"},
            "PRECTOT": {"units": "mm"},
        },
        "properties": {
            "parameter": {
                "T2M": {"20251001": 26.3},
                "T2M_MAX": {"20251001": 32.1},
                "T2M_MIN": {"20251001": 20.0},
                "WS10M": {"20251001": 7.2},
                "PRECTOT": {"20251001": 3.4},
            }
        },
    }

    respx_mock.get(DAILY_BASE_URL).mock(return_value=Response(200, json=mock_payload))

    summary = await fetch_power_weather(latitude=-7.12, longitude=-34.86, start="20251001", end="20251001")

    assert summary.meta["service"] == "POWER Test"
    assert summary.meta["available_start"] == "20251001"
    assert summary.granularity == "daily"
    assert len(summary.records) == 1

    day = summary.records[0]
    assert day.date == "2025-10-01"
    assert day.hour is None
    assert day.t2m == 26.3
    assert day.ws10m == 7.2
    assert day.precip_mm == 3.4
    assert day.flags.rain_risk is True
    assert day.flags.wind_caution is True
    assert day.flags.heat_caution is True


@pytest.mark.asyncio
@respx.mock
async def test_fetch_power_weather_no_data(respx_mock: respx.MockRouter):
    mock_payload = {
        "header": {"fill_value": -999.0},
        "properties": {"parameter": {"T2M": {}}},
    }

    respx_mock.get(DAILY_BASE_URL).mock(return_value=Response(200, json=mock_payload))

    with pytest.raises(PowerAPIError):
        await fetch_power_weather(latitude=0.0, longitude=0.0, start="20251001", end="20251001")


@pytest.mark.asyncio
@respx.mock
async def test_fetch_power_weather_http_error(respx_mock: respx.MockRouter):
    respx_mock.get(DAILY_BASE_URL).mock(return_value=Response(500, json={"error": "boom"}))

    with pytest.raises(PowerAPIError):
        await fetch_power_weather(latitude=0.0, longitude=0.0, start="20251001", end="20251001")


@pytest.mark.asyncio
@respx.mock
async def test_fetch_power_weather_hourly(respx_mock: respx.MockRouter):
    mock_payload = {
        "header": {
            "api": {"name": "POWER Test", "version": "1.0"},
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
                "T2M": {"2025100115": 30.0},
                "WS10M": {"2025100115": 5.5},
                "PRECTOT": {"2025100115": 0.0},
            }
        },
    }

    respx_mock.get(HOURLY_BASE_URL).mock(return_value=Response(200, json=mock_payload))

    summary = await fetch_power_weather(
        latitude=-7.12,
        longitude=-34.86,
        start="20251001",
        end="20251001",
        hour_start=15,
    )

    assert summary.granularity == "hourly"
    assert len(summary.records) == 1

    record = summary.records[0]
    assert record.date == "2025-10-01"
    assert record.hour == 15
    assert record.hour_end is None
    assert record.t2m == 30.0
    assert record.flags.heat_caution is False
    assert summary.series is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_power_weather_hourly_interval(respx_mock: respx.MockRouter):
    mock_payload = {
        "header": {
            "api": {"name": "POWER Test", "version": "1.0"},
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
                "WS10M": {"2025100109": 4.0, "2025100110": 6.0, "2025100111": 8.0},
                "PRECTOT": {"2025100109": 0.5, "2025100110": 1.0, "2025100111": 1.5},
            }
        },
    }

    respx_mock.get(HOURLY_BASE_URL).mock(return_value=Response(200, json=mock_payload))

    summary = await fetch_power_weather(
        latitude=-7.12,
        longitude=-34.86,
        start="20251001",
        end="20251001",
        hour_start=9,
        hour_end=11,
    )

    assert summary.granularity == "hourly"
    assert len(summary.records) == 1

    record = summary.records[0]
    assert record.hour == 9
    assert record.hour_end == 11
    assert record.t2m == pytest.approx((24.0 + 26.0 + 28.0) / 3)
    assert record.ws10m == pytest.approx((4.0 + 6.0 + 8.0) / 3)
    assert record.precip_mm == pytest.approx((0.5 + 1.0 + 1.5) / 3)
    assert record.flags.rain_risk is True
    assert summary.series is not None
    assert [item.hour for item in summary.series] == [9, 10, 11]
