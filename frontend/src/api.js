const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, '') ?? '';

async function handleResponse(response) {
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
  const message = detail?.detail ?? 'Unexpected API error.';
    throw new Error(message);
  }
  return response.json();
}

export async function geocodeLocation(payload) {
  const response = await fetch(`${API_BASE}/api/geocode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function fetchWeatherSummary({ latitude, longitude, startDate, endDate, hourStart, hourEnd }) {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    start_date: startDate,
  });

  if (endDate) {
    params.set('end_date', endDate);
  }

  if (hourStart !== undefined && hourStart !== null) {
    params.set('hour_start', String(hourStart));
  }

  if (hourEnd !== undefined && hourEnd !== null) {
    params.set('hour_end', String(hourEnd));
  }

  const response = await fetch(`${API_BASE}/api/weather-summary?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  return handleResponse(response);
}

export async function fetchPlaceSuggestions({ input, sessionToken }) {
  const params = new URLSearchParams({ input });

  if (sessionToken) {
    params.set('session_token', sessionToken);
  }

  const response = await fetch(`${API_BASE}/api/place-autocomplete?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  return handleResponse(response);
}
