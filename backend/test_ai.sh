#!/bin/bash

echo "🚀 RAIN AI - Quick Test Script"
echo "================================"
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found!"
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    echo "✅ Virtual environment found"
    source venv/bin/activate
fi

echo ""
echo "📦 Python environment:"
python --version
echo ""

echo "🧪 Running AI Prediction Tests..."
echo "================================"
PYTHONPATH=/home/wesll/vanguarda-cosmica/backend python tests/test_ai_predictor.py

echo ""
echo "✨ Test complete!"
echo ""
echo "To start the server, run:"
echo "  source venv/bin/activate"
echo "  uvicorn app.main:app --reload --port 8000"
