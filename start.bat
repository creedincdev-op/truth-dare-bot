@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo [INFO] Created .env from .env.example
  echo [ACTION] Fill DISCORD_TOKEN and DISCORD_CLIENT_ID in .env, then run start.bat again.
  goto :end
)

if not exist "node_modules" (
  echo Installing Node dependencies...
  npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    goto :end
  )
)

if exist "data\render_runtime_state.json" (
  del /q "data\render_runtime_state.json" >nul 2>nul
)

echo Starting Truth or Dare bot...
npm start

:end
if errorlevel 1 (
  echo Bot stopped with an error.
)

echo.
pause
