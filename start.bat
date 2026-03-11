@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found in PATH.
  goto :end
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo [INFO] Created .env from .env.example
  echo [ACTION] Fill DISCORD_TOKEN in .env, then run start.bat again.
  goto :end
)

echo Installing Python dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] pip install failed.
  goto :end
)

echo Starting Truth or Dare bot...
python render_start.py

:end
if errorlevel 1 (
  echo Bot stopped with an error.
)

echo.
pause
