"""
Quick test to verify AI prediction works for today's date
"""
import asyncio
from datetime import datetime
from app.power_client import fetch_power_weather


async def test_today():
    today = datetime.now().strftime("%Y%m%d")
    
    print(f"🧪 Testing AI Prediction for TODAY: {today}")
    print("=" * 60)
    
    try:
        result = await fetch_power_weather(
            latitude=-7.12,
            longitude=-34.86,
            start=today,
            end=today
        )
        
        print(f"✅ SUCCESS!")
        print(f"   Granularity: {result.granularity}")
        print(f"   Records: {len(result.records)}")
        print(f"   Has AI Prediction: {result.ai_prediction is not None}")
        
        if result.ai_prediction:
            print(f"\n🤖 AI PREDICTION ACTIVE!")
            print(f"   Source: {result.meta.get('source', 'Unknown')}")
            
            chosen = result.ai_prediction.get('chosen', {})
            for var, info in chosen.items():
                print(f"   {var}: {info['value']:.2f} (Model: {info['best_model']}, RMSE: {info['RMSE']:.2f})")
        else:
            print(f"\n📊 NORMAL DATA (NASA POWER):")
            for record in result.records:
                print(f"   T2M: {record.t2m}, Precip: {record.precip_mm}")
        
        print("\n" + "=" * 60)
        
    except Exception as e:
        print(f"❌ ERROR: {e}")


if __name__ == "__main__":
    asyncio.run(test_today())
