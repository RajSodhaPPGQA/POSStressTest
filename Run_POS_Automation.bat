@echo off
:: Run POS automation script
cd /d "%~dp0"

:: Auto-open dashboard only when enabled in config.json
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-Content -Raw -Path 'config.json' | ConvertFrom-Json; if ($c.liveDashboardEnabled -eq $true) { 'true' } else { 'false' }"`) do set "LIVE_DASH=%%A"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-Content -Raw -Path 'config.json' | ConvertFrom-Json; if ($c.liveDashboardPort) { $c.liveDashboardPort } else { 5050 }"`) do set "LIVE_PORT=%%A"

if /I "%LIVE_DASH%"=="true" (
	start "POS Live Dashboard" "http://127.0.0.1:%LIVE_PORT%"
)

node test.js
pause