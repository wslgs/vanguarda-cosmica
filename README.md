# Rain – Localizador de Coordenadas

Aplicativo full-stack minimalista: o usuário informa o **local** (ex.: ponto turístico, estabelecimento, rua) e recebe as coordenadas de latitude e longitude correspondentes com sugestões automáticas do Google Places, além de um mapa pronto para abrir.

## Arquitetura

- **Backend (`/backend`)**: FastAPI + Google Maps Geocoding API.
- **Frontend (`/frontend`)**: React + Vite com formulário de busca única e mapa embutido.
- **Comunicação**:
	- `POST /api/geocode` com payload `{ query }` retornando `{ latitude, longitude, formatted_address, place_id, google_maps_url }`.
	- `GET /api/place-autocomplete?input=<texto>[&session_token=<uuid>]` devolve sugestões (Google Places) para preencher o campo de busca do frontend.
	- `GET /api/weather-summary?lat=<float>&lon=<float>&date=<YYYYMMDD>[&hour_start=<0-23>[&hour_end=<0-23>]]` retorna dados climáticos NASA POWER em modo diário (padrão) ou horária/intervalo quando `hour_start` (e opcionalmente `hour_end`) são informados.

## Pré-requisitos

- Python 3.11+
- Node.js 18+
- npm (ou pnpm/yarn adaptando comandos)
- Chave de API do Google Maps com acesso ao **Geocoding API** e (opcionalmente) **Maps Embed API**

## Como rodar o backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export GOOGLE_MAPS_API_KEY="sua-chave-google"
uvicorn app.main:app --reload --port 8000
```

> O parâmetro `GEOCODER_TIMEOUT` (padrão 5s) controla o tempo máximo de resposta do Google.

## Como rodar o frontend

```bash
cd frontend
npm install
echo "VITE_GOOGLE_MAPS_API_KEY=sua-chave-google" > .env.local
npm run dev
```

O Vite abre em `http://localhost:5173` e encaminha `/api/geocode` para `http://localhost:8000` durante o desenvolvimento.

> Se preferir manter a chave apenas no backend, remova a linha acima. O frontend usará um `iframe` de fallback sem autenticação (com menos recursos), mas o link "Abrir no Google Maps" continuará funcionando.

### Repetição de dias no modo intervalo

- Escolha **Intervalo contínuo** para definir uma data inicial e duas horas (início/fim) do dia.
- Pressione o botão **Repete** para abrir o seletor de datas e marque quantos dias adicionais quiser repetir; a data inicial é sempre incluída.
- Após confirmar, o painel de gráficos exibe um seletor apenas com as datas escolhidas, cada uma respeitando o intervalo horário informado.

## Consulta de clima (NASA POWER)

Com a API rodando, é possível consultar o resumo climático diário fornecendo latitude, longitude e a data no formato `YYYYMMDD` (a resposta é em **tempo solar local**):

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