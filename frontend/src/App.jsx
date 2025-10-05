import { useEffect, useMemo, useState } from 'react';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

import { fetchPlaceSuggestions, fetchWeatherSummary, geocodeLocation } from './api.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

const GOOGLE_MAPS_EMBED_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' });
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});
const NUMBER_FORMATTER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function toUTCDate(dateString) {
  if (!dateString) {
    return null;
  }
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function buildMapSrc(result) {
  if (!result) {
    return null;
  }

  if (GOOGLE_MAPS_EMBED_KEY) {
    const query = result.place_id ? `place_id:${result.place_id}` : result.formatted_address ?? result.query;
    return `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_EMBED_KEY}&q=${encodeURIComponent(query)}`;
  }

  return `https://www.google.com/maps?q=${encodeURIComponent(`${result.latitude},${result.longitude}`)}&output=embed`;
}

function formatWeatherTitle(summary) {
  if (!summary) {
    return '';
  }

  const source = summary.series && summary.series.length > 0 ? summary.series : summary.data;
  if (!source || source.length === 0) {
    return '';
  }

  const startRecord = source[0];
  const endRecord = source[source.length - 1];
  const startDate = startRecord?.date ? DATE_FORMATTER.format(toUTCDate(startRecord.date)) : '';
  const endDate = endRecord?.date ? DATE_FORMATTER.format(toUTCDate(endRecord.date)) : '';

  if (summary.granularity === 'hourly') {
    const startHour = startRecord?.hour !== null && startRecord?.hour !== undefined
      ? `${String(startRecord.hour).padStart(2, '0')}h`
      : null;
    const endHour = endRecord?.hour !== null && endRecord?.hour !== undefined
      ? `${String(endRecord.hour).padStart(2, '0')}h`
      : null;

    if (source.length === 1) {
      return `${startDate}${startHour ? ` · ${startHour}` : ''}`;
    }

    if (startDate === endDate) {
      return `${startDate} · ${startHour ?? '--'} → ${endHour ?? '--'}`;
    }

    return `${startDate}${startHour ? ` · ${startHour}` : ''} → ${endDate}${endHour ? ` · ${endHour}` : ''}`;
  }

  if (source.length === 1 || startDate === endDate) {
    return startDate;
  }

  return `${startDate} → ${endDate}`;
}

function createSessionToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function describeTemperatureLevel(value, heatFlag = false) {
  if (value === null || value === undefined) {
    return null;
  }
  if (heatFlag || value >= 34) {
    return { tone: 'alert', icon: '🔥', text: 'Calor intenso previsto — priorize sombra e hidratação.' };
  }
  if (value >= 28) {
    return { tone: 'warning', icon: '🌡️', text: 'Temperatura elevada, planeje pausas para refrescar.' };
  }
  if (value <= 15) {
    return { tone: 'info', icon: '🧥', text: 'Clima fresco, considere uma camada extra de roupa.' };
  }
  return { tone: 'good', icon: '🌤️', text: 'Temperatura confortável para atividades externas.' };
}

function describeWindLevel(value, windFlag = false) {
  if (value === null || value === undefined) {
    return null;
  }
  if (windFlag || value >= 9) {
    return { tone: 'alert', icon: '💨', text: 'Rajadas fortes — prenda objetos soltos e redobre a atenção.' };
  }
  if (value >= 6) {
    return { tone: 'warning', icon: '🍃', text: 'Vento moderado constante, pode incomodar atividades externas.' };
  }
  if (value <= 1.5) {
    return { tone: 'good', icon: '🍃', text: 'Ar quase parado, sensação térmica estável.' };
  }
  return { tone: 'info', icon: '🍃', text: 'Brisa leve contribuindo para o conforto térmico.' };
}

function describePrecipitationLevel(value, rainFlag = false) {
  if (value === null || value === undefined) {
    return null;
  }
  if (rainFlag || value >= 5) {
    return { tone: 'alert', icon: '🌧️', text: 'Chuva significativa prevista — garanta abrigo ou capa de chuva.' };
  }
  if (value >= 2) {
    return { tone: 'warning', icon: '☔', text: 'Chance de chuva leve ou garoa prolongada, leve guarda-chuva.' };
  }
  if (value > 0) {
    return { tone: 'info', icon: '☂️', text: 'Possibilidade pequena de garoa rápida, acompanhe o céu.' };
  }
  return { tone: 'good', icon: '☀️', text: 'Sem indicativos de chuva para este período.' };
}

function buildChartInsight(values, type) {
  const numeric = (values ?? []).filter((value) => value !== null && value !== undefined);
  if (numeric.length === 0) {
    return 'Sem dados suficientes para o intervalo selecionado.';
  }

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const avg = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;

  if (type === 'temperature') {
    if (max >= 34) {
      return `Picos fortes de calor (${NUMBER_FORMATTER.format(max)}°C) — evite horários de maior exposição.`;
    }
    if (max >= 28) {
      return `Temperaturas altas, média de ${NUMBER_FORMATTER.format(avg)}°C no período.`;
    }
    return `Temperaturas estáveis entre ${NUMBER_FORMATTER.format(min)}°C e ${NUMBER_FORMATTER.format(max)}°C.`;
  }

  if (type === 'wind') {
    if (max >= 9) {
      return `Vento forte atingindo ${NUMBER_FORMATTER.format(max)} m/s — atenção a rajadas.`;
    }
    if (max >= 6) {
      return `Vento moderado predominando (média ${NUMBER_FORMATTER.format(avg)} m/s).`;
    }
    return `Vento leve, mantendo-se abaixo de ${NUMBER_FORMATTER.format(max)} m/s.`;
  }

  const total = numeric.reduce((sum, value) => sum + value, 0);
  if (max >= 5) {
    return `Chuva volumosa com picos de ${NUMBER_FORMATTER.format(max)} mm/h — programe abrigo.`;
  }
  if (max >= 2) {
    return `Oscilações de chuva leve (média ${NUMBER_FORMATTER.format(avg)} mm/h).`;
  }
  if (total === 0) {
    return 'Intervalo seco, sem precipitação registrada.';
  }
  return `Garoa eventual acumulando ${NUMBER_FORMATTER.format(total)} mm no intervalo.`;
}

export default function App() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState(() => createSessionToken());
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [weatherStartDate, setWeatherStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weatherEndDate, setWeatherEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weatherMode, setWeatherMode] = useState('single');
  const [weatherHourStart, setWeatherHourStart] = useState('');
  const [weatherHourEnd, setWeatherHourEnd] = useState('');
  const [weatherResult, setWeatherResult] = useState(null);
  const [weatherError, setWeatherError] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [selectedIntervalDate, setSelectedIntervalDate] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState('single');
  const [repeatDates, setRepeatDates] = useState([]);
  const [repeatDateDraft, setRepeatDateDraft] = useState(() => new Date().toISOString().slice(0, 10));
  const [repeatMonthCursor, setRepeatMonthCursor] = useState(() => {
    const base = new Date();
    base.setUTCDate(1);
    return base.toISOString().slice(0, 10);
  });

  const mapSrc = useMemo(() => buildMapSrc(result), [result]);
  const weatherUnits = weatherResult?.meta?.units ?? {};
  const tempUnit = weatherUnits.T2M ?? '°C';
  const precipUnit = weatherUnits.PRECTOTCORR ?? weatherUnits.PRECTOT ?? 'mm';
  const windUnit = weatherUnits.WS10M ?? 'm/s';

  const intervalSeries = useMemo(() => {
    if (!weatherResult?.series || weatherResult.series.length === 0) {
      return null;
    }

    const ordered = weatherResult.series
      .filter((entry) => entry.date && entry.hour !== null && entry.hour !== undefined)
      .slice()
      .sort((a, b) => {
        if (a.date === b.date) {
          return (a.hour ?? 0) - (b.hour ?? 0);
        }
        return a.date.localeCompare(b.date);
      });

    return ordered.length > 0 ? ordered : null;
  }, [weatherResult]);

  const hasIntervalSeries = Boolean(intervalSeries?.length);

  const intervalSeriesByDate = useMemo(() => {
    if (!intervalSeries) {
      return null;
    }

    const grouped = new Map();
    intervalSeries.forEach((entry) => {
      if (!grouped.has(entry.date)) {
        grouped.set(entry.date, []);
      }
      grouped.get(entry.date).push(entry);
    });

    return grouped;
  }, [intervalSeries]);

  const intervalDates = useMemo(() => {
    if (!intervalSeriesByDate) {
      return [];
    }
    return Array.from(intervalSeriesByDate.keys());
  }, [intervalSeriesByDate]);

  useEffect(() => {
    if (intervalDates.length === 0) {
      setSelectedIntervalDate(null);
      return;
    }

    setSelectedIntervalDate((previous) => (previous && intervalDates.includes(previous) ? previous : intervalDates[0]));
  }, [intervalDates]);

  useEffect(() => {
    setRepeatDates((previous) => {
      const filtered = previous.filter((date) => date >= weatherStartDate);
      return filtered.length === previous.length ? previous : filtered;
    });
    setRepeatDateDraft((previous) => {
      if (!previous || previous < weatherStartDate) {
        return weatherStartDate;
      }
      return previous;
    });
  }, [weatherStartDate]);

  const selectedIntervalSeries = useMemo(() => {
    if (!selectedIntervalDate || !intervalSeriesByDate) {
      return null;
    }

    const series = intervalSeriesByDate.get(selectedIntervalDate);
    if (!series || series.length === 0) {
      return null;
    }

    return series.slice().sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0));
  }, [intervalSeriesByDate, selectedIntervalDate]);

  const intervalChartData = useMemo(() => {
    if (!selectedIntervalSeries || selectedIntervalSeries.length === 0) {
      return null;
    }

    const labels = selectedIntervalSeries.map((entry) => `${String(entry.hour).padStart(2, '0')}h`);

    return {
      labels,
      datasets: {
        temperature: selectedIntervalSeries.map((entry) => (entry.t2m ?? null)),
        temperatureFlags: selectedIntervalSeries.map((entry) => entry.flags?.heat_caution ?? false),
        precipitation: selectedIntervalSeries.map((entry) => entry.precip_mm ?? 0),
        precipitationFlags: selectedIntervalSeries.map((entry) => entry.flags?.rain_risk ?? false),
        wind: selectedIntervalSeries.map((entry) => (entry.ws10m ?? null)),
        windFlags: selectedIntervalSeries.map((entry) => entry.flags?.wind_caution ?? false),
      },
    };
  }, [selectedIntervalSeries]);

  const intervalChartOptions = useMemo(() => {
    if (!hasIntervalSeries || !intervalChartData || !selectedIntervalSeries) {
      return null;
    }

    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: 'rgba(211, 214, 255, 0.75)',
            font: { size: 12 },
          },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: 'rgba(224, 226, 255, 0.9)',
          },
        },
        tooltip: {
          backgroundColor: 'rgba(6, 10, 32, 0.9)',
          borderColor: 'rgba(124, 241, 255, 0.3)',
          borderWidth: 1,
          titleColor: '#f3f4ff',
          bodyColor: '#f3f4ff',
        },
      },
    };

    return {
      temperature: {
        ...baseOptions,
        scales: {
          ...baseOptions.scales,
          y: {
            grid: {
              color: 'rgba(124, 241, 255, 0.08)',
            },
            ticks: {
              color: 'rgba(224, 226, 255, 0.85)',
            },
            title: {
              display: true,
              text: `Temperatura (${tempUnit})`,
              color: 'rgba(224, 226, 255, 0.8)',
            },
          },
        },
        plugins: {
          ...baseOptions.plugins,
          legend: {
            ...baseOptions.plugins.legend,
            display: false,
          },
        },
      },
      wind: {
        ...baseOptions,
        scales: {
          ...baseOptions.scales,
          y: {
            grid: {
              color: 'rgba(169, 107, 255, 0.15)',
            },
            ticks: {
              color: 'rgba(224, 226, 255, 0.85)',
            },
            title: {
              display: true,
              text: `Vento (${windUnit})`,
              color: 'rgba(224, 226, 255, 0.8)',
            },
          },
        },
        plugins: {
          ...baseOptions.plugins,
          legend: {
            ...baseOptions.plugins.legend,
            display: false,
          },
        },
      },
      precipitation: {
        ...baseOptions,
        scales: {
          ...baseOptions.scales,
          y: {
            grid: {
              color: 'rgba(64, 21, 136, 0.2)',
            },
            ticks: {
              color: 'rgba(184, 191, 255, 0.8)',
            },
            title: {
              display: true,
              text: `Precipitação (${precipUnit})`,
              color: 'rgba(184, 191, 255, 0.85)',
            },
          },
        },
        plugins: {
          ...baseOptions.plugins,
          legend: {
            ...baseOptions.plugins.legend,
            display: false,
          },
        },
      },
    };
  }, [hasIntervalSeries, intervalChartData, precipUnit, selectedIntervalSeries, tempUnit, windUnit]);

  const selectedIntervalDateLabel = useMemo(() => {
    if (!selectedIntervalDate) {
      return null;
    }
    return DATE_FORMATTER.format(toUTCDate(selectedIntervalDate));
  }, [selectedIntervalDate]);

  const weatherTitle = useMemo(() => formatWeatherTitle(weatherResult), [weatherResult]);

  const temperatureChartData = useMemo(() => {
    if (!intervalChartData) {
      return null;
    }
    const data = intervalChartData.datasets.temperature ?? [];
    const hasValues = data.some((value) => value !== null && value !== undefined);
    if (!hasValues) {
      return null;
    }

    const pointBackgroundColor = intervalChartData.datasets.temperatureFlags.map((flag) =>
      flag ? '#ff6b6b' : '#050014'
    );
    const pointBorderColor = intervalChartData.datasets.temperatureFlags.map((flag) =>
      flag ? '#ff6b6b' : '#7cf1ff'
    );

    return {
      labels: intervalChartData.labels,
      datasets: [
        {
          type: 'line',
          label: `Temperatura (${tempUnit})`,
          data,
          borderColor: '#7cf1ff',
          backgroundColor: 'rgba(124, 241, 255, 0.2)',
          fill: 'start',
          tension: 0.35,
          spanGaps: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor,
          pointBorderColor,
          pointBorderWidth: 2,
        },
      ],
    };
  }, [intervalChartData, tempUnit]);

  const windChartData = useMemo(() => {
    if (!intervalChartData) {
      return null;
    }
    const data = intervalChartData.datasets.wind ?? [];
    const hasValues = data.some((value) => value !== null && value !== undefined);
    if (!hasValues) {
      return null;
    }

    const pointBackgroundColor = intervalChartData.datasets.windFlags.map((flag) =>
      flag ? '#d7b4ff' : '#050014'
    );
    const pointBorderColor = intervalChartData.datasets.windFlags.map((flag) =>
      flag ? '#d7b4ff' : '#a96bff'
    );

    return {
      labels: intervalChartData.labels,
      datasets: [
        {
          type: 'line',
          label: `Vento (${windUnit})`,
          data,
          borderColor: '#a96bff',
          backgroundColor: 'rgba(169, 107, 255, 0.2)',
          fill: false,
          tension: 0.3,
          spanGaps: true,
          borderDash: [6, 4],
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor,
          pointBorderColor,
          pointBorderWidth: 2,
        },
      ],
    };
  }, [intervalChartData, windUnit]);

  const precipitationChartData = useMemo(() => {
    if (!intervalChartData) {
      return null;
    }
    const data = intervalChartData.datasets.precipitation ?? [];
    const hasValues = data.some((value) => value !== null && value !== undefined);
    if (!hasValues) {
      return null;
    }

    const backgroundColor = intervalChartData.datasets.precipitationFlags.map((flag) =>
      flag ? 'rgba(64, 21, 136, 0.7)' : 'rgba(64, 21, 136, 0.45)'
    );
    const hoverBackgroundColor = intervalChartData.datasets.precipitationFlags.map((flag) =>
      flag ? 'rgba(124, 241, 255, 0.65)' : 'rgba(124, 241, 255, 0.35)'
    );

    return {
      labels: intervalChartData.labels,
      datasets: [
        {
          type: 'bar',
          label: `Precipitação (${precipUnit})`,
          data,
          backgroundColor,
          hoverBackgroundColor,
          borderRadius: 10,
          maxBarThickness: 28,
        },
      ],
    };
  }, [intervalChartData, precipUnit]);

  const temperatureChartOptions = intervalChartOptions?.temperature ?? null;
  const windChartOptions = intervalChartOptions?.wind ?? null;
  const precipitationChartOptions = intervalChartOptions?.precipitation ?? null;

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 3) {
      setSuggestions([]);
      setSuggestionsVisible(false);
      setAutocompleteLoading(false);
      return;
    }

    if (!inputFocused) {
      setSuggestionsVisible(false);
      setAutocompleteLoading(false);
      return;
    }

    if (selectedSuggestion && trimmed === selectedSuggestion.description) {
      setSuggestions([]);
      setSuggestionsVisible(false);
      setAutocompleteLoading(false);
      return;
    }

    let isActive = true;
    setSuggestionsVisible(true);
    setAutocompleteLoading(true);

    const timer = setTimeout(async () => {
      try {
        const data = await fetchPlaceSuggestions({ input: trimmed, sessionToken });
        if (!isActive) {
          return;
        }
        setSuggestions(data.suggestions ?? []);
        setSuggestionsVisible(true);
      } catch (err) {
        if (!isActive) {
          return;
        }
        console.error('Falha ao carregar sugestões', err);
        setSuggestions([]);
      } finally {
        if (isActive) {
          setAutocompleteLoading(false);
        }
      }
    }, 250);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [inputFocused, query, selectedSuggestion, sessionToken]);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = query.trim();
    if ((trimmed.length === 0 && !selectedPlaceId) || loading) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const payload = {};
      if (trimmed.length > 0) {
        payload.query = trimmed;
      }
      if (selectedPlaceId) {
        payload.place_id = selectedPlaceId;
      }

      const data = await geocodeLocation(payload);
      setResult(data);
      setWeatherResult(null);
      setWeatherError(null);
      setSelectedPlaceId(data.place_id ?? selectedPlaceId ?? null);
      if (data.formatted_address) {
        setSelectedSuggestion({ description: data.formatted_address, place_id: data.place_id });
        setQuery(data.formatted_address);
      }
      setSessionToken(createSessionToken());
      setSuggestions([]);
    } catch (err) {
      setResult(null);
      setError(err.message ?? 'Não foi possível geocodificar a localização informada.');
    } finally {
      setLoading(false);
    }
  }

  async function handleWeatherSubmit(event) {
    event.preventDefault();
    if (!result || !weatherStartDate || weatherLoading) {
      return;
    }

    setWeatherError(null);

    const isIntervalMode = weatherMode === 'interval';

    const parseHour = (value, label) => {
      if (value === null || value === undefined) {
        return null;
      }
      const trimmed = String(value).trim();
      if (trimmed === '') {
        setWeatherError(`${label} deve ser informada.`);
        return null;
      }
      const numeric = Number(trimmed);
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 23) {
        setWeatherError(`${label} deve ser um número inteiro entre 0 e 23.`);
        return null;
      }
      return numeric;
    };

    let hourStartParam = null;
    let hourEndParam = null;

    if (isIntervalMode) {
      const startHourValue = parseHour(weatherHourStart, 'Hora inicial');
      const endHourValue = parseHour(weatherHourEnd, 'Hora final');
      if (startHourValue === null || endHourValue === null) {
        return;
      }

      if (endHourValue < startHourValue) {
        setWeatherError('A hora final deve ser maior ou igual à hora inicial.');
        return;
      }

      hourStartParam = startHourValue;
      hourEndParam = endHourValue;
    } else {
      const trimmedStart = weatherHourStart.trim();
      if (trimmedStart !== '') {
        const startHourValue = parseHour(trimmedStart, 'Hora selecionada');
        if (startHourValue === null) {
          return;
        }
        hourStartParam = startHourValue;
        hourEndParam = startHourValue;
      }
    }

    const selection = isIntervalMode
      ? Array.from(new Set([weatherStartDate, ...repeatDates])).filter(Boolean).sort()
      : [weatherStartDate];

    if (selection.length === 0) {
      setWeatherError('Selecione ao menos uma data válida.');
      return;
    }

    const rangeStart = selection[0];
    const rangeEnd = selection[selection.length - 1];

    try {
      setWeatherLoading(true);

      const summary = await fetchWeatherSummary({
        latitude: result.latitude,
        longitude: result.longitude,
        startDate: rangeStart.replace(/-/g, ''),
        endDate: rangeEnd.replace(/-/g, ''),
        hourStart: hourStartParam,
        hourEnd: hourEndParam,
      });

      if (isIntervalMode) {
        const selectedSet = new Set(selection);
        const filteredData = (summary.data ?? []).filter((record) => selectedSet.has(record.date));
        const filteredSeries = summary.series ? summary.series.filter((record) => selectedSet.has(record.date)) : null;

        setWeatherResult({
          ...summary,
          data: filteredData,
          series: filteredSeries,
          selectedDates: selection,
        });
        setWeatherEndDate(rangeEnd);
      } else {
        setWeatherResult(summary);
        setWeatherEndDate(rangeEnd);
      }
    } catch (err) {
      setWeatherResult(null);
      setWeatherError(err.message ?? 'Não foi possível recuperar os dados climáticos.');
    } finally {
      setWeatherLoading(false);
    }
  }

  function formatMetric(value, unit) {
    if (value === null || value === undefined) {
      return '—';
    }
    const formatted = NUMBER_FORMATTER.format(value);
    return unit ? `${formatted} ${unit}` : formatted;
  }

  const overallInsights = useMemo(() => {
    const sourceRecords = weatherResult?.series && weatherResult.series.length > 0
      ? weatherResult.series
      : weatherResult?.data ?? [];

    if (sourceRecords.length === 0) {
      return [];
    }

    const rainCount = sourceRecords.filter((entry) => entry.flags?.rain_risk).length;
    const windCount = sourceRecords.filter((entry) => entry.flags?.wind_caution).length;
    const heatCount = sourceRecords.filter((entry) => entry.flags?.heat_caution).length;

    const messages = [];

    messages.push(
      heatCount > 0
        ? {
            tone: 'alert',
            icon: '🔥',
            text: `${heatCount} ${heatCount === 1 ? 'momento' : 'momentos'} com calor intenso — planeje pausas à sombra.`,
          }
        : { tone: 'good', icon: '🌤️', text: 'Temperaturas dentro de um intervalo confortável na maior parte do período.' }
    );

    messages.push(
      rainCount > 0
        ? {
            tone: 'warning',
            icon: '☔',
            text: `Chuva presente em ${rainCount} ${rainCount === 1 ? 'registro' : 'registros'} — leve capa ou guarda-chuva.`,
          }
        : { tone: 'good', icon: '☀️', text: 'Nenhum indicativo relevante de chuva no período analisado.' }
    );

    messages.push(
      windCount > 0
        ? {
            tone: 'warning',
            icon: '💨',
            text: `Rajadas percebidas em ${windCount} ${windCount === 1 ? 'momento' : 'momentos'} — atenção extra ao ar livre.`,
          }
        : { tone: 'info', icon: '🍃', text: 'Ventos calmos predominam, sensação térmica mais estável.' }
    );

    return messages;
  }, [weatherResult]);

  const requestedRangeLabel = useMemo(() => {
    if (!weatherResult) {
      return null;
    }

    const manualSelection = Array.isArray(weatherResult.selectedDates)
      ? weatherResult.selectedDates
      : null;
    if (manualSelection && manualSelection.length > 0) {
      if (manualSelection.length === 1) {
        return DATE_FORMATTER.format(toUTCDate(manualSelection[0]));
      }

      if (manualSelection.length <= 4) {
        const joined = manualSelection
          .map((date) => SHORT_DATE_FORMATTER.format(toUTCDate(date)))
          .join(', ');
        return `Datas selecionadas: ${joined}`;
      }

      const firstLabel = SHORT_DATE_FORMATTER.format(toUTCDate(manualSelection[0]));
      const lastLabel = SHORT_DATE_FORMATTER.format(toUTCDate(manualSelection[manualSelection.length - 1]));
      return `Datas selecionadas (${manualSelection.length}): ${firstLabel} → ${lastLabel}`;
    }

    const sourceRecords = weatherResult.series && weatherResult.series.length > 0
      ? weatherResult.series
      : weatherResult.data ?? [];

    if (sourceRecords.length === 0) {
      return null;
    }

    const startRecord = sourceRecords[0];
    const endRecord = sourceRecords[sourceRecords.length - 1];

    if (!startRecord?.date) {
      return null;
    }

    let label = null;

    if (weatherResult.granularity === 'hourly' && sourceRecords.length > 1) {
      const startDay = SHORT_DATE_FORMATTER.format(toUTCDate(startRecord.date));
      const endDay = SHORT_DATE_FORMATTER.format(toUTCDate(endRecord.date));
      const startHour = startRecord?.hour !== null && startRecord?.hour !== undefined
        ? `${String(startRecord.hour).padStart(2, '0')}h`
        : null;
      const endHour = endRecord?.hour !== null && endRecord?.hour !== undefined
        ? `${String(endRecord.hour).padStart(2, '0')}h`
        : null;

      label = startDay === endDay
        ? `${startDay} · ${startHour ?? '--'} → ${endHour ?? '--'}`
        : `${startDay}${startHour ? ` · ${startHour}` : ''} → ${endDay}${endHour ? ` · ${endHour}` : ''}`;
    } else {
      const firstLabel = DATE_FORMATTER.format(toUTCDate(startRecord.date));
      if (sourceRecords.length === 1) {
        label = firstLabel;
      } else {
        const lastLabel = DATE_FORMATTER.format(toUTCDate(endRecord.date));
        label = firstLabel === lastLabel ? firstLabel : `${firstLabel} → ${lastLabel}`;
      }
    }

    if (!label) {
      return null;
    }

    if (weatherTitle && label === weatherTitle) {
      return null;
    }

    return label;
  }, [weatherResult, weatherTitle]);

  const chartInsights = useMemo(() => {
    if (!intervalChartData) {
      return null;
    }
    return {
      temperature: buildChartInsight(intervalChartData.datasets.temperature, 'temperature'),
      wind: buildChartInsight(intervalChartData.datasets.wind, 'wind'),
      precipitation: buildChartInsight(intervalChartData.datasets.precipitation, 'precipitation'),
    };
  }, [intervalChartData]);

  function handleSuggestionSelect(suggestion) {
    setQuery(suggestion.description);
    setSuggestions([]);
    setSuggestionsVisible(false);
    setSessionToken(createSessionToken());
    setSelectedPlaceId(suggestion.place_id);
    setSelectedSuggestion(suggestion);
    setInputFocused(false);
  }

  function handleQueryChange(event) {
    setQuery(event.target.value);
    setSelectedPlaceId(null);
    setSelectedSuggestion(null);
    setInputFocused(true);
  }

  function handleInputFocus() {
    setInputFocused(true);
    if (query.trim().length >= 3) {
      setSuggestionsVisible(true);
    }
  }

  function handleInputBlur() {
    setInputFocused(false);
    setTimeout(() => {
      setSuggestionsVisible(false);
    }, 120);
  }

  function handleReset() {
    setQuery('');
    setSuggestions([]);
    setSuggestionsVisible(false);
    setSessionToken(createSessionToken());
    setResult(null);
    setError(null);
    setWeatherMode('single');
    const today = new Date().toISOString().slice(0, 10);
    setWeatherStartDate(today);
    setWeatherEndDate(today);
    setWeatherHourStart('');
    setWeatherHourEnd('');
    setWeatherResult(null);
    setWeatherError(null);
    setSelectedIntervalDate(null);
    setRepeatDates([]);
    setRepeatDateDraft(today);
  }

  function openCalendar(mode = 'single') {
    setCalendarMode(mode);
    setCalendarOpen(true);
    setRepeatDateDraft((previous) => (!previous || previous < weatherStartDate ? weatherStartDate : previous));
    setRepeatMonthCursor(() => {
      const d = toUTCDate(weatherStartDate);
      d.setUTCDate(1);
      return d.toISOString().slice(0, 10);
    });
  }

  function closeCalendar() {
    setCalendarOpen(false);
  }

  function handleRepeatRemove(date) {
    const current = new Set([weatherStartDate, ...repeatDates]);
    current.delete(date);
    if (current.size === 0) {
      return;
    }
    const ordered = Array.from(current).sort();
    setWeatherStartDate(ordered[0]);
    setRepeatDates(ordered.slice(1));
  }

  function handleRepeatClear() {
    setRepeatDates([]);
    setRepeatDateDraft(weatherStartDate);
  }

  function getMonthMatrix(cursorDateStr) {
    const first = toUTCDate(cursorDateStr);
    const year = first.getUTCFullYear();
    const month = first.getUTCMonth();
    const firstWeekday = first.getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateObj = new Date(Date.UTC(year, month, day));
      const iso = dateObj.toISOString().slice(0, 10);
      cells.push(iso);
    }
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  }

  function shiftMonth(delta) {
    setRepeatMonthCursor((current) => {
      const d = toUTCDate(current);
      d.setUTCMonth(d.getUTCMonth() + delta);
      d.setUTCDate(1);
      return d.toISOString().slice(0, 10);
    });
  }

  function toggleRepeatDate(dateStr) {
    if (!dateStr) return;
    if (calendarMode === 'single') {
      setWeatherStartDate(dateStr);
      setRepeatDates([]);
      closeCalendar();
      return;
    }
    const setAll = new Set([weatherStartDate, ...repeatDates]);
    if (setAll.has(dateStr)) {
      if (setAll.size === 1) return;
      setAll.delete(dateStr);
    } else {
      setAll.add(dateStr);
    }
    const ordered = Array.from(setAll).sort();
    setWeatherStartDate(ordered[0]);
    setRepeatDates(ordered.slice(1));
  }

  return (
    <main className="cosmic-app">
      {calendarOpen && (
        <div className="repeat-overlay" role="presentation" onClick={closeCalendar}>
          <div
            className="repeat-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="repeat-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="repeat-dialog__header">
              <h3 id="repeat-dialog-title">
                {calendarMode === 'single' ? 'Selecionar data' : 'Selecionar dias'}
              </h3>
              <button
                type="button"
                className="repeat-close"
                onClick={closeCalendar}
                aria-label="Fechar seleção de dias"
              >
                ×
              </button>
            </header>
            <div className="repeat-dialog-body">
              <div className="mini-cal-header">
                <button
                  type="button"
                  className="mini-cal-nav"
                  onClick={() => shiftMonth(-1)}
                  aria-label="Mês anterior"
                >
                  ‹
                </button>
                {(() => {
                  const d = toUTCDate(repeatMonthCursor);
                  const month = d.toLocaleString('pt-BR', { month: 'long', timeZone: 'UTC' });
                  return <h4 className="mini-cal-title">{month} {d.getUTCFullYear()}</h4>;
                })()}
                <button
                  type="button"
                  className="mini-cal-nav"
                  onClick={() => shiftMonth(1)}
                  aria-label="Próximo mês"
                >
                  ›
                </button>
              </div>
              <table className="mini-cal" role="grid" aria-label={calendarMode === 'single' ? 'Calendário de seleção única' : 'Calendário de seleção múltipla'}>
                <thead>
                  <tr>
                    {['D','S','T','Q','Q','S','S'].map((wd) => (
                      <th key={wd} scope="col">{wd}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {getMonthMatrix(repeatMonthCursor).map((week, wi) => (
                    <tr key={`w-${wi}`}>
                      {week.map((cell, ci) => {
                        if (!cell) {
                          return <td key={`c-${wi}-${ci}`} className="empty" />;
                        }
                        const selectedSet = new Set([weatherStartDate, ...repeatDates]);
                        const isBase = cell === weatherStartDate;
                        const isSelected = selectedSet.has(cell) && !isBase;
                        const disabled = false;
                        const label = DATE_FORMATTER.format(toUTCDate(cell));
                        return (
                          <td key={cell}>
                            <button
                              type="button"
                              className={
                                'mini-cal-day' +
                                (isBase ? ' base' : '') +
                                (isSelected ? ' picked' : '') +
                                (disabled ? ' disabled' : '') +
                                (calendarMode === 'single' ? ' single-mode' : '')
                              }
                              onClick={() => !disabled && toggleRepeatDate(cell)}
                              disabled={disabled}
                              aria-pressed={isSelected}
                              aria-label={isBase ? `${label} (data inicial)` : label}
                            >
                              {Number(cell.slice(-2))}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {calendarMode === 'repeat' && (
                <div className="repeat-summary repeat-summary--dialog">
                  <span className="repeat-summary__label">Dias selecionados</span>
                  {repeatDates.length === 0 ? (
                    <p className="repeat-summary__empty">Somente a data base — clique em outras para adicionar.</p>
                  ) : (
                    <ul className="repeat-summary__list">
                      {[weatherStartDate, ...repeatDates].map((date) => (
                        <li key={`dialog-${date}`} className={date === weatherStartDate ? 'repeat-pill base-pill' : 'repeat-pill'}>
                          <span>{DATE_FORMATTER.format(toUTCDate(date))}</span>
                          {date !== weatherStartDate && (
                            <button
                              type="button"
                              onClick={() => handleRepeatRemove(date)}
                              aria-label={`Remover ${DATE_FORMATTER.format(toUTCDate(date))}`}
                            >
                              ×
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="repeat-summary__hint">Clique novamente em um dia para removê-lo (exceto o primeiro).</p>
                </div>
              )}
            </div>
            <div className="repeat-dialog-actions">
              {calendarMode === 'repeat' && (
                <button
                  type="button"
                  className="ghost"
                  onClick={handleRepeatClear}
                  disabled={repeatDates.length === 0}
                >
                  Limpar seleção
                </button>
              )}
              <button type="button" className="cta" onClick={closeCalendar}>
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="cosmic-backdrop" aria-hidden="true" />

      <header className="app-header" role="banner">
        <div className="brand" aria-label="Rain">
          <span className="brand__name">RAIN</span>
        </div>
        <p className="brand__tagline">Inteligência atmosférica em escala orbital.</p>
      </header>

      <section className="interface-grid">
        <article className="panel search-panel">
          <header className="panel-header">
            <h2>Inserir localização</h2>
            <p>Insira um local no mundo para gerar a previsão.</p>
          </header>

          <form className="search-form" onSubmit={handleSubmit}>
            <label htmlFor="place-query" className="search-label">
              Local desejado
              <div className="autocomplete">
                <input
                  id="place-query"
                  name="place-query"
                  type="text"
                  value={query}
                  onChange={handleQueryChange}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  placeholder="Ex.: Parque Ibirapuera, São Paulo"
                  autoComplete="off"
                  required={!selectedPlaceId}
                />
                {autocompleteLoading && <span className="autocomplete-status">Buscando…</span>}
                {suggestionsVisible && suggestions.length > 0 && (
                  <ul className="autocomplete-list" role="listbox">
                    {suggestions.map((suggestion) => (
                      <li key={suggestion.place_id}>
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            handleSuggestionSelect(suggestion);
                          }}
                        >
                          {suggestion.description}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!autocompleteLoading &&
                  suggestionsVisible &&
                  suggestions.length === 0 &&
                  query.trim().length >= 3 && (
                    <div className="autocomplete-empty">Nenhuma sugestão encontrada.</div>
                  )}
              </div>
            </label>

            <div className="search-actions">
              <button type="submit" className="cta" disabled={loading}>
                {loading ? 'Buscando…' : 'Buscar Local'}
              </button>
              <button type="button" className="ghost" onClick={handleReset} disabled={loading}>
                Limpar
              </button>
            </div>
          </form>

          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
        </article>

        <article className="panel result-panel" role="status">
          {result ? (
            <>
              <header className="result-header">
                <div className="result-heading">
                  <h2>{result.formatted_address ?? 'Local selecionado'}</h2>
                  <p className="result-query">Consulta: {query || '—'}</p>
                  {result.google_maps_url && (
                    <a className="maps-link" href={result.google_maps_url} target="_blank" rel="noreferrer">
                      Abrir no Google Maps ↗
                    </a>
                  )}
                </div>
              </header>

              <div className="map-wrapper">
                {mapSrc ? (
                  <iframe
                    key={mapSrc}
                    title="Mapa do Google"
                    src={mapSrc}
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ) : (
                  <p className="map-placeholder">Mapa indisponível. Confira o link acima.</p>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h3>Pronto para decolar</h3>
              <p>
                Escolha um destino para visualizar o mapa interativo, copiar coordenadas e consultar o clima com dados
                oficiais.
              </p>
            </div>
          )}
        </article>
      </section>

      {result && (
        <section className="panel weather-panel">
          <header className="panel-header">
            <h2>Condições atmosféricas</h2>
            <p>
              Consulte a previsão baseada na NASA POWER para {result.formatted_address ?? 'o local selecionado'} e ajuste o
              nível de detalhe conforme a sua necessidade.
            </p>
          </header>

          <form className="weather-form" onSubmit={handleWeatherSubmit}>
            <fieldset className="segmented" role="radiogroup" aria-label="Tipo de consulta de clima">
              <legend>Tipo de consulta</legend>
              <label className={weatherMode === 'single' ? 'active' : ''}>
                <input
                  type="radio"
                  name="weather-mode"
                  value="single"
                  checked={weatherMode === 'single'}
                  onChange={() => {
                    setWeatherMode('single');
                    setWeatherError(null);
                    setWeatherEndDate(weatherStartDate);
                    setWeatherHourEnd('');
                    setRepeatDates([]);
                    setCalendarOpen(false);
                  }}
                />
                <span className="mode-title">Momento único</span>
              </label>
              <label className={weatherMode === 'interval' ? 'active' : ''}>
                <input
                  type="radio"
                  name="weather-mode"
                  value="interval"
                  checked={weatherMode === 'interval'}
                  onChange={() => {
                    setWeatherMode('interval');
                    setWeatherError(null);
                    setWeatherHourStart((prev) => (prev.trim() === '' ? '0' : prev));
                    setWeatherHourEnd((prev) => (prev.trim() === '' ? '23' : prev));
                    setWeatherEndDate((prev) => (!prev || prev < weatherStartDate ? weatherStartDate : prev));
                  }}
                />
                <span className="mode-title">Intervalo contínuo</span>
              </label>
            </fieldset>

            {weatherMode === 'single' && (
              <div className="single-timing">
                <div className="date-picker-trigger" role="button" tabIndex={0} onClick={() => openCalendar('single')} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openCalendar('single')}>
                  <span className="date-picker-trigger__label">Data</span>
                  <span className="date-picker-trigger__value">{DATE_FORMATTER.format(toUTCDate(weatherStartDate))}</span>
                </div>
                <div className="time-input-group inline">
                  <span className="time-input-label">
                    Hora
                    <span className="time-badge optional">Opcional</span>
                  </span>
                  <div className="time-range-row">
                    <div className="time-input-wrapper">
                      <input
                        id="weather-hour-single"
                        name="weather-hour-single"
                        type="number"
                        min="0"
                        max="23"
                        step="1"
                        inputMode="numeric"
                        value={weatherHourStart}
                        onChange={(event) => {
                          setWeatherHourStart(event.target.value);
                          setWeatherError(null);
                        }}
                        placeholder="14"
                      />
                      <span className="time-suffix">H</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {weatherMode === 'interval' && (
              <div className="interval-grid" role="group" aria-label="Intervalo de datas e horas">
                <div className="interval-column">
                  <div className="date-picker-trigger" role="button" tabIndex={0} onClick={() => openCalendar('repeat')} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openCalendar('repeat')}>
                    <span className="date-picker-trigger__label">Datas</span>
                    <span className="date-picker-trigger__value">
                      {[weatherStartDate, ...repeatDates].map((d) => SHORT_DATE_FORMATTER.format(toUTCDate(d))).join(', ')}
                    </span>
                  </div>
                  <div className="time-input-group inline">
                    <span className="time-input-label">Horas</span>
                    <div className="time-range-row">
                      <div className="time-input-wrapper">
                        <input
                          id="weather-hour-start"
                          name="weather-hour-start"
                          type="number"
                          min="0"
                          max="23"
                          step="1"
                          inputMode="numeric"
                          value={weatherHourStart}
                          onChange={(event) => {
                            setWeatherHourStart(event.target.value);
                            setWeatherError(null);
                          }}
                          required
                        />
                        <span className="time-suffix">H</span>
                      </div>
                      <span className="time-separator">→</span>
                      <div className="time-input-wrapper">
                        <input
                          id="weather-hour-end"
                          name="weather-hour-end"
                          type="number"
                          min="0"
                          max="23"
                          step="1"
                          inputMode="numeric"
                          value={weatherHourEnd}
                          onChange={(event) => {
                            setWeatherHourEnd(event.target.value);
                            setWeatherError(null);
                          }}
                          required
                        />
                        <span className="time-suffix">H</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="interval-column">
                  <div className="repeat-summary">
                    <span className="repeat-summary__label">Dias</span>
                    <p className="repeat-summary__hint">
                      {repeatDates.length === 0
                        ? 'Apenas a data base.'
                        : `${repeatDates.length + 1} selecionados.`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button type="submit" className="cta" disabled={weatherLoading}>
              {weatherLoading ? 'Consultando…' : 'Consultar clima'}
            </button>
          </form>

          {weatherError && (
            <div className="notice error" role="alert">
              {weatherError}
            </div>
          )}

          {weatherResult && (
            <div className={hasIntervalSeries ? 'weather-outcome interval' : 'weather-outcome'}>
              <header className="weather-summary-header">
                <h3>{weatherTitle || 'Resumo climático'}</h3>
                {weatherResult.granularity !== 'hourly' && requestedRangeLabel && (
                  <p className="weather-meta">Período: {requestedRangeLabel}</p>
                )}
              </header>

              {overallInsights.length > 0 && (
                <ul className="feedback-grid compact" role="status" aria-live="polite">
                  {overallInsights.map((insight, index) => (
                    <li key={`overview-${index}`} className={`feedback-bubble ${insight.tone}`}>
                      <span aria-hidden="true">{insight.icon}</span>
                      {insight.text}
                    </li>
                  ))}
                </ul>
              )}

              {hasIntervalSeries && intervalDates.length > 0 && (
                <div className="interval-day-selector" role="group" aria-label="Selecionar dia do intervalo">
                  <span className="interval-day-selector__label">Dias disponíveis</span>
                  <div className="interval-day-selector__options">
                    {intervalDates.map((date) => {
                      const isActive = date === selectedIntervalDate;
                      const label = SHORT_DATE_FORMATTER.format(toUTCDate(date));
                      const fullLabel = DATE_FORMATTER.format(toUTCDate(date));
                      return (
                        <button
                          key={date}
                          type="button"
                          className={isActive ? 'active' : undefined}
                          aria-pressed={isActive}
                          onClick={() => setSelectedIntervalDate(date)}
                          title={fullLabel}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {!hasIntervalSeries && (
                <div className="weather-grid">
                  {weatherResult.data.map((entry) => {
                    const hasHourlyData = weatherResult.granularity === 'hourly';
                    const startHour = entry.hour;
                    const endHour = entry.hour_end ?? null;
                    const hasIntervalSeriesEntry =
                      hasHourlyData &&
                      startHour !== null &&
                      startHour !== undefined &&
                      endHour !== null &&
                      endHour !== undefined &&
                      endHour !== startHour;
                    const hourLabel =
                      hasHourlyData && startHour !== null && startHour !== undefined
                        ? `${String(startHour).padStart(2, '0')}h${hasIntervalSeriesEntry ? ` – ${String(endHour).padStart(2, '0')}h` : ''}`
                        : null;

                    const dateLabel = DATE_FORMATTER.format(toUTCDate(entry.date));
                    const headingLabel = dateLabel;
                    const metaLabel = weatherResult.granularity === 'daily'
                      ? 'Dados diários'
                      : hourLabel ?? 'Dados horários';

                    return (
                      <article
                        key={`${entry.date}-${entry.hour ?? 'day'}-${entry.hour_end ?? 'single'}`}
                        className={hasHourlyData ? 'weather-day hourly' : 'weather-day'}
                      >
                        <header className="weather-day__header">
                          <h4 className="weather-day__label">{headingLabel}</h4>
                          {metaLabel && (
                            <span className="weather-day__meta" title={metaLabel}>{metaLabel}</span>
                          )}
                        </header>

                        <dl className="weather-day__metrics">
                          <div className="weather-day__metric">
                            <dt>Temperatura</dt>
                            <dd>{formatMetric(entry.t2m, weatherUnits.T2M ?? '°C')}</dd>
                          </div>
                          {weatherResult.granularity === 'daily' && (
                            <>
                              <div className="weather-day__metric">
                                <dt>Máxima</dt>
                                <dd>{formatMetric(entry.t2m_max, weatherUnits.T2M ?? '°C')}</dd>
                              </div>
                              <div className="weather-day__metric">
                                <dt>Mínima</dt>
                                <dd>{formatMetric(entry.t2m_min, weatherUnits.T2M ?? '°C')}</dd>
                              </div>
                            </>
                          )}
                          <div className="weather-day__metric">
                            <dt>Vento a 10 m</dt>
                            <dd>{formatMetric(entry.ws10m, weatherUnits.WS10M ?? 'm/s')}</dd>
                          </div>
                          <div className="weather-day__metric">
                            <dt>Precipitação</dt>
                            <dd>{formatMetric(entry.precip_mm, weatherUnits.PRECTOTCORR ?? weatherUnits.PRECTOT ?? 'mm')}</dd>
                          </div>
                        </dl>
                      </article>
                    );
                  })}
                </div>
              )}

              {hasIntervalSeries && intervalChartData && (
                <div className="weather-chart-card">
                  <header>
                    <h4>Variação no intervalo selecionado</h4>
                    <p>
                      Explore a evolução de temperatura, vento e precipitação hora a hora.
                      {selectedIntervalDateLabel && (
                        <>
                          {' '}
                          <span className="chart-day-label">Dia selecionado: {selectedIntervalDateLabel}</span>
                        </>
                      )}
                    </p>
                  </header>
                  <div className="chart-grid">
                    {temperatureChartData && temperatureChartOptions && (
                      <article className="chart-panel" aria-label="Gráfico de temperatura por hora">
                        <h5>Temperatura</h5>
                        <p className="chart-insight">{chartInsights?.temperature}</p>
                        <div className="chart-canvas">
                          <Line key={`temperature-${selectedIntervalDate ?? 'none'}`} options={temperatureChartOptions} data={temperatureChartData} />
                        </div>
                      </article>
                    )}
                    {windChartData && windChartOptions && (
                      <article className="chart-panel" aria-label="Gráfico de vento por hora">
                        <h5>Vento</h5>
                        <p className="chart-insight">{chartInsights?.wind}</p>
                        <div className="chart-canvas">
                          <Line key={`wind-${selectedIntervalDate ?? 'none'}`} options={windChartOptions} data={windChartData} />
                        </div>
                      </article>
                    )}
                    {precipitationChartData && precipitationChartOptions && (
                      <article className="chart-panel" aria-label="Gráfico de precipitação por hora">
                        <h5>Precipitação</h5>
                        <p className="chart-insight">{chartInsights?.precipitation}</p>
                        <div className="chart-canvas">
                          <Bar key={`precipitation-${selectedIntervalDate ?? 'none'}`} options={precipitationChartOptions} data={precipitationChartData} />
                        </div>
                      </article>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        <small>Fontes de dados: Google Maps Platform · NASA POWER</small>
      </footer>
    </main>
  );
}
