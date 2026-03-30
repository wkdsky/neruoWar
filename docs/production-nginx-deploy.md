# NeuroWar 单端口公网部署

目标：
- 外网统一通过 `http://47.121.137.149:8088` 访问
- `nginx` 监听 `8088`
- 前端由 `nginx` 直接提供静态文件
- 后端仅监听本机 `127.0.0.1:5001`
- `nginx` 反代 `/api`、`/socket.io`、`/uploads`

说明：
- 当前机器的 `80` 已被现有站点占用，因此这套配置避开 `80`，单独使用 `8088`

## 后端生产环境

复制模板：

```bash
cp deploy/env/backend.production.env.example backend/.env.production
```

至少确认这些值：

```env
PORT=5001
BIND_HOST=127.0.0.1
PUBLIC_ORIGIN=http://47.121.137.149:8088
FRONTEND_ORIGIN=http://47.121.137.149:8088
CORS_ORIGINS=http://47.121.137.149:8088
SOCKET_CORS_ORIGINS=http://47.121.137.149:8088
NODE_ENV=production
JWT_SECRET=替换成强密码
```

## 启动应用

```bash
chmod +x deploy/start-production.sh
BACKEND_ENV_FILE=/home/wkd/neruoWar/backend/.env.production ./deploy/start-production.sh
```

这个脚本会：
- 构建前端生产包
- 用 `pm2` 启动后端

## nginx 配置

复制配置：

```bash
sudo /home/wkd/neruoWar/deploy/install-nginx-site.sh
```

这个脚本会：
- 复制 `deploy/nginx/neurowar.conf` 到 `/etc/nginx/conf.d/neurowar.conf`
- 执行 `nginx -t`
- 自动 `reload nginx`

当前模板额外包含：
- `gzip` 压缩，降低首屏 JS/CSS 传输体积
- `static/*` 长缓存（带 hash 文件名，适合 `immutable`）
- `index.html` 禁缓存，确保每次能拿到最新入口

## 云端放行

除了 SSH 端口，还需要放行：

```text
8088/tcp
```

后端 `5001` 不建议对公网开放，因为这里只让 `nginx` 在本机访问它。

## 最终访问

浏览器直接打开：

```text
http://47.121.137.149:8088
```

如果你的公网入口是 `frp` 映射出来的 `38088 -> 本机 8088`，那么仍然保持本机 `nginx` 监听 `8088` 即可，外网访问改为：

```text
http://47.121.137.149:38088
```

## 可选：HTTPS

如果后续换成域名，可以继续保留这套结构，再给 `nginx` 加 `443` 和证书即可。
