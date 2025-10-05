# Vanguarda Cósmica – Weather Intelligence

Aplicativo full-stack com **previsão meteorológica inteligente**: o usuário informa um **local** e recebe dados climáticos da NASA POWER. Quando dados não estão disponíveis (datas recentes/futuras), o sistema utiliza **Machine Learning** para gerar previsões com 3 modelos de IA (SARIMAX, Gradient Boosting, Random Forest).

## 🌟 Funcionalidades

- 🗺️ **Busca de Localização**: Google Places autocomplete + geocoding
- 🌤️ **Dados Meteorológicos**: NASA POWER API (temperatura, vento, precipitação)
- 🤖 **Previsão com IA**: ML models treinados com 6 anos de dados históricos
- 📊 **Acurácia Visível**: Cada métrica de IA mostra sua porcentagem de confiança
- 🌐 **Bilíngue**: Suporte completo PT-BR e EN
- 📈 **Visualização**: Gráficos interativos para dados horários

## 🏗️ Arquitetura

- **Backend (`/backend`)**: FastAPI + NASA POWER + scikit-learn + statsmodels
- **Frontend (`/frontend`)**: React + Vite + Chart.js
- **IA**: 3 modelos ensemble (auto-seleção por RMSE)

### Endpoints da API

- `POST /api/geocode` → Converte local em coordenadas
- `GET /api/place-autocomplete` → Sugestões de localização
- `GET /api/weather-summary` → Dados climáticos (usa IA automaticamente quando necessário)

## 🤖 Sistema de IA

Quando a NASA POWER não tem dados disponíveis (valores -999 ou erro), o sistema:

1. **Busca 6 anos** de dados históricos da mesma localização
2. **Treina 3 modelos** para cada variável:
   - SARIMAX (séries temporais com sazonalidade)
   - Gradient Boosting (ensemble tree-based)
   - Random Forest (ensemble robusto)
3. **Seleciona automaticamente** o modelo com menor RMSE
4. **Calcula acurácia** baseada no RMSE de validação
5. **Retorna previsão** com indicador de confiança

### Acurácia Exibida

```json
{
  "accuracy": {
    "T2M": 99.2,      // 99.2% de acurácia
    "T2M_MAX": 98.3,  // 98.3% de acurácia
    "WS10M": 96.9,    // 96.9% de acurácia
    "PRECTOTCORR": 84.3  // 84.3% de acurácia
  }
}
```

A acurácia aparece como badge roxo junto a cada métrica no frontend.

## 📦 Dependências Backend

```txt
fastapi
uvicorn[standard]
httpx
pydantic
pandas
numpy
scikit-learn
statsmodels
```

## 📦 Dependências Frontend

```txt
react
chart.js
react-chartjs-2
```

## Como rodar o backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

export GOOGLE_MAPS_API_KEY="sua-chave-google"
uvicorn app.main:app --reload --port 8000
```

## Como rodar o frontend

```bash
cd frontend
npm install
echo "VITE_GOOGLE_MAPS_API_KEY=sua-chave-google" > .env.local
echo "VITE_API_BASE=http://localhost:8000" >> .env.local
npm run dev
```

Acesse: `http://localhost:5173`

## 🧪 Testando a Previsão com IA

```bash
# Testar para data sem dados disponíveis (usa IA)
curl "http://localhost:8000/api/weather-summary?lat=-7.12&lon=-34.88&start_date=20251004&end_date=20251004"
```

Resposta incluirá:
- ✅ `data[0].accuracy` - Porcentagens de acurácia por variável
- ✅ `ai_prediction.chosen` - Melhor modelo selecionado para cada métrica
- ✅ `meta.source` - "AI Prediction"

## 🎨 Interface do Usuário

### Feedback de Carregamento Progressivo

Quando consulta demora (IA processando):

1. **Fase 0** (0-1.5s): "Pesquisando dados..."
2. **Fase 1** (1.5-4s): "Analisando padrões..." + animação ativa
3. **Fase 2** (4-7s): "Gerando previsão..."
4. **Fase 3** (7s+): "Finalizando resultados..."

### Cards de Dados com Acurácia

Quando IA é usada, cada métrica mostra:

```
🌡️ Temperatura: 25.4°C
   [96.9% accuracy] ← Badge roxo
```

