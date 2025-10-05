import { useCallback, useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';

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
import { useTranslation } from './i18n.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

const GOOGLE_MAPS_EMBED_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

function toUTCDate(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }
  try {
    const [year, month, day] = dateString.split('-').map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return null;
    }
    return new Date(Date.UTC(year, month - 1, day));
  } catch (error) {
    console.error('Invalid date string:', dateString, error);
    return null;
  }
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

function formatWeatherTitle(summary, dateFormatter) {
  if (!summary) {
    return '';
  }

  const source = summary.series && summary.series.length > 0 ? summary.series : summary.data;
  if (!source || source.length === 0) {
    return '';
  }

  const startRecord = source[0];
  const endRecord = source[source.length - 1];
  const startDate = startRecord?.date ? dateFormatter.format(toUTCDate(startRecord.date)) : '';
  const endDate = endRecord?.date ? dateFormatter.format(toUTCDate(endRecord.date)) : '';

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

function generatePDF({
  weatherResult,
  geocodeResult,
  t,
  locale = 'en',
  filters = {},
  insights = [],
  selectedIntervalSeries = null,
  selectedIntervalDateLabel = null,
  units = {},
}) {
  try {
    if (!weatherResult) {
      throw new Error('Missing weather data');
    }

    const localeTag = locale === 'pt' ? 'pt-BR' : 'en-US';
    const numberFormatter = new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 });
    const dateFormatter = new Intl.DateTimeFormat(localeTag, { dateStyle: 'long', timeZone: 'UTC' });

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const primaryColor = [169, 107, 255];
    const textColor = [40, 40, 60];
    const lightGray = [200, 200, 210];
    const subtleRow = [245, 245, 250];

    const pageWidth = doc.internal.pageSize.getWidth();
    const marginLeft = 20;
    const marginRight = 20;
    const contentWidth = pageWidth - marginLeft - marginRight;
    let yPos = 20;

    const ensureSpace = (needed = 12) => {
      if (yPos + needed > 275) {
        doc.addPage();
        yPos = 20;
      }
    };

    const resolvedLocation = filters.locationName
      ?? geocodeResult?.formatted_address
      ?? geocodeResult?.query
      ?? '';

    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(t.pdfReportTitle, pageWidth / 2, 20, { align: 'center' });

    if (resolvedLocation) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text(resolvedLocation, pageWidth / 2, 30, { align: 'center' });
    }

    yPos = 50;
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    if (geocodeResult?.latitude !== undefined && geocodeResult?.longitude !== undefined) {
      const coordinateText = t.pdfCoordinates
        .replace('{lat}', geocodeResult.latitude.toFixed(4))
        .replace('{lon}', geocodeResult.longitude.toFixed(4));
      doc.text(coordinateText, marginLeft, yPos);
      yPos += 7;
    }

    const timestamp = new Intl.DateTimeFormat(localeTag, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    doc.text(t.pdfGeneratedAt.replace('{timestamp}', timestamp), marginLeft, yPos);
    yPos += 10;

    if (weatherResult.ai_prediction) {
      ensureSpace(12);
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      const execution = weatherResult.ai_prediction.execution_time
        ? ` (${weatherResult.ai_prediction.execution_time}s)`
        : '';
      const badgeText = `${t.aiGeneratedPrediction}${execution}`;
      const badgeWidth = doc.getTextWidth(badgeText) + 6;
      doc.roundedRect(marginLeft, yPos - 4, badgeWidth, 7, 2, 2, 'F');
      doc.text(badgeText, marginLeft + 3, yPos + 1.5);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      yPos += 12;
    }

    doc.setDrawColor(lightGray[0], lightGray[1], lightGray[2]);
    doc.setLineWidth(0.5);
    doc.line(marginLeft, yPos, pageWidth - marginRight, yPos);
    yPos += 10;

    const filterItems = Array.isArray(filters.items) ? filters.items.filter((item) => item?.value) : [];
    if (filterItems.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(t.pdfFiltersTitle, marginLeft, yPos);
      yPos += 8;

      filterItems.forEach(({ label, value }) => {
        if (!value) {
          return;
        }
        ensureSpace(15);
        const formattedValue = doc.splitTextToSize(String(value), contentWidth - 45);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(`${label}:`, marginLeft, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(formattedValue, marginLeft + 40, yPos);
        const blockHeight = formattedValue.length * 5;
        yPos += blockHeight + 4;
      });

      yPos += 4;
    }

    if (insights && insights.length > 0) {
      ensureSpace(18);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(t.pdfInsightsTitle, marginLeft, yPos);
      yPos += 8;

      const insightStyles = {
        alert: {
          fill: [255, 244, 244],
          border: [255, 145, 145],
          text: [120, 35, 35],
          indicator: [240, 80, 80],
        },
        warning: {
          fill: [255, 248, 235],
          border: [255, 198, 111],
          text: [115, 70, 10],
          indicator: [235, 150, 45],
        },
        good: {
          fill: [236, 250, 243],
          border: [136, 214, 170],
          text: [35, 90, 55],
          indicator: [45, 140, 90],
        },
        info: {
          fill: [238, 243, 255],
          border: [150, 170, 255],
          text: [45, 65, 120],
          indicator: [85, 120, 210],
        },
        default: {
          fill: [245, 245, 250],
          border: [200, 200, 210],
          text: [60, 60, 80],
          indicator: [120, 120, 140],
        },
      };

      const toneLabels = {
        alert: t.pdfInsightToneAlert,
        warning: t.pdfInsightToneWarning,
        good: t.pdfInsightToneGood,
        info: t.pdfInsightToneInfo,
      };

      const cardPaddingX = 10;
      const cardPaddingY = 6;
      const labelLineHeight = 5;
      const textLineHeight = 4.6;
      const indicatorRadius = 2.5;

      insights.forEach(({ text, tone }) => {
        if (!text) {
          return;
        }

        const style = insightStyles[tone] ?? insightStyles.default;
        const toneLabel = toneLabels[tone] ?? toneLabels.info ?? t.pdfInsightToneInfo;
        const bodyLines = doc.splitTextToSize(text, contentWidth - cardPaddingX * 2);
        const textBlockHeight = bodyLines.length * textLineHeight;
  const cardHeight = cardPaddingY * 2 + labelLineHeight + textBlockHeight + 2;

  ensureSpace(cardHeight + 6);

  const cardTop = yPos;
  const labelTop = cardTop + cardPaddingY;

  doc.setFillColor(style.fill[0], style.fill[1], style.fill[2]);
  doc.setDrawColor(style.border[0], style.border[1], style.border[2]);
  doc.roundedRect(marginLeft, cardTop, contentWidth, cardHeight, 3, 3, 'FD');

        const indicatorX = marginLeft + cardPaddingX;
        const indicatorY = labelTop + labelLineHeight / 2;
        doc.setFillColor(style.indicator[0], style.indicator[1], style.indicator[2]);
        doc.circle(indicatorX, indicatorY, indicatorRadius, 'F');

        const labelX = indicatorX + indicatorRadius + 3.5;
        const labelY = labelTop;
        doc.setTextColor(style.text[0], style.text[1], style.text[2]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(String(toneLabel).toUpperCase(), labelX, labelY, { baseline: 'top' });

        const textX = marginLeft + cardPaddingX;
  const textY = labelTop + labelLineHeight + 2;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(bodyLines, textX, textY, { baseline: 'top' });

        yPos += cardHeight + 6;

        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        doc.setDrawColor(lightGray[0], lightGray[1], lightGray[2]);
      });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      yPos += 2;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(t.pdfMetricsTitle, marginLeft, yPos);
    yPos += 8;

    const displayData = Array.isArray(weatherResult.data) ? weatherResult.data : [];
    const temperatureUnit = units.T2M ?? '°C';
    const windUnit = units.WS10M ?? 'm/s';
    const precipUnit = units.PRECTOTCORR ?? units.PRECTOT ?? 'mm';
    const isHourlyGranularity = weatherResult.granularity === 'hourly';

    const dateColumnX = marginLeft + 2;
    const tempColumnX = marginLeft + 70;
    const windColumnX = marginLeft + 115;
    const precipColumnX = marginLeft + 155;

    const drawMetricsHeader = () => {
      doc.setFillColor(subtleRow[0], subtleRow[1], subtleRow[2]);
      doc.rect(marginLeft, yPos - 5, contentWidth, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(t.date, dateColumnX, yPos);
      doc.text(`${t.temperature} (${temperatureUnit})`, tempColumnX, yPos);
      doc.text(`${t.wind10m} (${windUnit})`, windColumnX, yPos);
      doc.text(`${t.precipitation} (${precipUnit})`, precipColumnX, yPos);
      yPos += 9;
    };

    if (displayData.length === 0) {
      const noDataLines = doc.splitTextToSize(t.pdfNoData, contentWidth);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(noDataLines, marginLeft, yPos);
      yPos += noDataLines.length * 5 + 6;
    } else {
      drawMetricsHeader();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);

      displayData.forEach((entry, index) => {
        ensureSpace(18);

        const rowTop = yPos - 4;
        const rowHeightEstimate = 10;
        if (index % 2 === 0) {
          doc.setFillColor(250, 250, 252);
          doc.rect(marginLeft, rowTop, contentWidth, rowHeightEstimate + 2, 'F');
        }

        const formatHour = (value) => {
          if (value === null || value === undefined) {
            return null;
          }
          return `${String(value).padStart(2, '0')}h`;
        };

        const entryDate = entry.date ? toUTCDate(entry.date) : null;
        const dateLabel = entryDate ? dateFormatter.format(entryDate) : '-';
        const hourStart = formatHour(entry.hour);
        const hourEnd = formatHour(entry.hour_end);
        const hourLabel = isHourlyGranularity
          ? hourStart && hourEnd && hourEnd !== hourStart
            ? `${hourStart} → ${hourEnd}`
            : hourStart ?? hourEnd ?? '-'
          : null;

        const dateLines = isHourlyGranularity && hourLabel
          ? doc.splitTextToSize(`${dateLabel}\n${t.hour}: ${hourLabel}`, 60)
          : doc.splitTextToSize(dateLabel, 60);

        const temperatureParts = [];
        if (entry.t2m !== null && entry.t2m !== undefined) {
          temperatureParts.push(`${numberFormatter.format(entry.t2m)} ${temperatureUnit}`);
        }
        if (entry.t2m_max !== null && entry.t2m_max !== undefined) {
          temperatureParts.push(`${t.high}: ${numberFormatter.format(entry.t2m_max)} ${temperatureUnit}`);
        }
        if (entry.t2m_min !== null && entry.t2m_min !== undefined) {
          temperatureParts.push(`${t.low}: ${numberFormatter.format(entry.t2m_min)} ${temperatureUnit}`);
        }
        const temperatureText = temperatureParts.length > 0 ? temperatureParts.join('\n') : '-';
        const temperatureLines = doc.splitTextToSize(temperatureText, 40);

        const windText = entry.ws10m !== null && entry.ws10m !== undefined
          ? `${numberFormatter.format(entry.ws10m)} ${windUnit}`
          : '-';
        const windLines = doc.splitTextToSize(windText, 30);

        const precipText = entry.precip_mm !== null && entry.precip_mm !== undefined
          ? `${numberFormatter.format(entry.precip_mm)} ${precipUnit}`
          : '-';
        const precipLines = doc.splitTextToSize(precipText, 30);

        const maxLines = Math.max(dateLines.length, temperatureLines.length, windLines.length, precipLines.length);
        const rowHeight = maxLines * 5 + 2;

        doc.text(dateLines, dateColumnX, yPos);
        doc.text(temperatureLines, tempColumnX, yPos);
        doc.text(windLines, windColumnX, yPos);
        doc.text(precipLines, precipColumnX, yPos);

        yPos += rowHeight;

        if (entry.accuracy) {
          doc.setFontSize(7);
          doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          const accParts = [];
          if (entry.accuracy.T2M) {
            accParts.push(`T:${entry.accuracy.T2M.toFixed(0)}%`);
          }
          if (entry.accuracy.WS10M) {
            accParts.push(`W:${entry.accuracy.WS10M.toFixed(0)}%`);
          }
          if (entry.accuracy.PRECTOTCORR) {
            accParts.push(`P:${entry.accuracy.PRECTOTCORR.toFixed(0)}%`);
          }
          if (accParts.length > 0) {
            doc.text(`Accuracy: ${accParts.join(' ')}`, dateColumnX, yPos);
            yPos += 4;
          }
          doc.setTextColor(textColor[0], textColor[1], textColor[2]);
          doc.setFontSize(9);
        }

        if (yPos + 10 > 275 && index < displayData.length - 1) {
          doc.addPage();
          yPos = 20;
          drawMetricsHeader();
        }
      });
    }

    const summaryLines = [];
    const temperatureValues = displayData
      .map((entry) => (entry.t2m !== null && entry.t2m !== undefined ? entry.t2m : null))
      .filter((value) => value !== null);
    const windValues = displayData
      .map((entry) => (entry.ws10m !== null && entry.ws10m !== undefined ? entry.ws10m : null))
      .filter((value) => value !== null);
    const precipitationValues = displayData
      .map((entry) => (entry.precip_mm !== null && entry.precip_mm !== undefined ? entry.precip_mm : null))
      .filter((value) => value !== null);

    if (temperatureValues.length > 0) {
      const avgTemp = temperatureValues.reduce((sum, value) => sum + value, 0) / temperatureValues.length;
      const maxTemp = Math.max(...temperatureValues);
      const minTemp = Math.min(...temperatureValues);
      summaryLines.push(
        t.pdfSummaryAvgTemperature.replace('{value}', `${numberFormatter.format(avgTemp)} ${temperatureUnit}`)
      );
      summaryLines.push(
        t.pdfSummaryMaxTemperature.replace('{value}', `${numberFormatter.format(maxTemp)} ${temperatureUnit}`)
      );
      summaryLines.push(
        t.pdfSummaryMinTemperature.replace('{value}', `${numberFormatter.format(minTemp)} ${temperatureUnit}`)
      );
    }

    if (windValues.length > 0) {
      const avgWind = windValues.reduce((sum, value) => sum + value, 0) / windValues.length;
      summaryLines.push(
        t.pdfSummaryAvgWind.replace('{value}', `${numberFormatter.format(avgWind)} ${windUnit}`)
      );
    }

    if (precipitationValues.length > 0) {
      const totalPrecip = precipitationValues.reduce((sum, value) => sum + value, 0);
      summaryLines.push(
        t.pdfSummaryTotalPrecipitation.replace('{value}', `${numberFormatter.format(totalPrecip)} ${precipUnit}`)
      );
    }

    if (summaryLines.length > 0) {
      ensureSpace(summaryLines.length * 5 + 10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(t.pdfSummaryTitle, marginLeft, yPos);
      yPos += 7;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      summaryLines.forEach((line) => {
        doc.text(line, marginLeft, yPos);
        yPos += 5;
      });
      yPos += 4;
    }

    const hourlySeries = Array.isArray(selectedIntervalSeries) ? selectedIntervalSeries : [];
    if (hourlySeries.length > 0) {
      ensureSpace(25);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(t.pdfHourlyBreakdownTitle, marginLeft, yPos);
      yPos += 7;

      if (selectedIntervalDateLabel) {
        const subtitle = t.pdfHourlyBreakdownSubtitle.replace('{date}', selectedIntervalDateLabel);
        const lines = doc.splitTextToSize(subtitle, contentWidth);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(lines, marginLeft, yPos);
        yPos += lines.length * 5 + 4;
      }

      const hourColumnX = marginLeft + 2;
      const tempHourColumnX = marginLeft + 55;
      const windHourColumnX = marginLeft + 100;
      const precipHourColumnX = marginLeft + 145;

      const drawHourlyHeader = () => {
        doc.setFillColor(subtleRow[0], subtleRow[1], subtleRow[2]);
        doc.rect(marginLeft, yPos - 5, contentWidth, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(t.hour, hourColumnX, yPos);
        doc.text(`${t.temperature} (${temperatureUnit})`, tempHourColumnX, yPos);
        doc.text(`${t.wind10m} (${windUnit})`, windHourColumnX, yPos);
        doc.text(`${t.precipitation} (${precipUnit})`, precipHourColumnX, yPos);
        yPos += 9;
      };

      drawHourlyHeader();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);

      hourlySeries.forEach((entry, index) => {
        ensureSpace(15);
        if (index % 2 === 0) {
          doc.setFillColor(250, 250, 252);
          doc.rect(marginLeft, yPos - 4, contentWidth, 10, 'F');
        }

        const formatHour = (value) => {
          if (value === null || value === undefined) {
            return null;
          }
          return `${String(value).padStart(2, '0')}h`;
        };

        const hourStartLabel = formatHour(entry.hour);
        const hourEndLabel = formatHour(entry.hour_end);
        const hourDisplay = hourStartLabel && hourEndLabel && hourEndLabel !== hourStartLabel
          ? `${hourStartLabel} → ${hourEndLabel}`
          : hourStartLabel ?? hourEndLabel ?? '-';

        doc.text(hourDisplay, hourColumnX, yPos);

        const tempText = entry.t2m !== null && entry.t2m !== undefined
          ? `${numberFormatter.format(entry.t2m)} ${temperatureUnit}`
          : '-';
        doc.text(tempText, tempHourColumnX, yPos);

        const windText = entry.ws10m !== null && entry.ws10m !== undefined
          ? `${numberFormatter.format(entry.ws10m)} ${windUnit}`
          : '-';
        doc.text(windText, windHourColumnX, yPos);

        const precipText = entry.precip_mm !== null && entry.precip_mm !== undefined
          ? `${numberFormatter.format(entry.precip_mm)} ${precipUnit}`
          : '-';
        doc.text(precipText, precipHourColumnX, yPos);

        yPos += 7;
      });
    }

    const fileDate = new Date().toISOString().split('T')[0];
    const sourceLabel = weatherResult.ai_prediction ? t.pdfDataSourceAi : t.pdfDataSourceStandard;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
    doc.text(t.pdfFooterSignature, pageWidth / 2, 285, { align: 'center' });
    doc.text(t.pdfFooterDataSource.replace('{source}', sourceLabel), pageWidth / 2, 289, { align: 'center' });

    doc.save(`weather-forecast-${fileDate}.pdf`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert(t.pdfError);
  }
}

function describeTemperatureLevel(value, heatFlag = false, t) {
  if (value === null || value === undefined) {
    return null;
  }
  if (heatFlag || value >= 34) {
    return { tone: 'alert', icon: '🔥', text: t.extremeHeat };
  }
  if (value >= 28) {
    return { tone: 'warning', icon: '🌡️', text: t.highTemp };
  }
  if (value <= 15) {
    return { tone: 'info', icon: '🧥', text: t.coolTemp };
  }
  return { tone: 'good', icon: '🌤️', text: t.comfortableTemp };
}

function describeWindLevel(value, windFlag = false, t) {
  if (value === null || value === undefined) {
    return null;
  }
  if (windFlag || value >= 9) {
    return { tone: 'alert', icon: '💨', text: t.strongWind };
  }
  if (value >= 6) {
    return { tone: 'warning', icon: '🍃', text: t.moderateWind };
  }
  if (value <= 1.5) {
    return { tone: 'good', icon: '🍃', text: t.calmWind };
  }
  return { tone: 'info', icon: '🍃', text: t.lightBreeze };
}

function describePrecipitationLevel(value, rainFlag = false, t) {
  if (value === null || value === undefined) {
    return null;
  }
  if (rainFlag || value >= 5) {
    return { tone: 'alert', icon: '🌧️', text: t.heavyRain };
  }
  if (value >= 2) {
    return { tone: 'warning', icon: '☔', text: t.lightRain };
  }
  if (value > 0) {
    return { tone: 'info', icon: '☂️', text: t.briefDrizzle };
  }
  return { tone: 'good', icon: '☀️', text: t.noRain };
}

function buildChartInsight(values, metricKey, formatter, t) {
  const numeric = (values ?? []).filter((value) => value !== null && value !== undefined);
  if (numeric.length === 0) {
    return t.notEnoughData;
  }

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const avg = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;

  if (metricKey === 'temperature') {
    if (max >= 34) {
      return t.sharpHeatSpikes.replace('{max}', formatter.format(max));
    }
    if (max >= 28) {
      return t.highTempAverage.replace('{avg}', formatter.format(avg));
    }
    return t.tempRange.replace('{min}', formatter.format(min)).replace('{max}', formatter.format(max));
  }

  if (metricKey === 'wind') {
    if (max >= 9) {
      return t.windPeaks.replace('{max}', formatter.format(max));
    }
    if (max >= 6) {
      return t.moderateWindAvg.replace('{avg}', formatter.format(avg));
    }
    return t.gentleWind.replace('{max}', formatter.format(max));
  }

  const total = numeric.reduce((sum, value) => sum + value, 0);
  if (max >= 5) {
    return t.heavyRainPeaks.replace('{max}', formatter.format(max));
  }
  if (max >= 2) {
    return t.lightRainFluc.replace('{avg}', formatter.format(avg));
  }
  if (total === 0) {
    return t.dryWindow;
  }
  return t.occasionalDrizzle.replace('{total}', formatter.format(total));
}

export default function App() {
  const [locale, setLocale] = useState(() => {
    const saved = localStorage.getItem('rain-locale');
    return saved === 'pt' || saved === 'en' ? saved : 'en';
  });
  const t = useTranslation(locale);
  
  const DATE_FORMATTER = useMemo(() => new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'long', timeZone: 'UTC' }), [locale]);
  const SHORT_DATE_FORMATTER = useMemo(() => new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }), [locale]);
  const NUMBER_FORMATTER = useMemo(() => new Intl.NumberFormat(locale === 'pt' ? 'pt-BR' : 'en-US', { maximumFractionDigits: 1 }), [locale]);
  
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
  const [weatherStartDate, setWeatherStartDate] = useState(null);
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
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [multipleWeatherResults, setMultipleWeatherResults] = useState([]);
  const [geocodeResult, setGeocodeResult] = useState(null);
  const [activeLocationId, setActiveLocationId] = useState(null);
  const [lastActivationSource, setLastActivationSource] = useState(null);
  
  function handleLocaleChange(newLocale) {
    setLocale(newLocale);
    localStorage.setItem('rain-locale', newLocale);
  }

  // Animate logo on button click
  useEffect(() => {
    const animateLogo = () => {
      const brand = document.querySelector('.brand');
      if (brand) {
        brand.classList.add('brand--active');
        setTimeout(() => {
          brand.classList.remove('brand--active');
        }, 1500);
      }
    };

    const buttons = document.querySelectorAll('button');
    buttons.forEach(button => {
      button.addEventListener('click', animateLogo);
    });

    return () => {
      buttons.forEach(button => {
        button.removeEventListener('click', animateLogo);
      });
    };
  }, [weatherMode, result, weatherResult]);

  const mapSrc = useMemo(() => buildMapSrc(result), [result]);
  const hasWeatherContext = useMemo(() => Boolean(result || selectedLocations.length > 0), [result, selectedLocations]);
  const weatherPanelLocationLabel = useMemo(
    () => result?.formatted_address ?? selectedLocations[0]?.description ?? t.selectedLocationWeather,
    [result, selectedLocations, t]
  );
  const isMultiLocationActive = selectedLocations.length > 0;
  const hasQueuedMultiResults = multipleWeatherResults.length > 0;
  const hasSelectableMultiResults = useMemo(
    () => multipleWeatherResults.some((entry) => entry.status === 'success' && entry.weatherData),
    [multipleWeatherResults]
  );
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

  const hasIntervalSeries = weatherMode === 'interval' && (intervalSeries?.length ?? 0) > 1;
  
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

    const labels = selectedIntervalSeries.map((entry) => {
      const hour = entry.hour !== null && entry.hour !== undefined ? entry.hour : 0;
      return `${String(hour).padStart(2, '0')}h`;
    });

    return {
      labels,
      datasets: {
        temperature: selectedIntervalSeries.map((entry) => (entry.t2m ?? null)),
        temperatureFlags: selectedIntervalSeries.map((entry) => entry.flags?.heat_caution ?? false),
        temperatureAccuracy: selectedIntervalSeries.map((entry) => entry.accuracy?.T2M ?? null),
        precipitation: selectedIntervalSeries.map((entry) => entry.precip_mm ?? 0),
        precipitationFlags: selectedIntervalSeries.map((entry) => entry.flags?.rain_risk ?? false),
        precipitationAccuracy: selectedIntervalSeries.map((entry) => entry.accuracy?.PRECTOTCORR ?? entry.accuracy?.PRECTOT ?? null),
        wind: selectedIntervalSeries.map((entry) => (entry.ws10m ?? null)),
        windFlags: selectedIntervalSeries.map((entry) => entry.flags?.wind_caution ?? false),
        windAccuracy: selectedIntervalSeries.map((entry) => entry.accuracy?.WS10M ?? null),
      },
    };
  }, [selectedIntervalSeries]);

  const intervalChartOptions = useMemo(() => {
    if (!hasIntervalSeries || !intervalChartData || !selectedIntervalSeries) {
      return null;
    }

    const tooltipCallbacks = {
      label(context) {
        const datasetLabel = context.dataset?.label ?? '';
        const rawValue = context.parsed?.y ?? context.parsed ?? null;
        const unitLabel = context.dataset?.unitLabel ?? '';
        const formattedValue = rawValue !== null && rawValue !== undefined
          ? NUMBER_FORMATTER.format(rawValue)
          : context.formattedValue;

        let line = '';
        if (datasetLabel) {
          line = `${datasetLabel}: ${formattedValue}${unitLabel ? ` ${unitLabel}` : ''}`;
        } else if (formattedValue) {
          line = `${formattedValue}${unitLabel ? ` ${unitLabel}` : ''}`;
        }

        const accuracyValues = context.dataset?.accuracyValues;
        const accuracy = Array.isArray(accuracyValues)
          ? accuracyValues[context.dataIndex]
          : null;

        if (accuracy !== null && accuracy !== undefined) {
          const formattedAccuracy = NUMBER_FORMATTER.format(accuracy);
          const accuracyLabel = t.accuracy ?? 'Accuracy';
          const separator = line ? ' • ' : '';
          line = `${line}${separator}${accuracyLabel}: ${formattedAccuracy}%`;
        }

        return line;
      },
    };

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
          callbacks: tooltipCallbacks,
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
              text: `Temperature (${tempUnit})`,
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
              text: `Wind (${windUnit})`,
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
              text: `Precipitation (${precipUnit})`,
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
  }, [NUMBER_FORMATTER, hasIntervalSeries, intervalChartData, precipUnit, selectedIntervalSeries, t, tempUnit, windUnit]);

  const selectedIntervalDateLabel = useMemo(() => {
    if (!selectedIntervalDate) {
      return null;
    }
    const date = toUTCDate(selectedIntervalDate);
    if (!date) {
      return null;
    }
    return DATE_FORMATTER.format(date);
  }, [selectedIntervalDate, DATE_FORMATTER]);

  const weatherTitle = useMemo(() => formatWeatherTitle(weatherResult, DATE_FORMATTER), [weatherResult, DATE_FORMATTER]);

  const temperatureChartData = useMemo(() => {
    if (!intervalChartData || !intervalChartData.datasets) {
      return null;
    }
    const data = intervalChartData.datasets.temperature ?? [];
    const hasValues = data.some((value) => value !== null && value !== undefined);
    if (!hasValues) {
      return null;
    }

  const temperatureFlags = intervalChartData.datasets.temperatureFlags ?? [];
  const temperatureAccuracy = intervalChartData.datasets.temperatureAccuracy ?? [];
    const pointBackgroundColor = temperatureFlags.map((flag) =>
      flag ? '#ff6b6b' : '#050014'
    );
    const pointBorderColor = temperatureFlags.map((flag) =>
      flag ? '#ff6b6b' : '#7cf1ff'
    );

    return {
      labels: intervalChartData.labels ?? [],
      datasets: [
        {
          type: 'line',
          label: `Temperature (${tempUnit})`,
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
          accuracyValues: temperatureAccuracy,
          unitLabel: tempUnit,
        },
      ],
    };
  }, [intervalChartData, tempUnit]);

  const windChartData = useMemo(() => {
    if (!intervalChartData || !intervalChartData.datasets) {
      return null;
    }
    const data = intervalChartData.datasets.wind ?? [];
    const hasValues = data.some((value) => value !== null && value !== undefined);
    if (!hasValues) {
      return null;
    }

  const windFlags = intervalChartData.datasets.windFlags ?? [];
  const windAccuracy = intervalChartData.datasets.windAccuracy ?? [];
    const pointBackgroundColor = windFlags.map((flag) =>
      flag ? '#d7b4ff' : '#050014'
    );
    const pointBorderColor = windFlags.map((flag) =>
      flag ? '#d7b4ff' : '#a96bff'
    );

    return {
      labels: intervalChartData.labels ?? [],
      datasets: [
        {
          type: 'line',
          label: `Wind (${windUnit})`,
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
          accuracyValues: windAccuracy,
          unitLabel: windUnit,
        },
      ],
    };
  }, [intervalChartData, windUnit]);

  const precipitationChartData = useMemo(() => {
    if (!intervalChartData || !intervalChartData.datasets) {
      return null;
    }
    const data = intervalChartData.datasets.precipitation ?? [];
    const hasValues = data.some((value) => value !== null && value !== undefined);
    if (!hasValues) {
      return null;
    }

  const precipitationFlags = intervalChartData.datasets.precipitationFlags ?? [];
  const precipitationAccuracy = intervalChartData.datasets.precipitationAccuracy ?? [];
    const backgroundColor = precipitationFlags.map((flag) =>
      flag ? 'rgba(64, 21, 136, 0.7)' : 'rgba(64, 21, 136, 0.45)'
    );
    const hoverBackgroundColor = precipitationFlags.map((flag) =>
      flag ? 'rgba(124, 241, 255, 0.65)' : 'rgba(124, 241, 255, 0.35)'
    );

    return {
      labels: intervalChartData.labels ?? [],
      datasets: [
        {
          type: 'bar',
          label: `Precipitation (${precipUnit})`,
          data,
          backgroundColor,
          hoverBackgroundColor,
          borderRadius: 10,
          maxBarThickness: 28,
          accuracyValues: precipitationAccuracy,
          unitLabel: precipUnit,
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
        console.error('Failed to load suggestions', err);
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
  setGeocodeResult(data);
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
  setGeocodeResult(null);
  setError(err.message ?? 'We couldn’t geocode the selected location.');
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
        setWeatherError(`${label} ${t.hourMustBeProvided}`);
        return null;
      }
      const numeric = Number(trimmed);
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 23) {
        setWeatherError(`${label} ${t.hourMustBeInteger}`);
        return null;
      }
      return numeric;
    };

    let hourStartParam = null;
    let hourEndParam = null;

    if (isIntervalMode) {
      const startHourValue = parseHour(weatherHourStart, t.startHour);
      const endHourValue = parseHour(weatherHourEnd, t.endHour);
      if (startHourValue === null || endHourValue === null) {
        return;
      }

      if (endHourValue < startHourValue) {
        setWeatherError(t.invalidHourRange);
        return;
      }

      hourStartParam = startHourValue;
      hourEndParam = endHourValue;
    } else {
      const trimmedStart = weatherHourStart.trim();
      if (trimmedStart !== '') {
        const startHourValue = parseHour(trimmedStart, t.selectedHour);
        if (startHourValue === null) {
          return;
        }
        hourStartParam = startHourValue;
        hourEndParam = startHourValue;
      }
    }

    const selection = isIntervalMode
      ? Array.from(new Set([weatherStartDate, ...repeatDates])).filter(Boolean).sort()
      : [weatherStartDate].filter(Boolean);

    if (selection.length === 0) {
      setWeatherError(t.selectAtLeastOneDate);
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

      if (!summary) {
        throw new Error('No data returned from API');
      }

      if (isIntervalMode) {
        const selectedSet = new Set(selection);
        const filteredData = (summary.data ?? []).filter((record) => {
          if (!record || !record.date) {
            return false;
          }
          return selectedSet.has(record.date);
        });
        const filteredSeries = summary.series 
          ? summary.series.filter((record) => {
              if (!record || !record.date) {
                return false;
              }
              return selectedSet.has(record.date);
            })
          : null;

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
      setGeocodeResult(result);
    } catch (err) {
  setWeatherResult(null);
  setWeatherError(err.message ?? 'We couldn’t retrieve the weather data.');
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

  const activateMultiLocationResult = useCallback(
    (entry, options = {}) => {
      if (!entry || entry.status !== 'success' || !entry.weatherData) {
        return;
      }

      setActiveLocationId(entry.place_id);
      setLastActivationSource(options.source ?? 'user');

      if (entry.geocode) {
        setGeocodeResult(entry.geocode);
        setResult({
          ...entry.geocode,
          formatted_address: entry.description ?? entry.geocode.formatted_address ?? entry.geocode.query ?? entry.geocode.name ?? entry.geocode.formatted_address,
          place_id: entry.place_id,
        });
      } else {
        setResult((prev) => {
          if (prev?.place_id === entry.place_id) {
            return prev;
          }
          return {
            place_id: entry.place_id,
            formatted_address: entry.description,
            query: entry.description,
          };
        });
        setGeocodeResult(null);
      }

      setWeatherResult(entry.weatherData);
    },
    [setResult]
  );

  useEffect(() => {
    if (!isMultiLocationActive || multipleWeatherResults.length === 0) {
      return;
    }

    const successfulEntries = multipleWeatherResults.filter(
      (entry) => entry.status === 'success' && entry.weatherData
    );

    if (successfulEntries.length === 0) {
      return;
    }

    if (
      activeLocationId &&
      successfulEntries.some((entry) => entry.place_id === activeLocationId)
    ) {
      return;
    }

    activateMultiLocationResult(successfulEntries[0], { source: 'auto' });
  }, [
    isMultiLocationActive,
    multipleWeatherResults,
    activeLocationId,
    activateMultiLocationResult,
  ]);

  const overallInsights = useMemo(() => {
    const sourceRecords = weatherResult?.series && weatherResult.series.length > 0
      ? weatherResult.series
      : weatherResult?.data ?? [];

    if (sourceRecords.length === 0) {
      return [];
    }
    const rainCount = sourceRecords.filter((entry) => entry.flags?.rain_risk).length;
    const rainShare = sourceRecords.length > 0 ? rainCount / sourceRecords.length : 0;
    const windCount = sourceRecords.filter((entry) => entry.flags?.wind_caution).length;
    const heatCount = sourceRecords.filter((entry) => entry.flags?.heat_caution).length;

    const messages = [];

    messages.push(
      heatCount > 0
        ? {
            metric: 'temperature',
            tone: 'alert',
            icon: '🔥',
            text: t.intenseHeat
              .replace('{count}', heatCount)
              .replace('{unit}', heatCount === 1 ? t.slot : t.slots),
          }
        : {
            metric: 'temperature',
            tone: 'good',
            icon: '🌤️',
            text: t.comfortableRange,
          }
    );

    if (rainCount === 0) {
      messages.push({
        metric: 'precipitation',
        tone: 'good',
        icon: '☀️',
        text: t.rainChanceNone,
      });
    } else if (rainShare >= 0.6) {
      messages.push({
        metric: 'precipitation',
        tone: 'alert',
        icon: '🌧️',
        text: t.rainChanceHigh,
      });
    } else if (rainShare >= 0.3) {
      messages.push({
        metric: 'precipitation',
        tone: 'warning',
        icon: '🌦️',
        text: t.rainChanceMedium,
      });
    } else {
      messages.push({
        metric: 'precipitation',
        tone: 'info',
        icon: '🌥️',
        text: t.rainChanceLow,
      });
    }

    messages.push(
      windCount > 0
        ? {
            metric: 'wind',
            tone: 'warning',
            icon: '💨',
            text: t.gustyConditions
              .replace('{count}', windCount)
              .replace('{unit}', windCount === 1 ? t.slot : t.slots),
          }
        : {
            metric: 'wind',
            tone: 'info',
            icon: '🍃',
            text: t.calmWinds,
          }
    );

    return messages;
  }, [weatherResult, t]);

  const displayInsights = useMemo(() => {
    if (!overallInsights || overallInsights.length < 2) {
      return overallInsights ?? [];
    }
    const clone = overallInsights.slice();
    const lastIndex = clone.length - 1;
    const secondLastIndex = lastIndex - 1;
    [clone[secondLastIndex], clone[lastIndex]] = [clone[lastIndex], clone[secondLastIndex]];
    return clone;
  }, [overallInsights]);

  const metricInsights = useMemo(() => {
    if (!displayInsights || displayInsights.length === 0) {
      return {};
    }
    return displayInsights.reduce((acc, insight) => {
      if (insight.metric && !acc[insight.metric]) {
        acc[insight.metric] = insight;
      }
      return acc;
    }, {});
  }, [displayInsights]);

  const renderMetricInsight = (metricKey) => {
    const insight = metricInsights[metricKey];
    if (!insight || !insight.text) {
      return null;
    }
    return (
      <p className={`metric-insight metric-insight--${insight.tone}`}>
        {insight.icon ? (
          <span className="metric-insight__icon" aria-hidden="true">{insight.icon}</span>
        ) : null}
        <span>{insight.text}</span>
      </p>
    );
  };

  const requestedRangeLabel = useMemo(() => {
    if (!weatherResult) {
      return null;
    }

    const manualSelection = Array.isArray(weatherResult.selectedDates)
      ? weatherResult.selectedDates
      : null;
    if (manualSelection && manualSelection.length > 0) {
      if (manualSelection.length === 1) {
        const date = toUTCDate(manualSelection[0]);
        return date ? DATE_FORMATTER.format(date) : null;
      }

      if (manualSelection.length <= 4) {
        const joined = manualSelection
          .map((date) => {
            const utcDate = toUTCDate(date);
            return utcDate ? SHORT_DATE_FORMATTER.format(utcDate) : null;
          })
          .filter(Boolean)
          .join(', ');
        return joined ? `Datas selecionadas: ${joined}` : null;
      }

      const firstDate = toUTCDate(manualSelection[0]);
      const lastDate = toUTCDate(manualSelection[manualSelection.length - 1]);
      if (!firstDate || !lastDate) {
        return null;
      }
      const firstLabel = SHORT_DATE_FORMATTER.format(firstDate);
      const lastLabel = SHORT_DATE_FORMATTER.format(lastDate);
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
      const startDate = toUTCDate(startRecord.date);
      const endDate = toUTCDate(endRecord.date);
      if (!startDate || !endDate) {
        return null;
      }
      const startDay = SHORT_DATE_FORMATTER.format(startDate);
      const endDay = SHORT_DATE_FORMATTER.format(endDate);
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
      const firstDate = toUTCDate(startRecord.date);
      if (!firstDate) {
        return null;
      }
      const firstLabel = DATE_FORMATTER.format(firstDate);
      if (sourceRecords.length === 1) {
        label = firstLabel;
      } else {
        const lastDate = toUTCDate(endRecord.date);
        if (!lastDate) {
          return null;
        }
        const lastLabel = DATE_FORMATTER.format(lastDate);
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
      temperature: buildChartInsight(intervalChartData.datasets.temperature, 'temperature', NUMBER_FORMATTER, t),
      wind: buildChartInsight(intervalChartData.datasets.wind, 'wind', NUMBER_FORMATTER, t),
      precipitation: buildChartInsight(intervalChartData.datasets.precipitation, 'precipitation', NUMBER_FORMATTER, t),
    };
  }, [intervalChartData, NUMBER_FORMATTER, t]);

  const intervalMetricSummaries = useMemo(() => {
    if (!selectedIntervalSeries || selectedIntervalSeries.length === 0) {
      return null;
    }

    const formatValue = (value, unit) =>
      value === null || value === undefined || Number.isNaN(value)
        ? null
        : `${NUMBER_FORMATTER.format(value)} ${unit}`;

    const numbersFrom = (values) =>
      values
        .filter((value) => value !== null && value !== undefined && !Number.isNaN(value));

    const temperatureValues = numbersFrom(selectedIntervalSeries.map((entry) => entry.t2m ?? null));
    const windValues = numbersFrom(selectedIntervalSeries.map((entry) => entry.ws10m ?? null));
    const precipitationValues = numbersFrom(selectedIntervalSeries.map((entry) => entry.precip_mm ?? 0));

    let temperatureSummary = null;
    if (temperatureValues.length > 0) {
      const tempMin = Math.min(...temperatureValues);
      const tempMax = Math.max(...temperatureValues);
      const tempAvg = temperatureValues.reduce((sum, value) => sum + value, 0) / temperatureValues.length;
      const hasHeatFlag = selectedIntervalSeries.some((entry) => entry.flags?.heat_caution);
      const descriptor = describeTemperatureLevel(tempAvg, hasHeatFlag, t) ?? {};

      const metrics = [];
      const avgLabel = formatValue(tempAvg, tempUnit);
      if (avgLabel) {
        metrics.push({ label: t.chartSummaryAverage, value: avgLabel });
      }
      if (!Number.isNaN(tempMin) && !Number.isNaN(tempMax)) {
        metrics.push({
          label: t.chartSummaryRange,
          value: `${NUMBER_FORMATTER.format(tempMin)} → ${NUMBER_FORMATTER.format(tempMax)} ${tempUnit}`,
        });
      }

      temperatureSummary = {
        tone: descriptor.tone ?? 'info',
        icon: descriptor.icon ?? '🌡️',
        headline: descriptor.text ?? t.chartSummaryNoData,
        detail: chartInsights?.temperature ?? null,
        metrics,
      };
    }

    let windSummary = null;
    if (windValues.length > 0) {
      const windMax = Math.max(...windValues);
      const windAvg = windValues.reduce((sum, value) => sum + value, 0) / windValues.length;
      const hasWindFlag = selectedIntervalSeries.some((entry) => entry.flags?.wind_caution);
      const descriptor = describeWindLevel(windMax, hasWindFlag, t) ?? {};

      const metrics = [];
      const avgLabel = formatValue(windAvg, windUnit);
      if (avgLabel) {
        metrics.push({ label: t.chartSummaryAverage, value: avgLabel });
      }
      if (!Number.isNaN(windMax)) {
        metrics.push({
          label: t.chartSummaryPeak,
          value: `${NUMBER_FORMATTER.format(windMax)} ${windUnit}`,
        });
      }

      windSummary = {
        tone: descriptor.tone ?? 'info',
        icon: descriptor.icon ?? '🍃',
        headline: descriptor.text ?? t.chartSummaryNoData,
        detail: chartInsights?.wind ?? null,
        metrics,
      };
    }

    let precipitationSummary = null;
    if (precipitationValues.length > 0) {
      const precipTotal = precipitationValues.reduce((sum, value) => sum + value, 0);
      const precipMax = Math.max(...precipitationValues);
      const hasRainFlag = selectedIntervalSeries.some((entry) => entry.flags?.rain_risk);
      const descriptor = describePrecipitationLevel(precipMax, hasRainFlag, t) ?? {};

      const metrics = [];
      const totalLabel = formatValue(precipTotal, precipUnit);
      if (totalLabel) {
        metrics.push({ label: t.chartSummaryTotal, value: totalLabel });
      }
      if (!Number.isNaN(precipMax)) {
        metrics.push({
          label: t.chartSummaryPeak,
          value: `${NUMBER_FORMATTER.format(precipMax)} ${precipUnit}`,
        });
      }

      precipitationSummary = {
        tone: descriptor.tone ?? 'info',
        icon: descriptor.icon ?? '☔',
        headline: descriptor.text ?? t.chartSummaryNoData,
        detail: chartInsights?.precipitation ?? null,
        metrics,
      };
    }

    if (!temperatureSummary && !windSummary && !precipitationSummary) {
      return null;
    }

    return {
      temperature: temperatureSummary,
      wind: windSummary,
      precipitation: precipitationSummary,
    };
  }, [NUMBER_FORMATTER, chartInsights, precipUnit, selectedIntervalSeries, t, tempUnit, windUnit]);

  const {
    temperature: temperatureSummary,
    wind: windSummary,
    precipitation: precipitationSummary,
  } = intervalMetricSummaries ?? {};

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
    setSelectedLocations([]);
    setMultipleWeatherResults([]);
    setGeocodeResult(null);
    setActiveLocationId(null);
    setLastActivationSource(null);
  }

  function handleAddLocation() {
    const placeId = selectedSuggestion?.place_id ?? selectedPlaceId ?? result?.place_id;
    const description = selectedSuggestion?.description ?? result?.formatted_address ?? query.trim();

    if (!placeId || !description) {
      return;
    }

    const alreadyAdded = selectedLocations.some((location) => location.place_id === placeId);
    if (alreadyAdded) {
      return;
    }

    setSelectedLocations((prev) => [
      ...prev,
      {
        place_id: placeId,
        description,
      },
    ]);

    setMultipleWeatherResults((prev) => prev.filter((entry) => entry.place_id !== placeId));
  }

  function handleRemoveLocation(placeId) {
    setSelectedLocations((prev) => prev.filter((location) => location.place_id !== placeId));
    setMultipleWeatherResults((prev) => prev.filter((entry) => entry.place_id !== placeId));
    setActiveLocationId((current) => {
      if (current === placeId) {
        setLastActivationSource(null);
        return null;
      }
      return current;
    });
  }

  async function handleMultipleLocationsSubmit(event) {
    event.preventDefault();

    if (weatherLoading || selectedLocations.length === 0 || !weatherStartDate) {
      return;
    }

    setWeatherResult(null);
    setWeatherError(null);
    setActiveLocationId(null);
    setLastActivationSource(null);

    const isIntervalMode = weatherMode === 'interval';

    const parseHour = (value, label) => {
      if (value === null || value === undefined) {
        return null;
      }
      const trimmed = String(value).trim();
      if (trimmed === '') {
        setWeatherError(`${label} ${t.hourMustBeProvided}`);
        return null;
      }
      const numeric = Number(trimmed);
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 23) {
        setWeatherError(`${label} ${t.hourMustBeInteger}`);
        return null;
      }
      return numeric;
    };

    let hourStartParam = null;
    let hourEndParam = null;

    if (isIntervalMode) {
      const startHourValue = parseHour(weatherHourStart, t.startHour);
      const endHourValue = parseHour(weatherHourEnd, t.endHour);
      if (startHourValue === null || endHourValue === null) {
        return;
      }

      if (endHourValue < startHourValue) {
        setWeatherError(t.invalidHourRange);
        return;
      }

      hourStartParam = startHourValue;
      hourEndParam = endHourValue;
    } else {
      const trimmedStart = weatherHourStart.trim();
      if (trimmedStart !== '') {
        const startHourValue = parseHour(trimmedStart, t.selectedHour);
        if (startHourValue === null) {
          return;
        }
        hourStartParam = startHourValue;
        hourEndParam = startHourValue;
      }
    }

    const selection = isIntervalMode
      ? Array.from(new Set([weatherStartDate, ...repeatDates])).filter(Boolean).sort()
      : [weatherStartDate].filter(Boolean);

    if (selection.length === 0) {
      setWeatherError(t.selectAtLeastOneDate);
      return;
    }

    const rangeStart = selection[0];
    const rangeEnd = selection[selection.length - 1];

    try {
      setWeatherLoading(true);

      const placeholders = selectedLocations.map((location) => ({
        place_id: location.place_id,
        description: location.description,
        geocode: null,
        weatherData: null,
        error: null,
        status: 'pending',
      }));

      setMultipleWeatherResults(placeholders);

      for (let i = 0; i < selectedLocations.length; i += 1) {
        const location = selectedLocations[i];

        setMultipleWeatherResults((prev) =>
          prev.map((entry, idx) =>
            idx === i ? { ...entry, status: 'loading', error: null } : entry
          )
        );

        try {
          const geocodeData = await geocodeLocation({ place_id: location.place_id });

          if (!geocodeData?.latitude || !geocodeData?.longitude) {
            setMultipleWeatherResults((prev) =>
              prev.map((entry, idx) =>
                idx === i
                  ? {
                      ...entry,
                      geocode: null,
                      weatherData: null,
                      error: 'Failed to get coordinates',
                      status: 'error',
                    }
                  : entry
              )
            );
            continue;
          }

          const summary = await fetchWeatherSummary({
            latitude: geocodeData.latitude,
            longitude: geocodeData.longitude,
            startDate: rangeStart.replace(/-/g, ''),
            endDate: rangeEnd.replace(/-/g, ''),
            hourStart: hourStartParam,
            hourEnd: hourEndParam,
          });

          if (!summary) {
            setMultipleWeatherResults((prev) =>
              prev.map((entry, idx) =>
                idx === i
                  ? {
                      ...entry,
                      geocode: geocodeData,
                      weatherData: null,
                      error: 'No data returned from API',
                      status: 'error',
                    }
                  : entry
              )
            );
            continue;
          }

          let processedSummary = summary;

          if (isIntervalMode) {
            const selectedSet = new Set(selection);
            const filteredData = (summary.data ?? []).filter((record) => record?.date && selectedSet.has(record.date));
            const filteredSeries = summary.series
              ? summary.series.filter((record) => record?.date && selectedSet.has(record.date))
              : null;

            processedSummary = {
              ...summary,
              data: filteredData,
              series: filteredSeries,
              selectedDates: selection,
            };
          }

          setMultipleWeatherResults((prev) =>
            prev.map((entry, idx) =>
              idx === i
                ? {
                    place_id: location.place_id,
                    description: location.description,
                    geocode: geocodeData,
                    weatherData: processedSummary,
                    error: null,
                    status: 'success',
                  }
                : entry
            )
          );
          if (i === 0) {
            setGeocodeResult(geocodeData);
          }
        } catch (err) {
          const message = err?.message || 'Failed to fetch weather data';
          setMultipleWeatherResults((prev) =>
            prev.map((entry, idx) =>
              idx === i
                ? {
                    ...entry,
                    geocode: null,
                    weatherData: null,
                    error: message,
                    status: 'error',
                  }
                : entry
            )
          );
        }
      }

      setWeatherEndDate(rangeEnd);
    } catch (err) {
      setWeatherError(err.message ?? t.couldNotRetrieveData);
    } finally {
      setWeatherLoading(false);
    }
  }

  const handlePdfDownload = useCallback(() => {
    if (!weatherResult) {
      return;
    }

    const filterItems = [];
    const locationLabel = weatherPanelLocationLabel;

    if (locationLabel) {
      filterItems.push({ label: t.pdfFilterLocation, value: locationLabel });
    }

    filterItems.push({
      label: t.pdfFilterMode,
      value: weatherMode === 'interval' ? t.continuousRange : t.singleMoment,
    });

    const rangeLabel = requestedRangeLabel ?? weatherTitle ?? null;
    if (rangeLabel) {
      filterItems.push({ label: t.pdfFilterPeriod, value: rangeLabel });
    }

    const selectedDates = Array.isArray(weatherResult.selectedDates) ? weatherResult.selectedDates : null;
    if (selectedDates && selectedDates.length > 0) {
      const formattedDates = selectedDates
        .map((date) => {
          const parsed = toUTCDate(date);
          return parsed ? DATE_FORMATTER.format(parsed) : date;
        })
        .filter(Boolean)
        .join(', ');
      if (formattedDates) {
        filterItems.push({ label: t.pdfFilterSelectedDates, value: formattedDates });
      }
    }

    const hourLabel = (() => {
      if (weatherMode === 'interval') {
        const start = weatherHourStart?.trim();
        const end = weatherHourEnd?.trim();
        if (start && end) {
          return `${String(start).padStart(2, '0')}h → ${String(end).padStart(2, '0')}h`;
        }
      } else {
        const single = weatherHourStart?.trim();
        if (single) {
          return `${String(single).padStart(2, '0')}h`;
        }
      }
      return null;
    })();

    if (hourLabel) {
      filterItems.push({ label: t.pdfFilterHours, value: hourLabel });
    }

    if (weatherResult.granularity) {
      const granularityLabel = weatherResult.granularity === 'hourly' ? t.hourlyData : t.dailyData;
      filterItems.push({ label: t.pdfFilterGranularity, value: granularityLabel });
    }

    if (hasIntervalSeries && selectedIntervalDateLabel) {
      filterItems.push({ label: t.pdfFilterChartDay, value: selectedIntervalDateLabel });
    }

    const units = weatherResult?.meta?.units ?? {};

    generatePDF({
      weatherResult,
      geocodeResult,
      t,
      locale,
      filters: {
        items: filterItems,
        locationName: locationLabel,
      },
      insights: displayInsights,
      selectedIntervalSeries: hasIntervalSeries ? selectedIntervalSeries : null,
      selectedIntervalDateLabel: hasIntervalSeries ? selectedIntervalDateLabel : null,
      units,
    });
  }, [
    DATE_FORMATTER,
    displayInsights,
    geocodeResult,
    hasIntervalSeries,
    locale,
    requestedRangeLabel,
    selectedIntervalDateLabel,
    selectedIntervalSeries,
    t,
    weatherHourEnd,
    weatherHourStart,
    weatherMode,
    weatherPanelLocationLabel,
    weatherResult,
    weatherTitle,
  ]);

  function openCalendar(mode = 'single') {
    setCalendarMode(mode);
    setCalendarOpen(true);
    setRepeatDateDraft((previous) => (!previous || !weatherStartDate || previous < weatherStartDate ? weatherStartDate : previous));
    setRepeatMonthCursor(() => {
      if (weatherStartDate) {
        const d = toUTCDate(weatherStartDate);
        d.setUTCDate(1);
        return d.toISOString().slice(0, 10);
      } else {
        const base = new Date();
        base.setUTCDate(1);
        return base.toISOString().slice(0, 10);
      }
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
    const setAll = new Set([weatherStartDate, ...repeatDates].filter(Boolean));
    if (setAll.has(dateStr)) {
      setAll.delete(dateStr);
      // If all dates are deselected, clear everything
      if (setAll.size === 0) {
        setWeatherStartDate(null);
        setRepeatDates([]);
        return;
      }
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
                {calendarMode === 'single' ? t.selectDatePlaceholder : t.selectDaysLabel}
              </h3>
              <button
                type="button"
                className="repeat-close"
                onClick={closeCalendar}
                aria-label="Close date selection"
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
                  aria-label="Previous month"
                >
                  ‹
                </button>
                {(() => {
                  const d = toUTCDate(repeatMonthCursor);
                  const month = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
                  return <h4 className="mini-cal-title">{month} {d.getUTCFullYear()}</h4>;
                })()}
                <button
                  type="button"
                  className="mini-cal-nav"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
              <table className="mini-cal" role="grid" aria-label={calendarMode === 'single' ? 'Single-date calendar' : 'Multi-date calendar'}>
                <thead>
                  <tr>
                    {['S','M','T','W','T','F','S'].map((wd, idx) => (
                      <th key={`weekday-${idx}`} scope="col">{wd}</th>
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
                        const selectedSet = new Set([weatherStartDate, ...repeatDates].filter(Boolean));
                        const isSelected = selectedSet.has(cell);
                        const disabled = false;
                        const utcDate = toUTCDate(cell);
                        const label = utcDate ? DATE_FORMATTER.format(utcDate) : cell;
                        return (
                          <td key={cell}>
                            <button
                              type="button"
                              className={
                                'mini-cal-day' +
                                (isSelected ? ' picked' : '') +
                                (disabled ? ' disabled' : '') +
                                (calendarMode === 'single' ? ' single-mode' : '')
                              }
                              onClick={() => !disabled && toggleRepeatDate(cell)}
                              disabled={disabled}
                              aria-pressed={isSelected}
                              aria-label={label}
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
                  <span className="repeat-summary__label">Selected days</span>
                  {(() => {
                    const selectedSet = new Set([weatherStartDate, ...repeatDates].filter(Boolean));
                    const allSelected = Array.from(selectedSet).sort();
                    
                    if (allSelected.length === 0) {
                      return <p className="repeat-summary__empty">No dates selected—click days to add them.</p>;
                    }
                    
                    return (
                      <ul className="repeat-summary__list">
                        {allSelected.map((date) => {
                          const utcDate = toUTCDate(date);
                          if (!utcDate) {
                            return null;
                          }
                          const formattedDate = DATE_FORMATTER.format(utcDate);
                          return (
                            <li key={`dialog-${date}`} className="repeat-pill">
                              <span>{formattedDate}</span>
                              <button
                                type="button"
                                onClick={() => handleRepeatRemove(date)}
                                aria-label={`Remove ${formattedDate}`}
                              >
                                ×
                              </button>
                            </li>
                          );
                        }).filter(Boolean)}
                      </ul>
                    );
                  })()}
                  <p className="repeat-summary__hint">{t.clickAgainToRemove}</p>
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
                  {t.clearSelection}
                </button>
              )}
              <button type="button" className="cta" onClick={closeCalendar}>
                {t.done}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="cosmic-backdrop" aria-hidden="true" />

      <header className="app-header" role="banner">
        <div className="brand" aria-label="Rain">
          <span className="brand__name">
            <span className="brand__letter">R</span>
            <span className="brand__letter brand__letter--animated">A</span>
            <span className="brand__letter brand__letter--animated">I</span>
            <span className="brand__letter">N</span>
          </span>
        </div>
        <p className="brand__tagline">{t.tagline}</p>
        <div className="language-selector">
          <label htmlFor="language-select" className="visually-hidden">{t.language}</label>
          <select 
            id="language-select"
            value={locale} 
            onChange={(e) => handleLocaleChange(e.target.value)}
            className="language-select"
          >
            <option value="en">English</option>
            <option value="pt">Português BR</option>
          </select>
        </div>
      </header>

      <section className="interface-grid">
        <article className="panel search-panel">
          <header className="panel-header">
            <h2>{t.searchTitle}</h2>
            <p>{t.searchDescription}</p>
          </header>

          <form className="search-form" onSubmit={handleSubmit}>
            <label htmlFor="place-query" className="search-label">
              {t.desiredLocation}
              <div className="autocomplete">
                <input
                  id="place-query"
                  name="place-query"
                  type="text"
                  value={query}
                  onChange={handleQueryChange}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  placeholder={t.placeholder}
                  autoComplete="off"
                  required={!selectedPlaceId}
                />
                {autocompleteLoading && <span className="autocomplete-status loading-dots">{t.searching}</span>}
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
                    <div className="autocomplete-empty">{t.noSuggestions}</div>
                  )}
              </div>
            </label>

            <div className="search-actions">
              <button type="submit" className="cta" disabled={loading}>
                {loading ? t.searching : t.findLocation}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleAddLocation}
                disabled={loading || (!selectedSuggestion && !selectedPlaceId && !result)}
              >
                {t.addLocation}
              </button>
              <button type="button" className="ghost" onClick={handleReset} disabled={loading}>
                {t.clear}
              </button>
            </div>
          </form>

          {selectedLocations.length > 0 && (
            <div className="selected-locations-list">
              <h3>{t.selectedLocations}</h3>
              <ul>
                {selectedLocations.map((location) => (
                  <li key={location.place_id} className="location-item">
                    <span className="location-name">{location.description}</span>
                    <button
                      type="button"
                      className="remove-location-btn"
                      onClick={() => handleRemoveLocation(location.place_id)}
                      title={t.removeLocation}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
                  <h2>{result.formatted_address ?? t.selectedLocation}</h2>
                  {result.google_maps_url && (
                    <a className="maps-link" href={result.google_maps_url} target="_blank" rel="noreferrer">
                      {t.openInMaps}
                    </a>
                  )}
                </div>
              </header>

              <div className="map-wrapper">
                {mapSrc ? (
                  <iframe
                    key={mapSrc}
                    title="Google Map"
                    src={mapSrc}
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ) : (
                  <p className="map-placeholder">{t.mapUnavailable}</p>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h3>{t.emptyTitle}</h3>
              <p>
                {t.emptyDescription}
              </p>
            </div>
          )}
        </article>
      </section>

      {hasWeatherContext && (
        <section className="panel weather-panel">
          <header className="panel-header">
            <h2>{t.weatherTitle}</h2>
            <p>
              {t.weatherDescription.replace('{location}', weatherPanelLocationLabel)}
            </p>
          </header>

          <form
            className="weather-form"
            onSubmit={selectedLocations.length > 0 ? handleMultipleLocationsSubmit : handleWeatherSubmit}
          >
            <fieldset className="segmented" role="radiogroup" aria-label={t.forecastMode}>
              <legend>{t.forecastMode}</legend>
              <label className={weatherMode === 'single' ? 'active' : ''}>
                <input
                  type="radio"
                  name="weather-mode"
                  value="single"
                  checked={weatherMode === 'single'}
                  onChange={() => {
                    setWeatherMode('single');
                    setWeatherError(null);
                    setWeatherEndDate(weatherStartDate || null);
                    setWeatherHourEnd('');
                    setRepeatDates([]);
                    setCalendarOpen(false);
                  }}
                />
                <span className="mode-title">{t.singleMoment}</span>
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
                    setWeatherEndDate((prev) => (!prev || !weatherStartDate || prev < weatherStartDate ? weatherStartDate : prev));
                  }}
                />
                <span className="mode-title">{t.continuousRange}</span>
              </label>
            </fieldset>

            {weatherMode === 'single' && (
              <div className="single-timing">
                <div className="date-picker-trigger" role="button" tabIndex={0} onClick={() => openCalendar('single')} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openCalendar('single')}>
                  <span className="date-picker-trigger__label">{t.date}</span>
                  <span className="date-picker-trigger__value" style={!weatherStartDate ? {opacity: 0.5} : {}}>
                    {weatherStartDate ? (() => {
                      const date = toUTCDate(weatherStartDate);
                      return date ? DATE_FORMATTER.format(date) : t.selectDatePlaceholder;
                    })() : t.selectDatePlaceholder}
                  </span>
                </div>
                <div className="hour-input-container">
                  <span className="hour-input-container__label">
                    {t.hour}
                    <span className="time-badge optional">{t.optional}</span>
                  </span>
                  <div className="hour-input-container__input">
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
            )}
            {weatherMode === 'interval' && (
              <div className="interval-grid" role="group" aria-label="Date and time range">
                <div className="date-picker-trigger" role="button" tabIndex={0} onClick={() => openCalendar('repeat')} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openCalendar('repeat')}>
                  <span className="date-picker-trigger__label">Dates</span>
                  <span className="date-picker-trigger__value" style={!weatherStartDate && repeatDates.length === 0 ? {opacity: 0.5} : {}}>
                    {weatherStartDate || repeatDates.length > 0
                      ? [weatherStartDate, ...repeatDates].filter(Boolean).map((d) => {
                          const utcDate = toUTCDate(d);
                          return utcDate ? SHORT_DATE_FORMATTER.format(utcDate) : null;
                        }).filter(Boolean).join(', ')
                      : t.selectDates}
                  </span>
                  <span className="date-picker-trigger__hint">
                    {weatherStartDate || repeatDates.length > 0 ? `${[weatherStartDate, ...repeatDates].filter(Boolean).length} selected` : ''}
                  </span>
                </div>
                
                <div className="hour-input-container">
                  <span className="hour-input-container__label">
                    {t.startHour}
                  </span>
                  <div className="hour-input-container__input">
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
                </div>

                <div className="hour-input-container">
                  <span className="hour-input-container__label">
                    {t.endHour}
                  </span>
                  <div className="hour-input-container__input">
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
            )}

            <button 
              type="submit" 
              className={weatherLoading ? "cta ai-loading" : "cta"} 
              disabled={weatherLoading || !weatherStartDate}
            >
              <span className={weatherLoading ? "loading-dots" : ""}>
                {weatherLoading ? t.generatingPrediction : t.loadWeather}
              </span>
            </button>
          </form>

          {isMultiLocationActive && (
            <div className="multi-location-progress" aria-live="polite">
              <header className="multi-location-progress__header">
                <div>
                  <h3>{t.multiLocationQueueTitle}</h3>
                  <p>{t.multiLocationQueueSubtitle}</p>
                </div>
                <span
                  className="multi-location-progress__count"
                  aria-label={t.multiLocationCountLabel.replace('{count}', selectedLocations.length)}
                >
                  {selectedLocations.length}
                </span>
              </header>

              {hasQueuedMultiResults ? (
                <>
                  {hasSelectableMultiResults && (
                    <p className="multi-location-progress__hint">{t.multiLocationSelectHint}</p>
                  )}
                  <div className="multi-location-progress__list">
                    {multipleWeatherResults.map((entry, index) => {
                      const status = entry.status ?? 'pending';
                      const isProcessing = status === 'pending' || status === 'loading';
                      const isSuccess = status === 'success' && entry.weatherData;
                      const isError = status === 'error';
                      const isActive = activeLocationId === entry.place_id;
                      const isSelectable = isSuccess;
                      const articleClassName = [
                        'location-result',
                        `location-result--${status}`,
                        isSelectable ? 'location-result--selectable' : '',
                        isActive ? 'location-result--active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      const statusLabel =
                        status === 'success'
                          ? t.multiLocationStatusSuccess
                          : status === 'error'
                          ? t.multiLocationStatusError
                          : status === 'loading'
                          ? t.multiLocationStatusLoading
                          : t.multiLocationStatusPending;
                      const positionLabel = t.multiLocationPosition
                        .replace('{index}', index + 1)
                        .replace('{total}', selectedLocations.length);
                      const weatherData = entry.weatherData;
                      const rangeLabel = weatherData ? formatWeatherTitle(weatherData, DATE_FORMATTER) : '';
                      const granularityLabel = weatherData
                        ? weatherData.granularity === 'hourly'
                          ? t.hourlyData
                          : t.dailyData
                        : '';
                      const isUserActivated = isActive && lastActivationSource === 'user';
                      const ctaTemplate = isSelectable
                        ? (isUserActivated ? t.multiLocationActiveLabel : t.multiLocationSelectLabel)
                        : null;
                      const ctaLabel = ctaTemplate
                        ? ctaTemplate.replace('{location}', entry.description)
                        : null;
                      const handleActivate = () => {
                        if (isSelectable) {
                          activateMultiLocationResult(entry, { source: 'user' });
                        }
                      };
                      const handleKeyDown = (event) => {
                        if (!isSelectable) {
                          return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          activateMultiLocationResult(entry, { source: 'user' });
                        }
                      };

                      return (
                        <article
                          key={entry.place_id}
                          className={articleClassName}
                          role={isSelectable ? 'button' : undefined}
                          tabIndex={isSelectable ? 0 : undefined}
                          onClick={isSelectable ? handleActivate : undefined}
                          onKeyDown={isSelectable ? handleKeyDown : undefined}
                          aria-pressed={isSelectable ? isActive : undefined}
                        >
                        <header className="location-result__header">
                          <div>
                            <h4>{entry.description}</h4>
                            <p className="location-result__position">{positionLabel}</p>
                            {rangeLabel && <p className="location-result__range">{rangeLabel}</p>}
                            {granularityLabel && <p className="location-result__granularity">{granularityLabel}</p>}
                            {ctaLabel && (
                              <p
                                className="location-result__cta"
                                aria-live={isActive ? 'polite' : undefined}
                              >
                                {ctaLabel}
                              </p>
                            )}
                          </div>
                          <span className={`location-result__status-badge status-${status}`}>
                            {statusLabel}
                          </span>
                        </header>

                        {isProcessing && (
                          <div className="location-result__placeholder" aria-hidden="true">
                            <div className="skeleton-line skeleton-line--wide" />
                            <div className="skeleton-line" />
                            <div className="skeleton-pill-row">
                              <span className="skeleton-pill" />
                              <span className="skeleton-pill" />
                              <span className="skeleton-pill" />
                            </div>
                          </div>
                        )}

                        {isError && (
                          <div className="location-result__error">
                            <p>{statusLabel}</p>
                            {entry.error && <small>{entry.error}</small>}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  </div>
                </>
              ) : (
                <p className="multi-location-progress__empty">{t.multiLocationAwaiting}</p>
              )}
            </div>
          )}

          {weatherError && (
            <div className="notice error" role="alert">
              {weatherError}
            </div>
          )}

          {weatherResult && (
            <div className={hasIntervalSeries ? 'weather-outcome interval' : 'weather-outcome'}>
              
              <header className="weather-summary-header">
                <div className="weather-header-badges">
                  {weatherResult.ai_prediction && (
                    <div className="ai-source-badge">
                      <div className="ai-badge-main">
                        {t.aiGeneratedPrediction}
                        {weatherResult.ai_prediction.execution_time && (
                          <span className="ai-execution-time">
                            ({weatherResult.ai_prediction.execution_time}s)
                          </span>
                        )}
                      </div>
                      {(() => {
                        const chosen = weatherResult.ai_prediction.chosen || {};
                        const modelCounts = {};
                        
                        // Count which model was chosen most
                        Object.values(chosen).forEach(info => {
                          const model = info.best_model;
                          if (model) {
                            modelCounts[model] = (modelCounts[model] || 0) + 1;
                          }
                        });
                        
                        // Find the most used model
                        let bestModel = 'Mixed';
                        let maxCount = 0;
                        Object.entries(modelCounts).forEach(([model, count]) => {
                          if (count > maxCount) {
                            maxCount = count;
                            bestModel = model;
                          }
                        });
                        
                        // If all models are used equally, show "Mixed"
                        if (Object.keys(modelCounts).length > 1 && maxCount <= 2) {
                          bestModel = 'Mixed Models';
                        }
                        
                        const yearsBack = weatherResult.ai_prediction.input?.years_back || 6;
                        const totalDays = yearsBack * 365;
                        
                        return (
                          <div className="ai-badge-details">
                            <span className="ai-detail-item">
                              <span className="ai-detail-label">{t.model}:</span> {bestModel}
                            </span>
                            <span className="ai-detail-separator">•</span>
                            <span className="ai-detail-item">
                              <span className="ai-detail-label">{t.trainingData}:</span> ~{totalDays.toLocaleString()} {t.days}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
                {weatherResult.granularity !== 'hourly' && requestedRangeLabel && (
                  <p className="weather-meta">{t.period}: {requestedRangeLabel}</p>
                )}
              </header>

              {hasIntervalSeries && intervalDates.length > 0 && (
                <div className="interval-day-selector" role="group" aria-label="Select day within range">
                  <span className="interval-day-selector__label">Available days</span>
                  <div className="interval-day-selector__options">
                    {intervalDates.map((date) => {
                      const isActive = date === selectedIntervalDate;
                      const utcDate = toUTCDate(date);
                      if (!utcDate) {
                        return null;
                      }
                      const label = SHORT_DATE_FORMATTER.format(utcDate);
                      const fullLabel = DATE_FORMATTER.format(utcDate);
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
                    }).filter(Boolean)}
                  </div>
                </div>
              )}

              {!hasIntervalSeries && weatherResult.data && weatherResult.data.length > 0 && (
                <div className="weather-grid">
                  {weatherResult.data.map((entry, index) => {
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

                    const utcDate = toUTCDate(entry.date);
                    if (!utcDate) {
                      return null;
                    }
                    const dateLabel = DATE_FORMATTER.format(utcDate);
                    const headingLabel = dateLabel;
                    const metaLabel = weatherResult.granularity === 'daily'
                      ? t.dailyData
                      : hourLabel ?? t.hourlyData;
                    const showMetricInsights = index === 0;

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
                            <dt>{t.temperature}</dt>
                            <dd>
                              {formatMetric(entry.t2m, weatherUnits.T2M ?? '°C')}
                              {entry.accuracy?.T2M && (
                                <span className="accuracy-badge">{entry.accuracy.T2M.toFixed(1)}% {t.accuracy}</span>
                              )}
                            </dd>
                            {showMetricInsights && renderMetricInsight('temperature')}
                          </div>
                          {weatherResult.granularity === 'daily' && (
                            <>
                              <div className="weather-day__metric">
                                <dt>{t.high}</dt>
                                <dd>
                                  {formatMetric(entry.t2m_max, weatherUnits.T2M ?? '°C')}
                                  {entry.accuracy?.T2M_MAX && (
                                    <span className="accuracy-badge">{entry.accuracy.T2M_MAX.toFixed(1)}% {t.accuracy}</span>
                                  )}
                                </dd>
                              </div>
                              <div className="weather-day__metric">
                                <dt>{t.low}</dt>
                                <dd>
                                  {formatMetric(entry.t2m_min, weatherUnits.T2M ?? '°C')}
                                  {entry.accuracy?.T2M_MIN && (
                                    <span className="accuracy-badge">{entry.accuracy.T2M_MIN.toFixed(1)}% {t.accuracy}</span>
                                  )}
                                </dd>
                              </div>
                            </>
                          )}
                          <div className="weather-day__metric">
                            <dt>{t.wind10m}</dt>
                            <dd>
                              {formatMetric(entry.ws10m, weatherUnits.WS10M ?? 'm/s')}
                              {entry.accuracy?.WS10M && (
                                <span className="accuracy-badge">{entry.accuracy.WS10M.toFixed(1)}% {t.accuracy}</span>
                              )}
                            </dd>
                            {showMetricInsights && renderMetricInsight('wind')}
                          </div>
                          <div className="weather-day__metric">
                            <dt>{t.precipitation}</dt>
                            <dd>
                              {formatMetric(entry.precip_mm, weatherUnits.PRECTOTCORR ?? weatherUnits.PRECTOT ?? 'mm')}
                              {entry.accuracy?.PRECTOTCORR && (
                                <span className="accuracy-badge">{entry.accuracy.PRECTOTCORR.toFixed(1)}% {t.accuracy}</span>
                              )}
                            </dd>
                            {showMetricInsights && renderMetricInsight('precipitation')}
                          </div>
                        </dl>
                      </article>
                    );
                  }).filter(Boolean)}
                </div>
              )}

              {hasIntervalSeries && intervalChartData && (
                <div className="weather-chart-card">
                  <header>
                    <h4>{t.variationAcrossRange}</h4>
                    <p>
                      {t.exploreEvolution}
                      {selectedIntervalDateLabel && (
                        <>
                          {' '}
                          <span className="chart-day-label">{t.selectedDay}: {selectedIntervalDateLabel}</span>
                        </>
                      )}
                    </p>
                  </header>
                  <div className="chart-grid">
                    {temperatureChartData && temperatureChartOptions && (
                      <article className="chart-panel" aria-label="Hourly temperature chart">
                        <header className="chart-panel__header">
                          <div>
                            <h5>{t.temperature}</h5>
                            <p className="chart-insight">{chartInsights?.temperature}</p>
                          </div>
                          {temperatureSummary?.metrics?.length > 0 && (
                            <div className="chart-panel__metrics">
                              {temperatureSummary.metrics.map((metric, index) => (
                                <span key={`temp-metric-${index}`}>
                                  <strong>{metric.label}</strong>
                                  <em>{metric.value}</em>
                                </span>
                              ))}
                            </div>
                          )}
                        </header>
                        <div className="chart-canvas">
                          <Line key={`temperature-${selectedIntervalDate ?? 'none'}`} options={temperatureChartOptions} data={temperatureChartData} />
                        </div>
                        {temperatureSummary && (
                          <div className={`chart-summary card-${temperatureSummary.tone}`}>
                            <div className="chart-summary__icon" aria-hidden="true">{temperatureSummary.icon}</div>
                            <div className="chart-summary__content">
                              <p className="chart-summary__headline">{temperatureSummary.headline}</p>
                              {temperatureSummary.detail && (
                                <p className="chart-summary__detail">{temperatureSummary.detail}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    )}
                    {windChartData && windChartOptions && (
                      <article className="chart-panel" aria-label="Hourly wind chart">
                        <header className="chart-panel__header">
                          <div>
                            <h5>{t.wind}</h5>
                            <p className="chart-insight">{chartInsights?.wind}</p>
                          </div>
                          {windSummary?.metrics?.length > 0 && (
                            <div className="chart-panel__metrics">
                              {windSummary.metrics.map((metric, index) => (
                                <span key={`wind-metric-${index}`}>
                                  <strong>{metric.label}</strong>
                                  <em>{metric.value}</em>
                                </span>
                              ))}
                            </div>
                          )}
                        </header>
                        <div className="chart-canvas">
                          <Line key={`wind-${selectedIntervalDate ?? 'none'}`} options={windChartOptions} data={windChartData} />
                        </div>
                        {windSummary && (
                          <div className={`chart-summary card-${windSummary.tone}`}>
                            <div className="chart-summary__icon" aria-hidden="true">{windSummary.icon}</div>
                            <div className="chart-summary__content">
                              <p className="chart-summary__headline">{windSummary.headline}</p>
                              {windSummary.detail && (
                                <p className="chart-summary__detail">{windSummary.detail}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    )}
                    {precipitationChartData && precipitationChartOptions && (
                      <article className="chart-panel" aria-label="Hourly precipitation chart">
                        <header className="chart-panel__header">
                          <div>
                            <h5>{t.precipitation}</h5>
                            <p className="chart-insight">{chartInsights?.precipitation}</p>
                          </div>
                          {precipitationSummary?.metrics?.length > 0 && (
                            <div className="chart-panel__metrics">
                              {precipitationSummary.metrics.map((metric, index) => (
                                <span key={`precip-metric-${index}`}>
                                  <strong>{metric.label}</strong>
                                  <em>{metric.value}</em>
                                </span>
                              ))}
                            </div>
                          )}
                        </header>
                        <div className="chart-canvas">
                          <Bar key={`precipitation-${selectedIntervalDate ?? 'none'}`} options={precipitationChartOptions} data={precipitationChartData} />
                        </div>
                        {precipitationSummary && (
                          <div className={`chart-summary card-${precipitationSummary.tone}`}>
                            <div className="chart-summary__icon" aria-hidden="true">{precipitationSummary.icon}</div>
                            <div className="chart-summary__content">
                              <p className="chart-summary__headline">{precipitationSummary.headline}</p>
                              {precipitationSummary.detail && (
                                <p className="chart-summary__detail">{precipitationSummary.detail}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    )}
                  </div>
                </div>
              )}
              
              {/* Download PDF Button - Centered at bottom */}
              <div className="pdf-download-section">
                <button 
                  type="button"
                  className="download-pdf-btn"
                  onClick={handlePdfDownload}
                  title={t.downloadPdfReport}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {t.downloadPdfReport}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        <small>{t.dataSources}</small>
      </footer>
    </main>
  );
}
