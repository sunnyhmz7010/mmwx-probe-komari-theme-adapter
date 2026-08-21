<div align="center">
  <h1>MMWX Probe Komari Theme Adapter</h1>
  <p>将 MMWX 探针数据适配为可运行 Komari 主题的容器服务。</p>
</div>

<p align="center">
  <a href="https://github.com/sunnyhmz7010/mmwx-probe-komari-theme-adapter/releases"><img src="https://img.shields.io/github/v/release/sunnyhmz7010/mmwx-probe-komari-theme-adapter?label=Release&color=3b82f6" alt="Release" /></a>
  <a href="https://github.com/sunnyhmz7010/mmwx-probe-komari-theme-adapter/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sunnyhmz7010/mmwx-probe-komari-theme-adapter?color=10b981" alt="License" /></a>
  <a href="https://github.com/sunnyhmz7010/mmwx-probe-komari-theme-adapter/actions/workflows/docker.yml"><img src="https://img.shields.io/github/actions/workflow/status/sunnyhmz7010/mmwx-probe-komari-theme-adapter/docker.yml?branch=main&label=Docker" alt="Docker" /></a>
  <a href="https://github.com/sunnyhmz7010/mmwx-probe-komari-theme-adapter/pkgs/container/mmwx-probe-komari-theme-adapter"><img src="https://img.shields.io/badge/GHCR-mmwx--probe--komari--theme--adapter-0f172a" alt="GHCR" /></a>
</p>

---

## ✨ 为什么做这个项目

MMWX independent-probe 已经能提供节点状态和历史数据，但很多现成的 Komari 主题依赖 Komari 的公开 API 和 WebSocket 路径。这个适配器在容器启动时拉取并构建指定 Komari 主题，同时把 MMWX 探针接口映射成只读的 Komari 兼容接口，让主题可以直接复用而不需要改主题源码。

## 🚀 核心能力

- Komari 主题运行时构建：启动时拉取 GitHub 主题仓库，自动识别静态主题或包构建产物
- MMWX 数据适配：把 independent-probe 数据映射为 Komari 风格节点、实时状态、Ping 和负载历史
- 只读兼容边界：提供公开 API 和 WebSocket 兼容路径，明确拒绝登录、管理、修改类接口
- 安全配置校验：生产环境强制 `MMWX_ORIGIN` 使用 HTTPS，探针 Token 仅转发给 MMWX
- 容器化部署：提供 GitHub Container Registry 镜像和 Docker Compose 示例
- 持久化主题产物：挂载 `/data` 后，构建完成的主题可跨容器重启保留

## ⚡ 快速开始

### 📋 前置要求

- 一台能访问 MMWX 控制端和 GitHub 的服务器、NAS 或本地 Docker 环境
- Docker 与 Docker Compose
- MMWX independent-probe 可用的控制端地址和 `PROBE_TOKEN`
- 一个可公开拉取的 Komari 主题 GitHub 仓库

### 📦 Docker Compose（推荐）

新建 `docker-compose.yml`：

```yaml
services:
  mmwx-komari-adapter:
    image: ghcr.io/sunnyhmz7010/mmwx-probe-komari-theme-adapter:latest
    container_name: mmwx-komari-adapter
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - MMWX_ORIGIN=https://panel.example.com
      - PROBE_TOKEN=replace-with-probe-token
      - THEME_REPO=https://github.com/stqfdyr/komari-theme-adhesive-note
      - THEME_REF=main
      - PORT=8080
      - CACHE_TTL=5
    volumes:
      - theme-data:/data

volumes:
  theme-data:
```

启动服务：

```bash
docker compose up -d
docker compose logs -f
```

访问 `http://localhost:8080` 查看主题页面。

### 🏷️ 镜像标签

GitHub Actions 会把镜像推送到 `ghcr.io/sunnyhmz7010/mmwx-probe-komari-theme-adapter`。`main` 分支生成 `main` 和 `sha-*` 标签；推送 `v*` 标签时生成 `0.1.0`、`0.1`、`0` 和 `latest` 这类稳定标签。

```bash
docker pull ghcr.io/sunnyhmz7010/mmwx-probe-komari-theme-adapter:latest
```

### 🖥️ Docker Run

```bash
docker run -d \
  --name mmwx-komari-adapter \
  --restart unless-stopped \
  -p 8080:8080 \
  -e MMWX_ORIGIN="https://panel.example.com" \
  -e PROBE_TOKEN="replace-with-probe-token" \
  -e THEME_REPO="https://github.com/stqfdyr/komari-theme-adhesive-note" \
  -e THEME_REF="main" \
  -e PORT=8080 \
  -e CACHE_TTL=5 \
  -v mmwx-komari-theme-data:/data \
  ghcr.io/sunnyhmz7010/mmwx-probe-komari-theme-adapter:latest
```

### 🛠️ 自行构建镜像

```bash
git clone https://github.com/sunnyhmz7010/mmwx-probe-komari-theme-adapter.git
cd mmwx-probe-komari-theme-adapter
docker build -t mmwx-komari-adapter .
docker run -d \
  --name mmwx-komari-adapter \
  --restart unless-stopped \
  -p 8080:8080 \
  --env-file .env.example \
  -v mmwx-komari-theme-data:/data \
  mmwx-komari-adapter
```

