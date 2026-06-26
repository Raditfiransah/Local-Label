#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    echo "Stopping all services..."
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null && echo "  Backend stopped."
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null && echo "  Frontend stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "============================================"
echo "  Auto Labeler - Starting Web Services"
echo "============================================"
echo ""

# Check Python venv
if [ ! -f "$DIR/backend/venv/bin/python" ]; then
    echo "[ERROR] Python venv not found at backend/venv/"
    echo "        Run: python3 -m venv backend/venv"
    exit 1
fi

# Check node_modules
if [ ! -d "$DIR/frontend/node_modules" ]; then
    echo "[INFO] Installing frontend dependencies..."
    cd "$DIR/frontend"
    npm install
    cd "$DIR"
fi

# Start Backend
echo "[1/3] Starting Backend (FastAPI) on port 8000..."
cd "$DIR/backend"
source venv/bin/activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd "$DIR"

# Wait for backend to initialize
sleep 3

# Start Frontend
echo "[2/3] Starting Frontend (Vite) on port 5173..."
cd "$DIR/frontend"
npx vite --host --port 5173 &
FRONTEND_PID=$!
cd "$DIR"

# Open browser
echo "[3/3] Opening browser..."
sleep 5
if command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:5173
elif command -v open &>/dev/null; then
    open http://localhost:5173
fi

echo ""
echo "============================================"
echo "  Auto Labeler is running!"
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "============================================"
echo ""
echo "Press Ctrl+C to stop all services."

wait
