<div align="center">
  <h1>MMWX Probe Komari Theme Adapter</h1>
  <p>将 MMWX 探针代理、Komari 兼容转换和主题加载放在同一容器里，对外提供可直接访问的只读主题页面。</p>
</div>

<p align="center">
  <a href="https://github.com/sunnyhmz7010/mmwx-probe-komari-theme-adapter/releases"><img src="https://img.shields.io/github/v/release/sunnyhmz7010/mmwx-probe-komari-theme-adapter?label=Release&color=3b82f6" alt="Release" /></a>
  <a href="https://github.com/sunnyhmz7010/mmwx-probe-komari-theme-adapter/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sunnyhmz7010/mmwx-probe-komari-theme-adapter?color=10b981" alt="License" /></a>
</p>

---

## ✨ 为什么做这个项目

MMWX 探针已经提供稳定的原始数据接口，但直接暴露主控域名和访问密钥并不适合公开展示。这个容器把固定的探针代理、WebSocket 实时流、Komari 兼容转换和主题页面放在同一个对外地址下：访客只访问容器暴露的探针域名，容器再携带 `PROBE_TOKEN` 请求主控。

它适合已经部署独立探针的主控，又希望用 Docker 快速部署公开探针页面、复用 Komari 主题展示效果的场景。

## ⚠️ 免责声明

- 本项目与 Komari 官方项目无关，也不代表 Komari 官方立场
- 本项目与妙妙屋 X 主控的原作者、维护者或运营方无关
- 这里的“Komari 兼容”只表示 API 形状兼容，不表示上游项目关系或授权关系

## 🚀 核心能力

- 固定探针代理：仅代理 `/api/probe`、`/api/series`、`/api/stream` 到妙妙屋 X 主控对应路径，不接受访客指定上游地址
- Komari 公开只读兼容层：基于标准探针数据做结构转换，生成常见 Komari 主题需要的 `/api/public`、`/api/nodes`、`/api/records/*` 和部分 `/api/rpc2` 只读方法
- 运行时主题加载：启动时从指定 Git 仓库拉取主题，自动识别静态主题或前端构建型主题，并发布校验后的构建产物
- 主题配置管理：读取主题 `komari-theme.json` 配置声明，提供 `/admin/settings/theme` 轻量配置页，并将配置保存到 `/data/theme-settings.json`
- 历史与实时数据：`/api/series` 提供延迟、丢包率和系统指标历史，`/api/stream` 代理主控实时探针 WebSocket
- 探针数据保留：`/api/probe` 保留服务器状态、系统指标、流量周期、每日流量、续费信息和回程路由等主控字段
- 只读安全边界：`PROBE_TOKEN` 仅用于容器访问已配置主控，不暴露给浏览器，不提供登录、管理、写入或节点修改能力

## ⚡ 快速开始

### 📋 前置要求

- 已部署支持独立探针访问密钥的妙妙屋 X 主控
- 主控具有可由容器访问的 HTTPS 地址
- 已在主控“系统设置 → 探针”中启用探针、选择展示服务器和指标，并生成“独立探针访问密钥”
- 一台能访问妙妙屋 X 主控和 GitHub 的 VPS、NAS 或本地 Docker 环境
- Docker 与 Docker Compose
- 一个可公开拉取的 Komari 主题 GitHub 仓库

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
      - THEME_REPO=
      - THEME_REF=main
      - PORT=8080
      - CACHE_TTL=5
      # 可选：启用 /admin/settings/theme 写入保存
      # - ADMIN_TOKEN=replace-with-random-admin-token
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
  -e THEME_REPO="" \
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

`/api/probe` 还会补齐主题所需的外层字段：

- `enabled`：页面启用开关
- `title`、`logo`、`appearance`、`license_badge`：主题标题、图标、外观和徽标
- `show_globe`、`show_daily_trend`、`show_traffic_hotspots`、`show_traffic_7d`、`show_resource_heatmap`、`show_traffic_quota`、`show_renewal_timeline`、`show_health_score`：主题模块开关