## 📖 使用说明

### 📋 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `MMWX_ORIGIN` | 是 | - | MMWX 控制端地址。生产环境必须使用 HTTPS；仅 `localhost` 和 `127.0.0.1` 允许 HTTP |
| `PROBE_TOKEN` | 是 | - | MMWX independent-probe Token，仅作为 `X-MMwx-Probe-Token` 转发给 MMWX |
| `THEME_REPO` | 是 | - | Komari 主题 GitHub HTTPS 仓库地址，例如 `https://github.com/stqfdyr/komari-theme-adhesive-note` |
| `THEME_REF` | 否 | `main` | 主题仓库分支、标签或 commit。生产环境建议固定到 tag 或 commit |
| `THEME_BUILD` | 否 | - | 自定义主题构建命令；未设置时使用主题仓库 `package.json` 中的 `build` 脚本 |
| `PORT` | 否 | `8080` | 容器内 HTTP 监听端口 |
| `CACHE_TTL` | 否 | `5` | MMWX 探针数据缓存时间，单位秒 |
| `DATA_DIR` | 否 | `/data` | 主题构建产物和运行数据目录，容器部署时建议挂载持久化卷 |

### 📡 接口兼容边界

已实现的公开只读接口：

- `GET /api/nodes`
- `GET /api/public`
- `GET /api/me`
- `GET /api/records/ping`
- `GET /api/records/load`
- `POST /api/rpc2`
- `GET /api/rpc2` WebSocket
- `GET /api/clients` WebSocket
- `GET /api/stream` WebSocket proxy

已支持的只读 RPC2 方法：

- `rpc.ping`
- `public:getNodesInformation`
- `public:getPublicSettings`
- `common:getNodesLatestStatus`
- `public:getClientRecentRecords`
- `public:getRecordsByUUID`
- `public:getPingRecords`
- `public:queryMetrics`
- `nodes.list`
- `public.nodes`
- `records.ping`
- `records.load`

登录、后台管理、主题管理、节点修改等写操作不在兼容范围内。

### 📜 日志与数据持久化

```bash
docker compose logs -f
```

容器内 `/data` 用于保存当前构建完成的主题目录。建议始终挂载 Docker volume，避免容器重建后重复拉取和构建主题。

## 🧠 功能细节

- 主题加载流程：校验 `THEME_REPO` 和 `THEME_REF` 后克隆仓库，优先识别根目录静态 `index.html`，否则按锁文件选择包管理器并执行构建
- 包管理器优先级：`pnpm-lock.yaml`、`bun.lock` / `bun.lockb`、`package-lock.json`
- 构建隔离：主题构建使用 `CI=true`，不会把 `PROBE_TOKEN` 等敏感环境变量传入主题构建进程
- 输出校验：构建产物必须包含 `index.html`，并通过路径包含性和符号链接检查防止目录逃逸
- 数据缓存：MMWX 探针快照按 `CACHE_TTL` 短缓存，降低主题高频刷新对上游的压力
- WebSocket 兼容：为常见 Komari 主题保留 `/api/rpc2`、`/api/clients`、`/api/stream` 三类实时路径

## 🧱 技术栈

- TypeScript：ESM 项目，使用 `tsc` 编译
- Node.js：运行镜像基于 `node:22-bookworm-slim`
- ws：WebSocket 客户端与服务端兼容层
- Docker：多阶段构建，运行阶段使用非 root 用户
- 目标平台：Docker、Docker Compose、GitHub Container Registry

## 🗂️ 项目结构

```
mmwx-probe-komari-theme-adapter/
├── src/                         # TypeScript 源码
│   ├── main.ts                  # 服务入口、启动和关闭生命周期
│   ├── config.ts                # 环境变量解析与安全校验
│   ├── http/                    # HTTP、静态资源和 API 路由
│   ├── komari/                  # Komari 数据映射和服务层
│   ├── mmwx/                    # MMWX independent-probe 客户端
│   └── theme/                   # 主题仓库加载、构建和发布
├── test/                        # node:test 单元与兼容性测试
├── .github/                     # GitHub Actions 与 Issue 模板
├── .env.example                 # 环境变量示例
├── Dockerfile                   # 容器镜像定义
├── docker-compose.yml           # GHCR 镜像部署示例
├── package.json                 # npm 脚本与依赖声明
└── tsconfig.json                # TypeScript 编译配置
```

## 👨‍💻 本地开发

### 🧰 环境

- Node.js 22+
- npm
- Docker（仅构建或本地容器验证时需要）

### ⚙️ 命令

```bash
npm install
npm run build
npm test
docker build -t mmwx-komari-adapter .
```

## 🔐 安全报告

如果发现安全问题，请不要公开披露细节。请优先参考仓库中的 [SECURITY.md](./SECURITY.md) 提交安全报告。

## 📄 许可证

本项目基于 [GPL-3.0](./LICENSE) 开源。

<div align="center">
  <sub>Built with ❤️ by Sunny</sub>
</div>
