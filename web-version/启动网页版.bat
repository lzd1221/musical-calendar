@echo off
rem Start local web server (port 8878, auto-increment if occupied)
rem If browser does not open, see the printed localhost URL in this window
chcp 65001 >nul
cd /d "%~dp0.."
start "" cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:8878"
node web-version/server.js
pause
