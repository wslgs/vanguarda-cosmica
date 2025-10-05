/**
 * 🎯 Componente de Acurácia AI - Pronto para usar
 * 
 * Este componente exibe as métricas de acurácia de forma visual e intuitiva.
 * Pode ser facilmente integrado na sua aplicação existente.
 */

import React from 'react';

const AccuracyPanel = ({ weatherData }) => {
  if (!weatherData?.ai_prediction) return null;

  // Extrai estatísticas de acurácia dos dados
  const getAccuracyStats = () => {
    const stats = new Map();
    
    weatherData.data?.forEach(entry => {
      if (!entry.accuracy) return;
      
      Object.entries(entry.accuracy).forEach(([variable, value]) => {
        if (!stats.has(variable)) {
          stats.set(variable, []);
        }
        stats.get(variable).push(value);
      });
    });
    
    // Calcula média para cada variável
    const result = {};
    stats.forEach((values, variable) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      result[variable] = {
        avg: avg,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
      };
    });
    
    return result;
  };

  const accuracyStats = getAccuracyStats();

  // Configurações de exibição por variável
  const variableConfig = {
    T2M: {
      label: 'Temperatura',
      icon: '🌡️',
      tolerance: '±1°C',
      color: '#ff6b6b',
    },
    T2M_MAX: {
      label: 'Temp. Máxima',
      icon: '🔥',
      tolerance: '±1.5°C',
      color: '#ff8c42',
    },
    T2M_MIN: {
      label: 'Temp. Mínima',
      icon: '❄️',
      tolerance: '±1.5°C',
      color: '#4ecdc4',
    },
    WS10M: {
      label: 'Vento',
      icon: '💨',
      tolerance: '±1.5 m/s',
      color: '#95e1d3',
    },
    PRECTOTCORR: {
      label: 'Precipitação',
      icon: '🌧️',
      tolerance: 'F1 Score',
      color: '#3db2ff',
    },
  };

  // Determina cor baseada no nível de acurácia
  const getAccuracyColor = (accuracy) => {
    if (accuracy >= 80) return '#4caf50';
    if (accuracy >= 70) return '#ffc107';
    if (accuracy >= 60) return '#ff9800';
    return '#f44336';
  };

  // Determina texto de interpretação
  const getInterpretation = (accuracy) => {
    if (accuracy >= 80) return 'Excelente';
    if (accuracy >= 70) return 'Bom';
    if (accuracy >= 60) return 'Moderado';
    return 'Baixo';
  };

  return (
    <div className="accuracy-panel">
      <div className="accuracy-header">
        <h3>
          <span className="ai-icon">🤖</span>
          Métricas de Confiabilidade AI
        </h3>
        <p className="accuracy-subtitle">
          Baseado em {weatherData.ai_prediction.input?.years_back || 6} anos de histórico
        </p>
      </div>

      <div className="accuracy-grid">
        {Object.entries(accuracyStats).map(([variable, stats]) => {
          const config = variableConfig[variable];
          if (!config) return null;

          const accuracy = stats.avg;
          const accuracyColor = getAccuracyColor(accuracy);
          const interpretation = getInterpretation(accuracy);

          return (
            <div key={variable} className="accuracy-card">
              <div className="card-header">
                <span className="variable-icon">{config.icon}</span>
                <div className="variable-info">
                  <h4>{config.label}</h4>
                  <span className="tolerance">{config.tolerance}</span>
                </div>
              </div>

              <div className="accuracy-value-container">
                <div 
                  className="accuracy-circle" 
                  style={{ borderColor: accuracyColor }}
                >
                  <span className="accuracy-number">{accuracy.toFixed(1)}</span>
                  <span className="accuracy-unit">%</span>
                </div>
              </div>

              <div className="accuracy-bar-container">
                <div className="accuracy-bar-bg">
                  <div 
                    className="accuracy-bar-fill" 
                    style={{ 
                      width: `${accuracy}%`,
                      backgroundColor: accuracyColor 
                    }}
                  />
                </div>
              </div>

              <div className="accuracy-label">
                <span 
                  className="interpretation-badge"
                  style={{ 
                    backgroundColor: `${accuracyColor}20`,
                    color: accuracyColor 
                  }}
                >
                  {interpretation}
                </span>
              </div>

              {stats.count > 1 && (
                <div className="accuracy-range">
                  <small>
                    Variação: {stats.min.toFixed(1)}% - {stats.max.toFixed(1)}%
                  </small>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="accuracy-info">
        <div className="info-section">
          <h5>📊 Como interpretar:</h5>
          <ul>
            <li>
              <strong>Temperatura/Vento:</strong> Probabilidade de estar dentro da margem de erro especificada
            </li>
            <li>
              <strong>Precipitação:</strong> F1 Score indica precisão e recall na detecção de chuva (≥1mm)
            </li>
          </ul>
        </div>

        <div className="info-section">
          <h5>🎯 Níveis de confiabilidade:</h5>
          <div className="confidence-levels">
            <span className="level excellent">≥80% Excelente</span>
            <span className="level good">70-80% Bom</span>
            <span className="level moderate">60-70% Moderado</span>
            <span className="level low">&lt;60% Baixo</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .accuracy-panel {
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
          border: 1px solid rgba(211, 214, 255, 0.1);
          border-radius: 1rem;
          padding: 1.5rem;
          margin: 1.5rem 0;
        }

        .accuracy-header {
          margin-bottom: 1.5rem;
        }

        .accuracy-header h3 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 0 0 0.5rem 0;
          font-size: 1.25rem;
          color: rgba(211, 214, 255, 0.95);
        }

        .ai-icon {
          font-size: 1.5rem;
        }

        .accuracy-subtitle {
          margin: 0;
          font-size: 0.875rem;
          color: rgba(211, 214, 255, 0.6);
        }

        .accuracy-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .accuracy-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(211, 214, 255, 0.1);
          border-radius: 0.75rem;
          padding: 1rem;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .accuracy-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }

        .variable-icon {
          font-size: 2rem;
        }

        .variable-info h4 {
          margin: 0;
          font-size: 1rem;
          color: rgba(211, 214, 255, 0.9);
        }

        .tolerance {
          font-size: 0.75rem;
          color: rgba(211, 214, 255, 0.5);
        }

        .accuracy-value-container {
          display: flex;
          justify-content: center;
          margin: 1rem 0;
        }

        .accuracy-circle {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          border: 3px solid;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.2);
        }

        .accuracy-number {
          font-size: 1.5rem;
          font-weight: 700;
          line-height: 1;
          color: rgba(211, 214, 255, 0.95);
        }

        .accuracy-unit {
          font-size: 0.75rem;
          color: rgba(211, 214, 255, 0.6);
        }

        .accuracy-bar-container {
          margin: 1rem 0 0.5rem 0;
        }

        .accuracy-bar-bg {
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          overflow: hidden;
        }

        .accuracy-bar-fill {
          height: 100%;
          transition: width 0.5s ease;
          border-radius: 3px;
        }

        .accuracy-label {
          display: flex;
          justify-content: center;
          margin-top: 0.75rem;
        }

        .interpretation-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 1rem;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .accuracy-range {
          text-align: center;
          margin-top: 0.5rem;
          color: rgba(211, 214, 255, 0.5);
        }

        .accuracy-info {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 0.5rem;
          padding: 1rem;
          margin-top: 1.5rem;
        }

        .info-section {
          margin-bottom: 1rem;
        }

        .info-section:last-child {
          margin-bottom: 0;
        }

        .info-section h5 {
          margin: 0 0 0.5rem 0;
          font-size: 0.875rem;
          color: rgba(211, 214, 255, 0.8);
        }

        .info-section ul {
          margin: 0;
          padding-left: 1.25rem;
          font-size: 0.8125rem;
          color: rgba(211, 214, 255, 0.7);
          line-height: 1.6;
        }

        .info-section li {
          margin-bottom: 0.25rem;
        }

        .confidence-levels {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .level {
          padding: 0.25rem 0.625rem;
          border-radius: 0.25rem;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .level.excellent {
          background-color: rgba(76, 175, 80, 0.2);
          color: #4caf50;
          border: 1px solid rgba(76, 175, 80, 0.4);
        }

        .level.good {
          background-color: rgba(255, 193, 7, 0.2);
          color: #ffc107;
          border: 1px solid rgba(255, 193, 7, 0.4);
        }

        .level.moderate {
          background-color: rgba(255, 152, 0, 0.2);
          color: #ff9800;
          border: 1px solid rgba(255, 152, 0, 0.4);
        }

        .level.low {
          background-color: rgba(244, 67, 54, 0.2);
          color: #f44336;
          border: 1px solid rgba(244, 67, 54, 0.4);
        }

        @media (max-width: 768px) {
          .accuracy-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default AccuracyPanel;
