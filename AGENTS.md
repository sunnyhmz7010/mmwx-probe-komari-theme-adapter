# MMWX Probe Komari Theme Adapter 项目 AGENTS.md

## 项目说明

将 MMWX independent-probe 数据适配为 Komari 公开只读 API，并在运行时加载指定 Komari 主题，对外提供可直接访问的主题页面。

## 技术栈

- Node.js 22+（ESM）
- TypeScript
- ws：WebSocket 兼容层
- Docker（`node:22-bookworm-slim` 多阶段构建）
- 无数据库，运行数据固定写入容器内部运行目录，不通过 Compose 映射到宿主机

## 本地命令

```bash
npm install                 # 安装依赖
npm run build               # 编译 TypeScript
npm test                    # 编译并运行全部 node:test 测试
docker build -t mmwx-komari-adapter .  # 构建本地镜像
```

## 发布惯例

- 版本号遵循 semver（`major.minor.patch`）
- 发版步骤：`git tag vX.Y.Z` → `git push origin vX.Y.Z` → `gh release create` 写中英双语发布说明
- 镜像自动构建并推送到 `ghcr.io/sunnyhmz7010/mmwx-probe-komari-theme-adapter`
- `main` 分支推送生成 `main`、`sha-*` 标签；`v*` 标签推送生成 semver 和 `latest` 标签
- 首次发布 GHCR 镜像后，若公开拉取失败，在 GitHub Package settings 中确认容器包可见性为 Public，并确保仓库 Actions 对该 package 有写权限
- README 遵循 `github-repo-infrastructure` skill 规范，所有 H2/H3 标题固定 Emoji 前缀，不可随意增删调换章节
- 发布说明格式：`## ✨ New Features / 新增功能`、`## ⚙️ Enhancements / 功能优化`、`## 🛠️ Bug Fixes / 问题修复`

## 项目约定

- 环境变量命名统一大写蛇形（`MMWX_ORIGIN`、`PROBE_TOKEN`、`THEME_REPO`）
- 配置解析集中在 `src/config.ts`，校验失败抛出 `ConfigError`
- `PROBE_TOKEN` 只能用于 MMWX 上游请求和日志脱敏，不得暴露给主题构建、静态资源或 API 响应
- 生产环境 `MMWX_ORIGIN` 必须使用 HTTPS；仅 localhost 和 127.0.0.1 允许 HTTP
- Komari 兼容层默认只读，拒绝登录、完整后台管理和节点修改类接口；仅允许配置 `ADMIN_TOKEN` 后写入本项目自己的主题配置文件（位于容器内部运行目录）
- 主题构建产物必须经过路径包含性、符号链接逃逸和 `index.html` 校验后再发布到运行目录
- 新增接口兼容能力时，必须同步补测试和 README 的兼容边界说明
- 数据映射约定：地区字段优先取 `region_country`（ISO 代码）；续费货币把 ISO 代码转符号（`CAD`→`C$` 等）；`ping.loss` 指标输出 0~1 比例；上游缺失字段按「省略 > `unknown` > 0」兜底，改动映射时同步补测试

## 架构分层

```
src/main.ts          ← 入口：加载配置、构建主题、组装服务、生命周期处理
src/config.ts        ← 环境变量解析与安全校验
src/mmwx/client.ts   ← MMWX independent-probe HTTP/WebSocket 客户端
src/mmwx/stream-relay.ts ← 主控降载：共享单条上游 WS、快照帧复用与广播
src/komari/mapper.ts ← MMWX 数据到 Komari 形态的映射
src/komari/service.ts← 查询和历史数据服务
src/http/api.ts      ← Komari 兼容 API 与 RPC2 路由
src/http/server.ts   ← HTTP server 与 WebSocket 路由
src/http/static.ts   ← 静态主题资源、SPA fallback 与内置资源兜底
src/theme/loader.ts  ← 主题仓库克隆、构建、校验和发布
src/theme/settings-store.ts ← 主题配置 JSON 文件读写与校验
static-assets/       ← 内置国旗与 OS 图标资源（来源 junimo，Apache-2.0），随镜像打包
```

## 环境变量完整列表

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `MMWX_ORIGIN` | 是 | - | MMWX 控制端地址 |
| `PROBE_TOKEN` | 是 | - | MMWX independent-probe Token |
| `THEME_REPO` | 是 | - | Komari 主题 GitHub HTTPS 仓库地址 |
| `THEME_REF` | 否 | `main` | 主题分支、标签或 commit |
| `PORT` | 否 | `8080` | HTTP 监听端口 |
| `ADMIN_TOKEN` | 否 | - | 主题配置页保存操作的管理 Token；未设置时禁用写入 |
