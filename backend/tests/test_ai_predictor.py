"""
Tests for AI Weather Prediction feature
"""
import pytest
from datetime import datetime, timedelta
from app.ai_predictor import predict_day


@pytest.mark.asyncio
async def test_predict_day_basic():
    """Test basic AI prediction for a future date"""
    # Predict for 10 days from now
    future_date = (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d")
    
    result = await predict_day(
        lat=-7.12,
        lon=-34.86,
        date_str=future_date,
        years_back=3,  # Use less years for faster testing
        variables=["T2M", "PRECTOTCORR"]
    )
    
    # Check structure
    assert "input" in result
    assert "ai_models" in result
    assert result["input"]["latitude"] == -7.12
    assert result["input"]["longitude"] == -34.86
    
    # Check AI models data
    ai_data = result["ai_models"]
    assert "metrics" in ai_data
    assert "predictions" in ai_data
    assert "chosen" in ai_data
    
    # Check T2M predictions
    assert "T2M" in ai_data["predictions"]
    assert "SARIMAX" in ai_data["predictions"]["T2M"]
    assert "GradientBoosting" in ai_data["predictions"]["T2M"]
    assert "RandomForest" in ai_data["predictions"]["T2M"]
    
    # Check chosen model
    assert "T2M" in ai_data["chosen"]
    chosen_t2m = ai_data["chosen"]["T2M"]
    assert "best_model" in chosen_t2m
    assert "value" in chosen_t2m
    assert "RMSE" in chosen_t2m
    assert "MAE" in chosen_t2m
    
    # Verify best model has lowest RMSE
    t2m_metrics = ai_data["metrics"]["T2M"]
    best_model = chosen_t2m["best_model"]
    best_rmse = chosen_t2m["RMSE"]
    
    for model_name, metrics in t2m_metrics.items():
        assert metrics["RMSE"] >= best_rmse, f"{model_name} should have RMSE >= {best_rmse}"
    
    print(f"\n✅ Prediction for {future_date}:")
    print(f"   T2M: {chosen_t2m['value']:.1f}°C (Model: {chosen_t2m['best_model']}, RMSE: {chosen_t2m['RMSE']:.2f})")


@pytest.mark.asyncio
async def test_predict_day_all_variables():
    """Test AI prediction with all variables"""
    future_date = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
    
    result = await predict_day(
        lat=40.7128,  # New York
        lon=-74.0060,
        date_str=future_date,
        years_back=2,
        variables=["T2M", "T2M_MAX", "T2M_MIN", "WS10M", "PRECTOTCORR"]
    )
    
    ai_data = result["ai_models"]
    expected_vars = ["T2M", "T2M_MAX", "T2M_MIN", "WS10M", "PRECTOTCORR"]
    
    for var in expected_vars:
        assert var in ai_data["chosen"], f"{var} should be in chosen models"
        assert var in ai_data["predictions"], f"{var} should have predictions"
        assert var in ai_data["metrics"], f"{var} should have metrics"
        
        # Check all 3 models made predictions
        assert "SARIMAX" in ai_data["predictions"][var]
        assert "GradientBoosting" in ai_data["predictions"][var]
        assert "RandomForest" in ai_data["predictions"][var]
    
    print(f"\n✅ All variables predicted successfully for {future_date}")
    for var in expected_vars:
        chosen = ai_data["chosen"][var]
        print(f"   {var}: {chosen['value']:.2f} ({chosen['best_model']}, RMSE: {chosen['RMSE']:.2f})")


@pytest.mark.asyncio
async def test_model_metrics_validity():
    """Test that model metrics are valid numbers"""
    future_date = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")
    
    result = await predict_day(
        lat=-23.5505,  # São Paulo
        lon=-46.6333,
        date_str=future_date,
        years_back=2,
        variables=["T2M", "PRECTOTCORR"]
    )
    
    ai_data = result["ai_models"]
    
    for var in ["T2M", "PRECTOTCORR"]:
        for model in ["SARIMAX", "GradientBoosting", "RandomForest"]:
            metrics = ai_data["metrics"][var][model]
            
            # Check MAE and RMSE are valid positive numbers
            assert "MAE" in metrics
            assert "RMSE" in metrics
            assert isinstance(metrics["MAE"], (int, float))
            assert isinstance(metrics["RMSE"], (int, float))
            assert metrics["MAE"] >= 0
            assert metrics["RMSE"] >= 0
            
            # Check prediction is a valid number
            prediction = ai_data["predictions"][var][model]
            assert isinstance(prediction, (int, float))
            assert not (prediction == float('inf') or prediction == float('-inf'))
    
    print(f"\n✅ All metrics are valid numbers")


@pytest.mark.asyncio
async def test_chosen_model_consistency():
    """Test that chosen model value matches the prediction from that model"""
    future_date = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")
    
    result = await predict_day(
        lat=51.5074,  # London
        lon=-0.1278,
        date_str=future_date,
        years_back=2,
        variables=["T2M"]
    )
    
    ai_data = result["ai_models"]
    chosen_t2m = ai_data["chosen"]["T2M"]
    
    # The chosen value should match the prediction from the best model
    best_model = chosen_t2m["best_model"]
    expected_value = ai_data["predictions"]["T2M"][best_model]
    actual_value = chosen_t2m["value"]
    
    assert expected_value == actual_value, \
        f"Chosen value {actual_value} should match {best_model} prediction {expected_value}"
    
    print(f"\n✅ Chosen model consistency verified")
    print(f"   Best model: {best_model}")
    print(f"   Predicted value: {actual_value:.2f}°C")


if __name__ == "__main__":
    import asyncio
    
    print("🧪 Running AI Prediction Tests...\n")
    
    async def run_all_tests():
        print("=" * 60)
        print("TEST 1: Basic Prediction")
        print("=" * 60)
        await test_predict_day_basic()
        
        print("\n" + "=" * 60)
        print("TEST 2: All Variables")
        print("=" * 60)
        await test_predict_day_all_variables()
        
        print("\n" + "=" * 60)
        print("TEST 3: Metrics Validity")
        print("=" * 60)
        await test_model_metrics_validity()
        
        print("\n" + "=" * 60)
        print("TEST 4: Chosen Model Consistency")
        print("=" * 60)
        await test_chosen_model_consistency()
        
        print("\n" + "=" * 60)
        print("✨ ALL TESTS PASSED!")
        print("=" * 60)
    
    asyncio.run(run_all_tests())
