import React, { useMemo } from 'react';

const AccuracyBadge = ({ variable, accuracy, tolerance, unit }) => {
  const getColorClass = (acc) => {
    if (acc >= 80) return 'accuracy-excellent';
    if (acc >= 70) return 'accuracy-good';
    if (acc >= 60) return 'accuracy-fair';
    return 'accuracy-poor';
  };

  return (
    <div className={`accuracy-badge ${getColorClass(accuracy)}`}>
      <span className="accuracy-label">{variable}</span>
      <span className="accuracy-value">{accuracy.toFixed(1)}%</span>
      {tolerance && (
        <span className="accuracy-tolerance">±{tolerance}{unit}</span>
      )}
    </div>
  );
};

const AIPredictionInfo = ({ aiPrediction, weatherData }) => {
  if (!aiPrediction) return null;
  
  const getAccuracyStats = () => {
    const stats = { temperature: null, wind: null, precipitation: null };
    
    weatherData.data?.forEach(entry => {
      if (entry.accuracy) {
        if (entry.accuracy.T2M && !stats.temperature) stats.temperature = entry.accuracy.T2M;
        if (entry.accuracy.WS10M && !stats.wind) stats.wind = entry.accuracy.WS10M;
        if (entry.accuracy.PRECTOTCORR && !stats.precipitation) stats.precipitation = entry.accuracy.PRECTOTCORR;
      }
    });
    
    return stats;
  };
  
  const accuracyStats = getAccuracyStats();
  
  return (
    <div className="ai-prediction-panel">
      <h3>🤖 Previsão AI</h3>
      
      <div className="prediction-meta">
        <p>Tempo de execução: {aiPrediction.execution_time?.toFixed(2)}s</p>
        <p>Histórico usado: {aiPrediction.input?.years_back || 6} anos</p>
      </div>
      
      <div className="accuracy-summary">
        <h4>Métricas de Confiabilidade</h4>
        
        {accuracyStats.temperature && (
          <div className="metric-row">
            <span className="metric-icon">🌡️</span>
            <span className="metric-name">Temperatura</span>
            <span className="metric-value">{accuracyStats.temperature.toFixed(1)}%</span>
            <span className="metric-tolerance">±1°C</span>
          </div>
        )}
        
        {accuracyStats.wind && (
          <div className="metric-row">
            <span className="metric-icon">💨</span>
            <span className="metric-name">Vento</span>
            <span className="metric-value">{accuracyStats.wind.toFixed(1)}%</span>
            <span className="metric-tolerance">±1.5 m/s</span>
          </div>
        )}
        
        {accuracyStats.precipitation && (
          <div className="metric-row">
            <span className="metric-icon">🌧️</span>
            <span className="metric-name">Precipitação</span>
            <span className="metric-value">{accuracyStats.precipitation.toFixed(1)}%</span>
            <span className="metric-tolerance">F1 Score</span>
          </div>
        )}
      </div>
      
      <div className="accuracy-explanation">
        <p><strong>Como interpretar:</strong></p>
        <ul>
          <li><strong>Temperatura/Vento:</strong> Probabilidade de estar dentro da margem de erro</li>
          <li><strong>Precipitação:</strong> F1 Score indica precisão na detecção de chuva</li>
          <li><strong>&gt;80%:</strong> Excelente • <strong>70-80%:</strong> Bom • <strong>60-70%:</strong> Moderado</li>
        </ul>
      </div>
    </div>
  );
};

const useAccuracyData = (weatherData) => {
  return useMemo(() => {
    if (!weatherData?.data) return null;
    
    const stats = { overall: null, byVariable: {}, interpretation: '' };
    let totalAccuracy = 0;
    let count = 0;
    
    weatherData.data.forEach(entry => {
      if (!entry.accuracy) return;
      
      Object.entries(entry.accuracy).forEach(([variable, accuracy]) => {
        if (!stats.byVariable[variable]) {
          stats.byVariable[variable] = { values: [], avg: 0, min: Infinity, max: -Infinity };
        }
        
        const varStats = stats.byVariable[variable];
        varStats.values.push(accuracy);
        varStats.min = Math.min(varStats.min, accuracy);
        varStats.max = Math.max(varStats.max, accuracy);
        
        totalAccuracy += accuracy;
        count++;
      });
    });
    
    Object.values(stats.byVariable).forEach(varStats => {
      varStats.avg = varStats.values.reduce((a, b) => a + b, 0) / varStats.values.length;
    });
    
    if (count > 0) {
      stats.overall = totalAccuracy / count;
      
      if (stats.overall >= 80) stats.interpretation = 'Excelente confiabilidade nas previsões';
      else if (stats.overall >= 70) stats.interpretation = 'Boa confiabilidade nas previsões';
      else if (stats.overall >= 60) stats.interpretation = 'Confiabilidade moderada';
      else stats.interpretation = 'Baixa confiabilidade - use com cautela';
    }
    
    return stats;
  }, [weatherData]);
};

export { AccuracyBadge, AIPredictionInfo, useAccuracyData };
// console.log(accuracyData.overall); // 75.4
// console.log(accuracyData.interpretation); // "Boa confiabilidade nas previsões"


/* ============================================
   EXPORTAÇÃO DOS EXEMPLOS
   ============================================ */

export {
  AccuracyBadge,
  AIPredictionInfo,
  WeatherDayCard,
  getEnhancedTooltip,
  useAccuracyData,
  styles as accuracyStyles,
};
