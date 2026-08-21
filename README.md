<div align="center">
  <h1>MMWX Probe Komari Theme Adapter</h1>
  <p>用 Docker 暴露妙妙屋 X 探针，并运行 Komari 主题页面。</p>
</div>

<p align="center">
  <a href="https://github.com/sunnyhmz7010/mmwx-probe-komari-theme-adapter/releases"><img src="https://img.shields.io/github/v/release/sunnyhmz7010/mmwx-probe-komari-theme-adapter?label=Release&color=3b82f6" alt="Release" /></a>
  <a href="https://github.com/sunnyhmz7010/mmwx-probe-komari-theme-adapter/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sunnyhmz7010/mmwx-probe-komari-theme-adapter?color=10b981" alt="License" /></a>
</p>

---

## ✨ 为什么做这个项目

妙妙屋 X 主控已经提供独立探针接口，但直接暴露主控域名和访问密钥并不适合公开展示。这个容器把固定的探针接口、WebSocket 实时流和 Komari 主题页面放在同一个对外地址下：访客只访问容器暴露的探针域名，容器再携带 `PROBE_TOKEN` 请求妙妙屋 X 主控。

它适合已经部署支持独立探针访问密钥的妙妙屋 X 主控，又希望用 Docker 快速部署公开探针页面、复用 Komari 主题展示效果的场景。

## 🚀 核心能力

- 固定探针代理：仅代理 `/api/probe`、`/api/series`、`/api/stream` 到妙妙屋 X 主控对应路径，不接受访客指定上游地址
- 独立密钥保护：`PROBE_TOKEN` 只保存在容器环境变量中，浏览器无法读取访问密钥
- Komari 主题复用：启动时拉取并构建指定 Komari 主题，将 MMWX 探针数据映射为主题常用的只读接口
- 历史指标支持：`/api/series` 返回 24 小时延迟、丢包率历史，追加 `metric=system` 获取 CPU、内存、网速和累计流量序列
- 流量字段保留：`/api/probe` 保留 `daily_traffic`、`traffic_used_up`、`traffic_used_down`、`traffic_used_total`、`period_start`、`period_end` 等主控字段
- WebSocket 实时更新：`/api/stream` 代理主控实时探针流，供前端主题获取实时状态
- 轻量容器化：提供 GHCR 多架构镜像和 Docker Compose 示例，运行阶段使用非 root 用户

## ⚡ 快速开始

### 📋 前置要求

- 已部署支持独立探针访问密钥的妙妙屋 X 主控
- 主控具有可由容器访问的 HTTPS 地址
- 已在主控“系统设置 → 探针”中启用探针、选择展示服务器和指标，并生成“独立探针访问密钥”
- 一台能访问妙妙屋 X 主控和 GitHub 的 VPS、NAS 或本地 Docker 环境
- Docker 与 Docker Compose
- 一个可公开拉取的 Komari 主题 GitHub 仓库

密钥明文只显示一次，请立即保存，切勿提交到 Git。生产环境建议在主控确认容器访问正常后，再开启“仅允许独立探针访问”。

### 📦 Docker Compose（推荐）

新建 `compose.yaml`：

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

打开 `http://localhost:8080` 查看 Komari 主题页面。标准探针接口同时位于同一地址下，例如 `http://localhost:8080/api/probe`。

### 🖥️ 命令行方式

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

如果使用 Docker Compose 本地构建，把 `compose.yaml` 中的 `image: ghcr.io/...` 换成 `build: .`，然后执行 `docker compose up -d --build`。

## 📖 使用说明

### 📡 工作方式

```text
浏览器 ──HTTP/WS──> Docker 容器 ──携带 PROBE_TOKEN──> 妙妙屋 X 主控
```

容器只把固定路径代理到主控，不接受访客传入任意上游地址，因此不会形成开放代理。

| 对外路径 | 主控路径 | 用途 |
| --- | --- | --- |
| `/api/probe` | `/api/public/probe-servers` | 服务器状态 |
| `/api/series` | `/api/public/probe-series` | 24 小时延迟、丢包率及系统指标历史；追加 `metric=system` 获取 CPU、内存、网速和累计流量序列 |
| `/api/stream` | `/api/public/probe-ws` | 实时 WebSocket |

`/api/probe` 返回的 `servers[]` 对象会保留主控提供的当前计费周期流量字段：

