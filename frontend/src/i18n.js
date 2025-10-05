export const translations = {
  en: {
    // Header
    tagline: 'Orbital-scale weather intelligence.',
    
    // Search Panel
    searchTitle: 'Enter a location',
    searchDescription: 'Search any location in the world for precise weather forecasts.',
    desiredLocation: 'Desired location',
    placeholder: 'ex: Central Park, New York',
    searching: 'Searching',
    findLocation: 'Find location',
    clear: 'Clear',
    noSuggestions: 'No suggestions found.',
    
    // Empty State
    emptyTitle: 'Ready for liftoff',
    emptyDescription: 'Select a destination to view the interactive map and explore detailed weather forecasts.',
    
    // Result Panel
    selectedLocation: 'Selected location',
    query: 'Query',
    openInMaps: 'Open in Google Maps ↗',
    mapUnavailable: 'Map unavailable. Use the link above.',
    
    // Weather Panel
    weatherTitle: 'Atmospheric conditions',
    weatherDescription: 'Review the NASA POWER-based forecast for {location} and adjust the level of detail as needed.',
    selectedLocationWeather: 'the selected location',
    
    // Weather Form
    forecastMode: 'Forecast mode',
    singleMoment: 'Single moment',
    continuousRange: 'Continuous range',
    date: 'Date',
    hour: 'Hour',
    optional: 'Optional',
    startDate: 'Start date',
    endDate: 'End date',
    granularity: 'Granularity',
    daily: 'Daily',
    hourly: 'Hourly',
    startHour: 'Start hour',
    endHour: 'End hour',
    loadWeather: 'Load weather',
    loading: 'Loading',
    generatingPrediction: 'Generating prediction',
    selectDates: 'Select dates',
    repeatSelection: 'Repeat selection',
    clearSelection: 'Clear selection',
    done: 'Done',
    clickAgainToRemove: 'Click a day again to remove it (except the first).',
    
    // Weather Info
    temperatureTitle: 'Temperature',
    temperatureAt2m: 'Temperature at 2 meters',
    windTitle: 'Wind',
    windSpeed: 'Wind speed at 10 meters',
    precipitationTitle: 'Precipitation',
    precipitationAmount: 'Precipitation amount',
    dailyData: 'Daily data',
    hourlyData: 'Hourly data',
    
    // Units
    celsius: '°C',
    metersPerSecond: 'm/s',
    millimeters: 'mm',
    
    // Errors
    errorLoadingWeather: 'Error loading weather data. Please try again.',
    invalidDateRange: 'End date must be after start date.',
    invalidHourRange: 'End hour must be after start hour.',
    selectAtLeastOneDate: 'Select at least one valid date.',
    couldNotRetrieveData: "We couldn't retrieve the weather data.",
    hourMustBeProvided: 'must be provided.',
    hourMustBeInteger: 'must be an integer between 0 and 23.',
    selectedHour: 'Selected hour',
    
    // Data Source
    dataSources: 'Data sources: Google Maps Platform · NASA POWER',
    
    // Language Selector
    language: 'Language',
    
    // Month names
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    
    // AI Prediction
    aiPredictionDescription: 'Data predicted using machine learning models trained on 6 years of historical data',
    aiGeneratedPrediction: 'AI-generated prediction',
    model: 'Model',
    trainingData: 'Training data',
    days: 'days',
    downloadPdfReport: 'Download PDF Report',
    pdfError: 'Error generating PDF. Please try again.',
    accuracy: 'accuracy',
    period: 'Period',
    high: 'High',
    low: 'Low',
    wind10m: '10 m wind',
    precipitation: 'Precipitation',
    temperature: 'Temperature',
    wind: 'Wind',
    variationAcrossRange: 'Variation across the selected range',
    exploreEvolution: 'Explore how temperature, wind, and precipitation evolve hour by hour.',
    selectedDay: 'Selected day',
    
    // Weather descriptions
    extremeHeat: 'Extreme heat ahead—prioritize shade and hydration.',
    highTemp: 'High temperatures expected—schedule cooling breaks.',
    coolTemp: 'Cool conditions—consider an extra layer.',
    comfortableTemp: 'Comfortable temperatures for outdoor plans.',
    strongWind: 'Strong gusts—secure loose items and stay alert.',
    moderateWind: 'Steady moderate wind may disrupt outdoor plans.',
    calmWind: 'Barely any wind, stable feels-like conditions.',
    lightBreeze: 'Light breeze adding to thermal comfort.',
    heavyRain: 'Significant rain likely—plan shelter or rain gear.',
    lightRain: 'Light rain or drizzle possible—carry an umbrella.',
    briefDrizzle: 'Small chance of brief drizzle—keep an eye on the sky.',
    noRain: 'No rain expected for this period.',
    
    // Chart insights
    notEnoughData: 'Not enough data for the selected window.',
    sharpHeatSpikes: 'Sharp heat spikes ({max}°C)—avoid peak exposure hours.',
    highTempAverage: 'High temperatures, averaging {avg}°C across the period.',
    tempRange: 'Temperatures stay between {min}°C and {max}°C.',
    windPeaks: 'Wind peaks at {max} m/s—watch for gusts.',
    moderateWindAvg: 'Moderate wind dominates (average {avg} m/s).',
    gentleWind: 'Gentle wind stays below {max} m/s.',
    heavyRainPeaks: 'Heavy rain with peaks of {max} mm/h—plan for cover.',
    lightRainFluc: 'Light rain fluctuations (average {avg} mm/h).',
    dryWindow: 'Dry window with no recorded precipitation.',
    occasionalDrizzle: 'Occasional drizzle adds up to {total} mm across the window.',
    
    // Overall insights
    slot: 'slot',
    slots: 'slots',
    entry: 'entry',
    entries: 'entries',
    intenseHeat: '{count} {unit} of intense heat—plan shaded breaks.',
    comfortableRange: 'Temperatures stay within a comfortable range most of the time.',
    rainWarning: 'Rain appears in {count} {unit}—pack a raincoat or umbrella.',
    noMeaningfulRain: 'No meaningful rain signals throughout the analyzed period.',
    gustyConditions: 'Gusty conditions in {count} {unit}—exercise extra caution outdoors.',
    calmWinds: 'Calm winds dominate, keeping the feels-like temperature steady.',
  },
  
  pt: {
    // Header
    tagline: 'Inteligência meteorológica em escala orbital.',
    
    // Search Panel
    searchTitle: 'Insira uma localização',
    searchDescription: 'Busque qualquer lugar do mundo para gerar previsões meteorológicas precisas.',
    desiredLocation: 'Localização desejada',
    placeholder: 'ex: Parque Ibirapuera, São Paulo',
    searching: 'Buscando',
    findLocation: 'Buscar localização',
    clear: 'Limpar',
    noSuggestions: 'Nenhuma sugestão encontrada.',
    
    // Empty State
    emptyTitle: 'Pronto para decolagem',
    emptyDescription: 'Selecione um destino para visualizar o mapa interativo e explorar previsões meteorológicas detalhadas.',
    
    // Result Panel
    selectedLocation: 'Localização selecionada',
    query: 'Consulta',
    openInMaps: 'Abrir no Google Maps ↗',
    mapUnavailable: 'Mapa indisponível. Use o link acima.',
    
    // Weather Panel
    weatherTitle: 'Condições atmosféricas',
    weatherDescription: 'Revise a previsão baseada em NASA POWER para {location} e ajuste o nível de detalhe conforme necessário.',
    selectedLocationWeather: 'a localização selecionada',
    
    // Weather Form
    forecastMode: 'Modo de previsão',
    singleMoment: 'Momento único',
    continuousRange: 'Intervalo contínuo',
    date: 'Data',
    hour: 'Hora',
    optional: 'Opcional',
    startDate: 'Data inicial',
    endDate: 'Data final',
    granularity: 'Granularidade',
    daily: 'Diária',
    hourly: 'Horária',
    startHour: 'Hora inicial',
    endHour: 'Hora final',
    loadWeather: 'Carregar clima',
    loading: 'Carregando',
    generatingPrediction: 'Gerando previsão',
    selectDates: 'Selecionar datas',
    repeatSelection: 'Seleção repetida',
    clearSelection: 'Limpar seleção',
    done: 'Concluir',
    clickAgainToRemove: 'Clique em um dia novamente para removê-lo (exceto o primeiro).',
    
    // Weather Info
    temperatureTitle: 'Temperatura',
    temperatureAt2m: 'Temperatura a 2 metros',
    windTitle: 'Vento',
    windSpeed: 'Velocidade do vento a 10 metros',
    precipitationTitle: 'Precipitação',
    precipitationAmount: 'Volume de precipitação',
    dailyData: 'Dados diários',
    hourlyData: 'Dados horários',
    
    // Units
    celsius: '°C',
    metersPerSecond: 'm/s',
    millimeters: 'mm',
    
    // Errors
    errorLoadingWeather: 'Erro ao carregar dados meteorológicos. Por favor, tente novamente.',
    invalidDateRange: 'A data final deve ser posterior à data inicial.',
    invalidHourRange: 'A hora final deve ser posterior ou igual à hora inicial.',
    selectAtLeastOneDate: 'Selecione pelo menos uma data válida.',
    couldNotRetrieveData: 'Não foi possível recuperar os dados meteorológicos.',
    hourMustBeProvided: 'deve ser informada.',
    hourMustBeInteger: 'deve ser um número inteiro entre 0 e 23.',
    selectedHour: 'Hora selecionada',
    
    // Data Source
    dataSources: 'Fontes de dados: Google Maps Platform · NASA POWER',
    
    // Language Selector
    language: 'Idioma',
    
    // Month names
    months: ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
    monthsShort: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
    
    // AI Prediction
    aiPredictionDescription: 'Dados preditos usando modelos de machine learning treinados com 6 anos de dados históricos',
    aiGeneratedPrediction: 'Previsão gerada por IA',
    model: 'Modelo',
    trainingData: 'Dados de treino',
    days: 'dias',
    downloadPdfReport: 'Baixar Relatório em PDF',
    pdfError: 'Erro ao gerar PDF. Por favor, tente novamente.',
    accuracy: 'acurácia',
    period: 'Período',
    high: 'Máxima',
    low: 'Mínima',
    wind10m: 'Vento a 10 m',
    precipitation: 'Precipitação',
    temperature: 'Temperatura',
    wind: 'Vento',
    variationAcrossRange: 'Variação ao longo do intervalo selecionado',
    exploreEvolution: 'Explore como temperatura, vento e precipitação evoluem hora a hora.',
    selectedDay: 'Dia selecionado',
    
    // Weather descriptions
    extremeHeat: 'Calor extremo à frente—priorize sombra e hidratação.',
    highTemp: 'Altas temperaturas esperadas—programe pausas para resfriamento.',
    coolTemp: 'Condições frescas—considere uma camada extra.',
    comfortableTemp: 'Temperaturas confortáveis para atividades ao ar livre.',
    strongWind: 'Rajadas fortes—proteja itens soltos e fique atento.',
    moderateWind: 'Vento moderado constante pode atrapalhar planos ao ar livre.',
    calmWind: 'Quase nenhum vento, condições de sensação térmica estáveis.',
    lightBreeze: 'Brisa leve contribuindo para o conforto térmico.',
    heavyRain: 'Chuva significativa provável—planeje abrigo ou equipamento de chuva.',
    lightRain: 'Chuva leve ou garoa possível—leve um guarda-chuva.',
    briefDrizzle: 'Pequena chance de garoa breve—fique de olho no céu.',
    noRain: 'Sem chuva esperada para este período.',
    
    // Chart insights
    notEnoughData: 'Dados insuficientes para a janela selecionada.',
    sharpHeatSpikes: 'Picos agudos de calor ({max}°C)—evite horários de pico de exposição.',
    highTempAverage: 'Altas temperaturas, com média de {avg}°C ao longo do período.',
    tempRange: 'Temperaturas permanecem entre {min}°C e {max}°C.',
    windPeaks: 'Vento atinge pico de {max} m/s—atenção às rajadas.',
    moderateWindAvg: 'Vento moderado predomina (média {avg} m/s).',
    gentleWind: 'Vento suave permanece abaixo de {max} m/s.',
    heavyRainPeaks: 'Chuva forte com picos de {max} mm/h—planeje cobertura.',
    lightRainFluc: 'Flutuações de chuva leve (média {avg} mm/h).',
    dryWindow: 'Janela seca sem precipitação registrada.',
    occasionalDrizzle: 'Garoa ocasional soma {total} mm ao longo da janela.',
    
    // Overall insights
    slot: 'intervalo',
    slots: 'intervalos',
    entry: 'entrada',
    entries: 'entradas',
    intenseHeat: '{count} {unit} de calor intenso—planeje pausas na sombra.',
    comfortableRange: 'Temperaturas permanecem em uma faixa confortável na maior parte do tempo.',
    rainWarning: 'Chuva aparece em {count} {unit}—leve capa de chuva ou guarda-chuva.',
    noMeaningfulRain: 'Nenhum sinal significativo de chuva durante o período analisado.',
    gustyConditions: 'Condições de rajadas em {count} {unit}—tome cuidado extra ao ar livre.',
    calmWinds: 'Ventos calmos predominam, mantendo a sensação térmica estável.',
  },
};

export function useTranslation(locale) {
  return translations[locale] || translations.en;
}
