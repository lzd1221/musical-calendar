#!/usr/bin/env bash
# ============================================================
# 音乐剧排期&抢票日历 · 网页版 服务器一键部署脚本
# 适用：Ubuntu 20.04 / 22.04 / 24.04（Debian 亦兼容）
# 用法：以 root 或 sudo 执行
#   sudo bash deploy.sh
# 部署后访问：http://<服务器IP>:8878
# ============================================================
set -euo pipefail

PORT="${PORT:-8878}"
APP_USER="musical"
APP_DIR="/opt/musical-calendar"
REPO_URL="https://github.com/lzd1221/musical-calendar.git"

echo "==> [1/6] 更新系统并安装依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates

echo "==> [2/6] 安装 Node.js 18+（NodeSource 官方源）"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    Node $(node -v), npm $(npm -v)"

echo "==> [3/6] 创建运行用户（非 root 运行服务，更安全）"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"

echo "==> [4/6] 拉取代码（公开仓库，无需凭据）"
rm -rf "$APP_DIR"
git clone --depth 1 "$REPO_URL" "$APP_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> [5/6] 注册 systemd 服务（开机自启 + 崩溃自动重启）"
cat > /etc/systemd/system/musical-web.service <<EOF
[Unit]
Description=Musical Calendar Web (music schedule & ticket)
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/web-version
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=5
Environment=PORT=$PORT

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable musical-web.service
systemctl restart musical-web.service

echo "==> [6/6] 放行防火墙端口 $PORT"
if command -v ufw >/dev/null 2>&1; then
  ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
  echo "    (ufw 已放行 $PORT；如需启用 ufw 请手动执行: ufw enable)"
fi

echo ""
echo "=============================================================="
echo " ✅ 部署完成！"
echo "    访问地址:  http://<你的服务器IP>:$PORT"
echo ""
echo " 常用命令:"
echo "    sudo systemctl status musical-web     # 查看服务状态"
echo "    sudo journalctl -u musical-web -f     # 实时查看日志"
echo "    sudo systemctl restart musical-web    # 重启服务"
echo ""
echo " 可选配置（提高抓取成功率）:"
echo "    编辑 $APP_DIR/web-version/sources/config.js 的 COOKIE 字段"
echo "    然后: sudo systemctl restart musical-web"
echo "=============================================================="
