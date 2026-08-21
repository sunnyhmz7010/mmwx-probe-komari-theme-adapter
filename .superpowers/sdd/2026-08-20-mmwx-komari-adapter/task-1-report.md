# Task 1 报告：初始化适配器配置边界

## 变更文件

- `adapter/package.json`
- `adapter/package-lock.json`
- `adapter/tsconfig.json`
- `adapter/src/config.ts`
- `adapter/src/log.ts`
- `adapter/test/config.test.ts`

实现 Node.js 22-compatible ESM、strict TypeScript、`node:test` 测试脚本和 `AppConfig`/`loadConfig`/`ConfigError`。配置边界包含 MMWX origin、token、GitHub 主题仓库、主题 ref/build、端口、缓存 TTL 和数据目录校验；默认值为 `main`、`8080`、`5` 秒和 `/data`。日志上下文过滤 token 字段，错误消息只输出字段名和规则，不回显配置值。

## TDD 验证

### RED

命令：

```text
cd adapter
npm test
```

结果：失败，原因是测试先行导入的 `../src/config.js` 不存在；随后修正测试谓词的 TypeScript 类型收窄，使失败聚焦于实现缺失，而非测试编译错误。

### GREEN

命令：

```text
cd adapter
npm test -- --test-name-pattern="configuration"
npm test
```

结果：两次均通过。focused test 为 10/10，通过 strict TypeScript build；完整 Task 1 测试为 10/10，无失败、取消或 todo。

依赖检查：`npm ls --depth=0` 仅列出 `ws`、`@types/ws` 和 devDependency `typescript`（`@types/node` 为 `@types/ws` 的传递依赖）。

## Commit

`b690ccccb3fc681425de76414f12a98d80c8db01`（`初始化适配器配置边界`）

## 自审

- 配置错误使用固定安全文案，未将 token、origin 或仓库值拼入错误。
- 生产 MMWX origin 强制 HTTPS，仅允许 localhost 和 127.0.0.1 使用 HTTP。
- 端口与缓存 TTL 拒绝非正整数、非数字和超出安全整数范围的值；端口限制在 1 到 65535。
- 主题仓库限制为无 query/fragment 的 `https://github.com/<owner>/<repo>`，主题 ref 拒绝空白和 shell 元字符。
- 提交前确认 commit 只包含 Task 1 指定的六个文件；工作区中的 `.superpowers/` 为既有任务资料目录。

## 风险

- `DATA_DIR` 默认值按容器约定固定为 `/data`；显式 `DATA_DIR` 会按当前运行平台解析，后续 Docker 任务需确保挂载路径与此约定一致。
- 日志工具通过过滤 `token`/`probeToken` 字段防止常见上下文泄露，但后续调用方仍应避免把秘密拼接进 message；上游请求错误也需继续使用安全错误包装。
- 本任务仅完成配置边界，主题加载、MMWX 请求、HTTP/WebSocket 兼容和 Docker 生命周期仍由后续 Task 实现。

## Fix Round 1：日志敏感信息脱敏

### 修复范围

- 为 `logInfo` 和 `logError` 增加可选的显式 `secrets` 参数。
- 使用显式 secrets 同时脱敏日志 message 和 context 普通字段值。
- 保留 `token`/`probeToken` context 字段整体过滤行为。
- 在 `adapter/test/config.test.ts` 增加回归测试，验证 info/error 两类日志均不会输出显式 secret。

### TDD 验证

#### RED

命令：

```text
cd adapter
npm test -- --test-name-pattern="configuration|logging"
```

结果：按预期失败，TypeScript 报告 `logInfo`/`logError` 当前仅接受 1-2 个参数，而回归测试传入显式 secret 的第三个参数；失败证明缺失 API 能力，而非测试运行时错误。

#### GREEN

命令：

```text
cd adapter
npm test -- --test-name-pattern="configuration|logging"
npm test
```

结果：focused 测试 11/11 通过，完整测试 11/11 通过；两次均通过 strict TypeScript build，无失败、取消或 todo。

### Commit

`e72d379568047702d43a72f1cd183131d78ba8ce`（`修复日志敏感信息脱敏`）

### 自审

- 调用方必须通过第三个参数显式提供需要保护的 secret；message 和 context 值均经过同一 `redactSecrets` 逻辑。
- 空 secret 会被忽略，现有默认调用行为保持兼容。
- `token` 和 `probeToken` context key 仍不会输出；本次新增测试覆盖 message 与普通 context value 的泄漏路径。
- 未写入真实 PROBE_TOKEN；测试使用占位 secret，commit message 不含敏感信息。
- 提交仅包含 Task 1 允许修改的两个源码/测试文件；报告追加变更尚未纳入上述实现 commit。

### 修复后风险

- 若调用方未将真实 secret 传入 `secrets` 参数，日志 API 无法从任意拼接后的 message 中推断并脱敏该 secret；调用方仍需在记录日志时显式传入 `config.probeToken`。
- 当前工作区保留测试生成的 `adapter/dist/` 和 `adapter/node_modules/` 未跟踪目录，未纳入提交。
