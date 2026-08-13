# 部署方案

## 架构

采用**纯 Node.js 单镜像**方案：Express 同时托管前端 SPA 静态文件和后端 API/WebSocket，无需 Nginx。

```
Docker 容器 (:3001)
├── / 静态文件        → client/dist（Vite 产物）
├── /api/*           → REST API
└── /socket.io/*     → WebSocket
```

## CI/CD 流程

1. **push 到 main** → GitHub Actions 构建 Docker 镜像 → 推送到 GHCR（`ghcr.io`）
2. **服务器上** Watchtower 每 5 分钟检查镜像更新 → 自动拉取并重启容器

零人工干预，GitHub 零额外 Secrets（使用自带的 `GITHUB_TOKEN`）。

## Docker 多阶段构建

- **阶段 1（deps）**：`npm ci` 安装全部依赖
- **阶段 2（build）**：分别构建 shared、server（tsc）、client（vite build）
- **阶段 3（production）**：仅安装生产依赖（`npm ci --omit=dev`），复制构建产物

## CORS 策略

- `CLIENT_URL` 未设置 → 自动模式，允许所有来源访问（适用于单镜像同域部署、局域网、公网反代）
- `CLIENT_URL` 显式设置 → 严格白名单模式（适用于前后端分离跨域部署）

## Identity Cookie 策略

- 未显式设置 `IDENTITY_COOKIE_SECURE` 时，服务端会根据当前请求协议自动决定是否添加 `Secure`
- 局域网 HTTP 访问会下发非 Secure cookie
- 公网 HTTPS / 反代 HTTPS 访问会下发 Secure cookie
- 自动判断 HTTPS 依赖代理正确透传 `X-Forwarded-Proto`
- 仅在需要强制行为时才手动设置 `IDENTITY_COOKIE_SECURE`

## 前端同域适配

`SERVER_URL` 默认使用 `window.location.origin`，同域部署时自动指向当前页面的 origin，无需配置。

## 静态文件托管

`packages/server/src/index.ts` 在启动时检测 `client/dist/index.html` 是否存在：

- **存在**（生产环境）：挂载 `express.static` + SPA fallback
- **不存在**（本地开发）：跳过，零影响

## 服务器部署命令

### 前端 Cloudflare Pages + 后端 FRP

前端使用 Cloudflare Pages 时，后端可以通过 FRP 暴露为独立的 HTTPS 域名。仓库根目录提供了 `docker-compose.yml`：

```bash
cp .env.example .env
# 编辑 .env，至少设置 CLIENT_URL 和 IDENTITY_SECRET
docker compose up -d
```

Compose 将容器绑定到服务器本机的 `127.0.0.1:3001`。FRP 客户端应将这个地址作为 `localIP` / `localPort`，例如 `127.0.0.1:3001`。Cloudflare Pages 构建时设置 `VITE_SERVER_URL` 为后端 HTTPS 地址（例如 `https://api.lst.rishu.cfd`）。

若使用仓库 Compose 中的可选 `frpc` 服务，将 Linux `frpc` 二进制放在 `frp/frpc`、配置放在 `frp/frpc.toml`，并执行 `chmod +x frp/frpc`。该服务使用 host network，使 `127.0.0.1:3001` 指向宿主机 API；不支持 host network 的设备应改用宿主机 systemd 管理 FRP。

```bash
# 启动应用容器
docker run -d --name music-together --restart unless-stopped -p 3001:3001 ghcr.io/<owner>/music-together:latest

# 启动 Watchtower 自动更新
docker run -d --name watchtower --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WATCHTOWER_CLEANUP=true \
  containrrr/watchtower --interval 300 music-together
```

如使用 1Panel，创建反向代理网站指向 `127.0.0.1:3001`，启用 WebSocket 和 HTTPS。