节点字段会统一归一化为主题可直接消费的格式，并保留流量、续费和回程等附加信息。

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
- `rpc.getMethods`
- `rpc.getHelp`
- `rpc.getVersion`
- `common:getBackendVersion`
- `common:getMe`
- `common:getPublicInfo`
- `public:getNodesInformation`
- `public:getPublicSettings`
- `common:getNodes`
- `common:getRecords`
- `common:getNodesLatestStatus`
- `public:getClientRecentRecords`
- `public:getRecordsByUUID`
- `public:getPingRecords`
- `public:queryMetrics`
- `public:getPingMetricStats`
- `public:getPublicPingTasks`
- `nodes.list`
- `public.nodes`
- `records.ping`
- `records.load`

Komari 兼容层当前遵循两条固定转换规则：

- 原始探针结构只从 MMWX 拉取一次，再映射成 Komari 需要的节点、状态、历史和公共设置
- 未指定 `uuid` 的 Ping / 负载历史请求会聚合全部可见节点，不再只返回第一个节点

`common:getRecords` 会按 `type` 兼容两类返回：

- `type=load`：返回负载、内存、磁盘和网络统计记录
- `type=ping`：返回 Ping 记录、任务列表和客户端列表

登录、后台管理、主题管理、节点修改等写操作不在兼容范围内。

### 🎨 主题配置

容器会读取当前主题仓库根目录的 `komari-theme.json`。如果主题声明了 `configuration`，可以打开：

```text
http://localhost:8080/admin/settings/theme
```

页面会按当前主题的配置声明渲染轻量表单，并通过 Komari 兼容接口保存配置。保存写入需要设置 `ADMIN_TOKEN`，否则页面只能查看配置声明和当前值。

配置保存位置默认是：

```text
/data/theme-settings.json
```

最终返回给主题的 `theme_settings` 合并顺序为：

```text
主题默认值 < theme-settings.json < THEME_SETTINGS_JSON < 适配器自动兼容补丁
```

同时兼容 Komari 后台读取主题配置声明的路径：

```text
/themes/<当前主题>/komari-theme.json
```

没有 `configuration` 的主题会显示“当前主题未声明可配置项”，并提供高级 JSON 编辑入口。

### 🧪 已实测主题仓库

| 主题仓库 | 状态 | 备注 |
| --- | --- | --- |
| `https://github.com/jianmomo/komari-theme-Glassmorphism-Enhanced` | ✅ | 直接读取 `komari-theme.json`，支持管理型配置页 |
| `https://github.com/vaspike/junimo` | ✅ | 直接读取 `komari-theme.json`，支持公开前台 |
| `https://github.com/sunnyhmz7010/komari-theme-adhesive-note` | ✅ | 直接读取 `komari-theme.json`，支持公开前台 |

### ✅❌ 功能支持矩阵

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 原始探针代理 `/api/probe`、`/api/series`、`/api/stream` | ✅ | 只做透传和必要的 token 转发 |
| Komari 兼容 RPC2 | ✅ | 提供只读方法和固定返回结构 |
| 多节点 Ping / 负载聚合 | ✅ | 未指定 `uuid` 时聚合全部可见节点 |
| 登录、写入、节点修改 | ❌ | 明确不在兼容范围内 |
| 直接暴露上游地址 | ❌ | 不允许访客指定任意上游 |

### 📋 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `MMWX_ORIGIN` | 是 | - | 妙妙屋 X 主控地址。生产环境必须使用 HTTPS；仅 `localhost` 和 `127.0.0.1` 允许 HTTP |
| `PROBE_TOKEN` | 是 | - | 主控“系统设置 → 探针”生成的独立探针访问密钥，仅作为 `X-MMwx-Probe-Token` 转发给主控 |
| `THEME_REPO` | 是 | - | Komari 主题 GitHub HTTPS 仓库地址，例如 `https://github.com/<owner>/<repo>` |
| `THEME_REF` | 否 | `main` | 主题仓库分支、标签或 commit。生产环境建议固定到 tag 或 commit |
| `THEME_BUILD` | 否 | - | 自定义主题构建命令；未设置时使用主题仓库 `package.json` 中的 `build` 脚本 |
| `PORT` | 否 | `8080` | 容器内 HTTP 监听端口 |
| `CACHE_TTL` | 否 | `5` | MMWX 探针数据缓存时间，单位秒 |
| `DATA_DIR` | 否 | `/data` | 主题构建产物和运行数据目录，容器部署时建议挂载持久化卷 |
| `ADMIN_TOKEN` | 否 | - | 主题配置页保存操作的管理 Token；未设置时禁用主题配置写入 |
| `THEME_SETTINGS_FILE` | 否 | `/data/theme-settings.json` | 主题配置持久化 JSON 文件路径 |
| `THEME_SETTINGS_JSON` | 否 | - | 主题配置 JSON 对象，会覆盖文件配置，适合 Docker 环境强制指定少量设置 |

