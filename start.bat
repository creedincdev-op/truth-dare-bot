@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Truth or Dare bot...
npm start

if errorlevel 1 (
  echo Bot stopped with an error.
)

pause
