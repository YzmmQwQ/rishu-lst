# ---- 阶段 1: 安装依赖 ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

# ---- 阶段 2: 构建 ----
FROM deps AS build
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/
RUN npm run build -w packages/shared
RUN npm run build -w packages/server
RUN npm run build -w packages/client

# ---- 阶段 3: 生产镜像 ----
FROM node:22-alpine AS production
WORKDIR /app

# 复制所有 workspace 包的 package.json（npm workspace 需要完整结构）
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# 安装全工作区生产依赖（--omit=dev 跳过 devDependencies）
RUN npm ci --omit=dev

# 复制构建产物
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist

# 生产环境：将 shared 的 exports 从 src(TS) 切换到 dist(JS)
RUN sed -i 's|./src/index.ts|./dist/index.js|g' packages/shared/package.json

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "packages/server/dist/index.js"]