### 📜 日志与数据持久化

```bash
docker compose logs -f
```

容器启动日志会输出脱敏后的完整解析配置，并实时记录主题仓库拉取、依赖安装、主题构建命令、构建输出、产物发布和失败原因。`PROBE_TOKEN` 只显示为 `[REDACTED]`。

常用查看命令：

```bash
docker compose logs --tail=200 mmwx-komari-adapter
docker compose logs -f mmwx-komari-adapter
```

容器内 `/data` 用于保存当前构建完成的主题目录和 `theme-settings.json`。建议始终挂载 Docker volume，避免容器重建后重复拉取、构建主题或丢失主题配置。

### 🧯 故障排查

- 页面能打开但没有服务器：检查主控探针设置中是否选择了需要展示的服务器，并确认 `PROBE_TOKEN` 与主控生成的密钥一致
- 页面有服务器但曲线为空：检查 `/api/series` 是否返回数据；系统指标需要请求 `/api/series?metric=system`
- 页面有服务器但仍为空数据：确认主题依赖的 RPC（尤其是 `common:getNodes`、`common:getRecords`、`public:queryMetrics`）已经返回非空结果
- `/api/series` 返回 `502`：容器无法从主控 `/api/public/probe-series` 获取历史数据，通常是主控探针历史不可用、密钥不一致、主控地址错误或主控阻断了容器访问
- `/api/probe` 返回 `502`：容器无法从主控 `/api/public/probe-servers` 获取服务器状态
- 页面没有实时更新：检查反向代理、防火墙和主控是否允许 WebSocket；路径为 `/api/stream`
- `MMWX_ORIGIN must use HTTPS`：生产源站不是 HTTPS。本地调试仅允许 `localhost` 或 `127.0.0.1`
- 主题构建失败：确认 `THEME_REPO` 可以公开拉取，主题仓库包含根目录静态 `index.html`，或包含 `package.json`、构建脚本和受支持锁文件；若构建命令返回非零但已经生成包含 `index.html` 的 `dist`、`build`、`out` 或 `public` 产物，适配器会记录警告并继续启动

## 🧠 功能细节

- 原始探针层：`/api/probe`、`/api/series`、`/api/stream` 只做 MMWX 代理，不改写路径、状态码和流式行为
- 转换池：Komari 兼容层从探针快照和历史序列池读取数据，再映射成 Komari 需要的固定结构
- 状态映射：`common:getNodes`、`common:getNodesLatestStatus`、`common:getNodeRecentStatus`、`common:getRecords`、`public:queryMetrics` 都从同一套转换结果生成
- 聚合规则：Ping / 负载历史在未指定 `uuid` 时聚合全部可见节点，避免主题只看到第一个节点
- 公共设置：`common:getPublicInfo` 和 `public:getPublicSettings` 都基于同一份主题配置和探针快照生成
- 主题加载流程：校验 `THEME_REPO` 和 `THEME_REF` 后克隆仓库；有构建脚本和受支持锁文件时执行生产构建，否则使用根目录静态 `index.html`
- 主题配置流程：保留完整 `komari-theme.json`，根据 `configuration` 渲染轻量配置页；保存操作必须携带 `ADMIN_TOKEN`
- 包管理器优先级：`pnpm-lock.yaml`、`bun.lock` / `bun.lockb`、`package-lock.json`
- 构建隔离：主题构建使用 `CI=true`，不会把 `PROBE_TOKEN` 等敏感环境变量传入主题构建进程
- 输出校验：构建产物必须包含 `index.html`，并通过路径包含性和符号链接检查防止目录逃逸

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
