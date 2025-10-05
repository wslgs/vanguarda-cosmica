#!/usr/bin/env python3
"""
Teste da API com previsão de IA
Mostra como os dados de acurácia são retornados
"""

import asyncio
import json
from app.power_client import fetch_power_weather

async def test_ai_prediction():
    print("🧪 Testando previsão de IA com acurácia...")
    print("=" * 60)
    
    # Testar com data que vai usar IA (ontem - dados não disponíveis)
    result = await fetch_power_weather(
        latitude=-7.118835199999999,
        longitude=-34.8814339,
        start="20251004",
        end="20251004",
        hour_start=None,
        hour_end=None
    )
    
    # Converter para dict
    data = result.to_dict()
    
    print("\n📊 RESPOSTA DA API:")
    print(json.dumps(data, indent=2, ensure_ascii=False))
    
    print("\n" + "=" * 60)
    print("✅ DADOS PRINCIPAIS:")
    print(f"   Fonte: {data['meta']['source']}")
    print(f"   Granularidade: {data['granularity']}")
    print(f"   Número de registros: {len(data['data'])}")
    
    if data['data']:
        record = data['data'][0]
        print(f"\n📅 REGISTRO: {record['date']}")
        print(f"   🌡️  Temperatura: {record['t2m']}°C")
        print(f"   🌡️  Máxima: {record['t2m_max']}°C")
        print(f"   🌡️  Mínima: {record['t2m_min']}°C")
        print(f"   💨 Vento: {record['ws10m']} m/s")
        print(f"   🌧️  Chuva: {record['precip_mm']} mm")
        
        if 'accuracy' in record:
            print(f"\n🎯 ACURÁCIA:")
            for var, acc in record['accuracy'].items():
                print(f"   {var}: {acc:.1f}%")
    
    if 'ai_prediction' in data and data['ai_prediction']:
        print(f"\n🤖 IA UTILIZADA:")
        chosen = data['ai_prediction'].get('chosen', {})
        for var, info in chosen.items():
            model = info.get('best_model', 'N/A')
            rmse = info.get('RMSE', 0)
            mae = info.get('MAE', 0)
            print(f"   {var}: {model} (RMSE: {rmse:.2f}, MAE: {mae:.2f})")

if __name__ == "__main__":
    asyncio.run(test_ai_prediction())
