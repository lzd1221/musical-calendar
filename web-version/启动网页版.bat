@echo off
rem 启动音乐剧网页版（本地爬虫服务）
cd /d "%~dp0.."
start "" cmd /c "timeout /t 2 >nul && start http://localhost:8765"
node web-version/server.js
pause
