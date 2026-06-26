@echo off
title Auto Labeler Web
cd /d "%~dp0"

echo ============================================
echo   Auto Labeler - Starting Web Services
echo ============================================
echo.

:: Check Python venv
if not exist "backend\venv\Scripts\python.exe" (
    echo [ERROR] Python venv not found at backend\venv\
    echo         Run: python -m venv backend\venv
    pause
    exit /b 1
)

:: Check node_modules
if not exist "frontend\node_modules" (
    echo [INFO] Installing frontend dependencies...
    cd /d "%~dp0frontend"
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)

:: Start Backend
echo [1/3] Starting Backend (FastAPI) on port 8000...
start "AutoLabeler-Backend" /min cmd /c "cd /d "%~dp0backend" && .\venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

:: Wait a moment for backend to initialize
timeout /t 3 /nobreak >nul

:: Start Frontend
echo [2/3] Starting Frontend (Vite) on port 5173...
start "AutoLabeler-Frontend" /min cmd /c "cd /d "%~dp0frontend" && npx vite --host --port 5173"

:: Open browser
echo [3/3] Opening browser...
timeout /t 5 /nobreak >nul
start http://localhost:5173

echo.
echo ============================================
echo   Auto Labeler is running!
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:5173
echo ============================================
echo.
echo  Close this window to stop all services.
echo  (Or use Task Manager to kill the processes)
echo.
pause
