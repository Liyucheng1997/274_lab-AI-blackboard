#!/usr/bin/env bash
# 服务器端发布入口,安装在 /usr/local/bin/deploy-board。
# GitHub Actions 的部署密钥在 authorized_keys 中被强制只能运行本脚本:
# 把 /opt/apps/board 快进到 GitHub 上的 main → 校验 → 重启服务。
set -euo pipefail
APP=/opt/apps/board
cd "$APP"
git fetch --quiet origin main
git merge --ff-only origin/main
node --check server.js
sudo systemctl restart app-board
sleep 1
systemctl is-active app-board
curl -fsS http://127.0.0.1:4275/api/health
echo
echo "发布完成: $(git log --oneline -1)  $(date '+%F %T')"