## Consulta de clima (NASA POWER)

Endpoint unificado que usa automaticamente IA quando necessário:

```bash
curl "http://localhost:8000/api/weather-summary?lat=-7.12&lon=-34.86&date=20251004"
```

Resposta (resumo diário):

```json
{
	"meta": {
		"service": "POWER",
		"version": "2.0",
		"time_standard": "LST",
		"available_start": "20251001",
		"available_end": "20251004",
		"units": {
			"T2M": "C",
			"WS10M": "m/s",
			"PRECTOT": "mm"
		}
	},
	"granularity": "daily",
	"data": [
		{
			"date": "2025-10-04",
			"hour": null,
			"hour_end": null,
			"t2m": 25.7,
			"t2m_max": 31.2,
			"t2m_min": 21.3,
			"ws10m": 5.6,
			"precip_mm": 1.8,
			"flags": {
				"rain_risk": false,
				"wind_caution": false,
				"heat_caution": false
			}
		}
	],
	"series": null
}
```

Uso horário (hora 15):

```bash
curl "http://localhost:8000/api/weather-summary?lat=-7.12&lon=-34.86&date=20251004&hour_start=15"
```

```json
{
	"meta": { "...": "..." },
	"granularity": "hourly",
	"data": [
		{
			"date": "2025-10-04",
			"hour": 15,
			"hour_end": null,
			"t2m": 26.1,
			"ws10m": 4.8,
			"precip_mm": 0.0,
			"flags": {
				"rain_risk": false,
				"wind_caution": false,
				"heat_caution": false
			}
		}
	],
	"series": null
}
```

Uso por intervalo (média ponderada das horas entre 10h e 13h):

```bash
curl "http://localhost:8000/api/weather-summary?lat=-7.12&lon=-34.86&date=20251004&hour_start=10&hour_end=13"
```

```json
{
	"meta": { "...": "..." },
	"granularity": "hourly",
	"data": [
		{
			"date": "2025-10-04",
			"hour": 10,
			"hour_end": 13,
			"t2m": 27.4,
			"ws10m": 6.1,
			"precip_mm": 1.5,
			"flags": {
				"rain_risk": true,
				"wind_caution": false,
				"heat_caution": false
			}
		}
	],
	"series": [
		{
			"date": "2025-10-04",
			"hour": 10,
			"hour_end": null,
			"t2m": 26.0,
			"ws10m": 5.5,
			"precip_mm": 1.0,
			"flags": {
				"rain_risk": false,
				"wind_caution": false,
				"heat_caution": false
			}
		},
		{
			"date": "2025-10-04",
			"hour": 11,
			"hour_end": null,
			"t2m": 27.0,
			"ws10m": 6.4,
			"precip_mm": 1.3,
			"flags": {
				"rain_risk": false,
				"wind_caution": false,
				"heat_caution": false
			}
		},
		{
			"date": "2025-10-04",
			"hour": 12,
			"hour_end": null,
			"t2m": 28.4,
			"ws10m": 7.0,
			"precip_mm": 1.8,
			"flags": {
				"rain_risk": true,
				"wind_caution": false,
				"heat_caution": false
			}
		},
		{
			"date": "2025-10-04",
			"hour": 13,
			"hour_end": null,
			"t2m": 28.2,
			"ws10m": 7.4,
			"precip_mm": 1.9,
			"flags": {
				"rain_risk": true,
				"wind_caution": false,
				"heat_caution": false
			}
		}
	]
}
```

O backend elimina valores faltantes (`-999`) e calcula *flags* simples para chuva, vento e calor, facilitando o cálculo de um "score de evento ao ar livre" no frontend.

Sempre que um intervalo é solicitado, a chave `series` traz cada hora individual para alimentar visualizações (como o gráfico exibido no frontend) mantendo, ao mesmo tempo, o resumo agregado na lista principal.

## Testes do backend

```bash
cd backend
source .venv/bin/activate
pytest
```

Os testes substituem o geocoder real por um stub para manter previsibilidade offline.

## Próximos passos

- Comparar múltiplos intervalos horários lado a lado em um painel analítico.
- Exibir opções avançadas no mapa (zoom customizado, camadas, modo satélite).
- Oferecer histórico local das pesquisas recentes.