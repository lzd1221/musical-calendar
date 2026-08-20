@echo off
rem 启动音乐剧网页版（本地爬虫服务，端口 8878，占用时自动顺延）
cd /d "%~dp0.."
start "" cmd /c "timeout /t 2 >nul && start http://localhost:8878"
node web-version/server.js
pause