- `daily_traffic`：按日期拆分的流量明细，元素包含 `date`、`uplink`、`downlink`、`total`，单位为字节
- `traffic_used_up`、`traffic_used_down`、`traffic_used_total`：当前周期上行、下行和总用量
- `period_start`、`period_end`：计费周期边界，`period_start` 含，`period_end` 不含
- `traffic_used`：兼容字段，表示按主控服务器统计模式计算的计费用量

### 🧩 Komari 兼容接口

除标准探针接口外，容器还为常见 Komari 主题提供只读兼容接口：

- `GET /api/nodes`
- `GET /api/public`
- `GET /api/me`
- `GET /api/records/ping`
- `GET /api/records/load`
- `POST /api/rpc2`
- `GET /api/rpc2` WebSocket
- `GET /api/clients` WebSocket

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

### 📋 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `MMWX_ORIGIN` | 是 | - | 妙妙屋 X 主控地址。生产环境必须使用 HTTPS；仅 `localhost` 和 `127.0.0.1` 允许 HTTP |
| `PROBE_TOKEN` | 是 | - | 主控“系统设置 → 探针”生成的独立探针访问密钥，仅作为 `X-MMwx-Probe-Token` 转发给主控 |
| `THEME_REPO` | 是 | - | Komari 主题 GitHub HTTPS 仓库地址，例如 `https://github.com/stqfdyr/komari-theme-adhesive-note` |
| `THEME_REF` | 否 | `main` | 主题仓库分支、标签或 commit。生产环境建议固定到 tag 或 commit |
| `THEME_BUILD` | 否 | - | 自定义主题构建命令；未设置时使用主题仓库 `package.json` 中的 `build` 脚本 |
| `PORT` | 否 | `8080` | 容器内 HTTP 监听端口 |
| `CACHE_TTL` | 否 | `5` | MMWX 探针数据缓存时间，单位秒 |
| `DATA_DIR` | 否 | `/data` | 主题构建产物和运行数据目录，容器部署时建议挂载持久化卷 |

### 📜 日志与数据持久化

```bash
docker compose logs -f
```

容器内 `/data` 用于保存当前构建完成的主题目录。建议始终挂载 Docker volume，避免容器重建后重复拉取和构建主题。

### 🧯 故障排查

- 页面能打开但没有服务器：检查主控探针设置中是否选择了需要展示的服务器，并确认 `PROBE_TOKEN` 与主控生成的密钥一致
- 页面有服务器但曲线为空：检查 `/api/series` 是否返回数据；系统指标需要请求 `/api/series?metric=system`
- `/api/series` 返回 `502`：容器无法从主控 `/api/public/probe-series` 获取历史数据，通常是主控探针历史不可用、密钥不一致、主控地址错误或主控阻断了容器访问
- `/api/probe` 返回 `502`：容器无法从主控 `/api/public/probe-servers` 获取服务器状态
- 页面没有实时更新：检查反向代理、防火墙和主控是否允许 WebSocket；路径为 `/api/stream`
- `MMWX_ORIGIN must use HTTPS`：生产源站不是 HTTPS。本地调试仅允许 `localhost` 或 `127.0.0.1`
- 主题构建失败：确认 `THEME_REPO` 可以公开拉取，主题仓库包含根目录静态 `index.html`，或包含 `package.json`、构建脚本和受支持锁文件

## 🧠 功能细节

- 固定上游路径：HTTP 探针数据只请求 `/api/public/probe-servers` 和 `/api/public/probe-series`，实时流只请求 `/api/public/probe-ws`
- 查询参数透传：`/api/series` 会透传 `hours`、`metric` 等查询参数，但不会允许访客覆盖主控地址
- 历史数据映射：Komari 的 `/api/records/ping` 使用 MMWX series 中的延迟和丢包率历史，`/api/records/load` 固定追加 `metric=system` 获取系统指标历史
- 主题加载流程：校验 `THEME_REPO` 和 `THEME_REF` 后克隆仓库；有构建脚本和受支持锁文件时执行生产构建，否则使用根目录静态 `index.html`
- 包管理器优先级：`pnpm-lock.yaml`、`bun.lock` / `bun.lockb`、`package-lock.json`
- 构建隔离：主题构建使用 `CI=true`，不会把 `PROBE_TOKEN` 等敏感环境变量传入主题构建进程
- 输出校验：构建产物必须包含 `index.html`，并通过路径包含性和符号链接检查防止目录逃逸
- 数据缓存：探针快照和历史序列按 `CACHE_TTL` 短缓存，降低主题高频刷新对主控的压力

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
├── compose.yaml                 # GHCR 镜像部署示例
├── Dockerfile                   # 容器镜像定义
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
