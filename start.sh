#!/bin/bash

echo "========================================="
echo "启动 NeuroWar 游戏系统"
echo "========================================="

# 检查 MongoDB
echo "检查 MongoDB 状态..."
sudo systemctl status mongod | grep "Active: active" > /dev/null
if [ $? -ne 0 ]; then
    echo "启动 MongoDB..."
    sudo systemctl start mongod
    sleep 3
fi

# 安装 PM2（如果未安装）
if ! command -v pm2 &> /dev/null; then
    echo "安装 PM2..."
    sudo npm install -g pm2
fi

# 启动后端
echo "启动后端服务..."
cd /home/wkd/neruoWar/backend
pm2 stop neurowar-backend 2>/dev/null
pm2 delete neurowar-backend 2>/dev/null
pm2 start server.js --name neurowar-backend

# 等待后端启动
sleep 3

# 启动前端
echo "启动前端服务..."
cd /home/wkd/neruoWar/frontend
pm2 stop neurowar-frontend 2>/dev/null
pm2 delete neurowar-frontend 2>/dev/null
pm2 start npm --name neurowar-frontend -- start

# 显示状态
echo "========================================="
pm2 list
echo "========================================="
echo "后端服务: http://localhost:5000"
echo "前端服务: http://localhost:3000"
echo "========================================="
echo "查看日志:"
echo "  后端: pm2 logs neurowar-backend"
echo "  前端: pm2 logs neurowar-frontend"
echo "========================================="