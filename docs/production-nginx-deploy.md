# NeuroWar 单端口公网部署

目标：
- 外网统一通过 `http://47.121.137.149:8088` 访问
- `nginx` 监听 `8088`
- 前端由 `nginx` 直接提供静态文件
- 后端监听地址由根目录 `.env` 里的 `BIND_HOST:PORT` 决定
- `nginx` 反代 `/api`、`/socket.io`、`/uploads`

说明：
- 当前机器的 `80` 已被现有站点占用，因此这套配置避开 `80`，单独使用 `8088`

## 统一环境文件

复制模板：

```bash
cp deploy/env/neurowar.env.example .env
```

至少确认这些值：

```env
# 下面只是示例值，不要求固定为 5001
PORT=5001
FRONTEND_PORT=3001
BIND_HOST=127.0.0.1
PUBLIC_HOST=47.121.137.149
PUBLIC_PORT=8088
PUBLIC_SCHEME=http
JWT_SECRET=替换成强密码
```

如果要启用 HTTPS，可以再补：

```env
PUBLIC_SCHEME=https
NGINX_SSL_CERT_PATH=/etc/letsencrypt/live/example/fullchain.pem
NGINX_SSL_KEY_PATH=/etc/letsencrypt/live/example/privkey.pem
```

## 启动应用

```bash
chmod +x deploy/start-production.sh
BACKEND_ENV_FILE=/home/wkd/neruoWar/.env ./deploy/start-production.sh
```

这个脚本会：
- 构建前端生产包
- 用 `pm2` 启动后端

## nginx 配置

复制配置：

```bash
sudo BACKEND_ENV_FILE=/home/wkd/neruoWar/.env /home/wkd/neruoWar/deploy/install-nginx-site.sh
```

这个脚本会：
- 读取根目录 `.env` 里的 `PUBLIC_HOST / PUBLIC_PORT / PUBLIC_SCHEME / PORT / BIND_HOST`
- 渲染 `deploy/nginx/neurowar.conf` 模板到 `/etc/nginx/conf.d/neurowar.conf`
- 执行 `nginx -t`
- 自动 `reload nginx`

当前模板额外包含：
- `gzip` 压缩，降低首屏 JS/CSS 传输体积
- `static/*` 长缓存（带 hash 文件名，适合 `immutable`）
- `index.html` 禁缓存，确保每次能拿到最新入口

## 云端放行

除了 SSH 端口，还需要放行：

```text
PUBLIC_PORT 对应端口，例如 8088/tcp
```

后端 `PORT` 不建议对公网开放，因为这里只让 `nginx` 在本机访问它。

## 最终访问

浏览器直接打开：

```text
http://47.121.137.149:8088
```

如果你的公网入口是 `frp` 映射出来的 `38088 -> 本机 8088`，那么仍然保持本机 `nginx` 监听 `8088` 即可，外网访问改为：

```text
http://47.121.137.149:38088
```

如果没有提前填写 `PUBLIC_HOST / PUBLIC_PORT`：
- `start-nginx.sh` 会先自动探测公网 IP
- 仍无法确定时，会在终端提醒你输入
- 后端生产态还会按反代请求头做同源自适应，避免只因公网 IP/域名没写死而登录失败

## 可选：HTTPS

如果后续换成域名，可以继续保留这套结构，再给 `nginx` 加 `443` 和证书即可。
