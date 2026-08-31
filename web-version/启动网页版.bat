@echo off
rem 启动音乐剧网页版（本地爬虫服务，端口 8878，占用时自动顺延）
rem 若浏览器没有自动弹出，或 8878 打不开，请看本窗口打印的"本地访问"地址
cd /d "%~dp0.."
start "" cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:8878"
node web-version/server.js
pause
