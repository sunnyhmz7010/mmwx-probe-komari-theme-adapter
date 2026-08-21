# MMWX Komari Theme Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker-deployable Node.js service that pulls a Komari theme repository at startup, serves the theme, and exposes a read-only Komari-compatible API backed by MMWX independent-probe APIs.

**Architecture:** The service has four isolated units: `theme-loader` downloads/builds a GitHub theme into a controlled data directory; `mmwx-client` calls only the three fixed MMWX public probe endpoints with `X-MMwx-Probe-Token`; `komari-adapter` maps MMWX payloads to stable Komari node/config/history shapes; `http-server` routes `/api/*` and serves the built theme for all other paths. `ws` handles both the upstream MMWX WebSocket and downstream Komari-style WebSocket endpoints.

**Tech Stack:** Node.js 22, TypeScript, native `fetch`, Node `http`, `child_process`, `fs/promises`, `node:test`, `ws`, Docker.

## Global Constraints

- `MMWX_ORIGIN` is the fixed MMWX controller origin and production value must use HTTPS; only `localhost` and `127.0.0.1` are allowed for local development.
- `PROBE_TOKEN` is sent only as `X-MMwx-Probe-Token` to MMWX and must never be exposed to theme assets or API responses.
- `THEME_REPO` is the runtime GitHub repository source; themes are not compiled into the adapter image.
- `THEME_REF` must support branch, tag, and commit values; production documentation must recommend a pinned tag or commit.
- Upstream proxy targets are fixed to `/api/public/probe-servers`, `/api/public/probe-series`, and `/api/public/probe-ws`; visitors cannot override the upstream origin.
- The first compatibility fixtures are `stqfdyr/komari-theme-adhesive-note` and `vaspike/junimo`; no theme-specific frontend branch is allowed.
- Missing MMWX values are represented by omitted fields, `null`, or empty arrays; invented live metrics are forbidden.
- Theme build failures, invalid repository configuration, and invalid output directories fail fast with actionable logs.
- `jiwo-probe/` is a read-only reference checkout and must not be changed by implementation work.

---

## File Map

Create the implementation under `adapter/` so the checked-out `jiwo-probe/` reference remains untouched:

- `adapter/package.json`, `adapter/package-lock.json`, `adapter/tsconfig.json`: project metadata, dependency lock, and strict TypeScript compilation.
- `adapter/src/config.ts`: environment parsing and validation; produces immutable `AppConfig`.
- `adapter/src/log.ts`: structured redacted logging helpers.
- `adapter/src/theme/types.ts`: theme source/build result types.
- `adapter/src/theme/repository.ts`: GitHub URL/ref validation and repository acquisition.
- `adapter/src/theme/builder.ts`: build command detection, installation, build execution, and output discovery.
- `adapter/src/theme/loader.ts`: orchestrates repository acquisition and build into a safe current-theme directory.
- `adapter/src/mmwx/types.ts`: MMWX probe payload and series types based on `jiwo-probe/src/types.ts`.
- `adapter/src/mmwx/client.ts`: fixed-path MMWX HTTP/WS client with token forwarding.
- `adapter/test/mmwx-client.test.ts`: fixed-route, token-header, timeout, and upstream WebSocket tests.
- `adapter/src/komari/types.ts`: public Komari-compatible response types.
- `adapter/src/komari/mapper.ts`: pure MMWX-to-Komari mapping functions.
- `adapter/src/komari/service.ts`: cached snapshot/history service and virtual UUID handling.
- `adapter/src/http/api.ts`: REST route handlers and JSON envelope handling.
- `adapter/src/http/static.ts`: safe static-file serving and SPA fallback.
- `adapter/src/http/server.ts`: HTTP/WebSocket routing and lifecycle.
- `adapter/src/main.ts`: startup order, graceful shutdown, and fatal-error handling.
- `adapter/test/config.test.ts`: configuration validation tests.
- `adapter/test/theme-repository.test.ts`: repository URL/ref validation tests.
- `adapter/test/theme-builder.test.ts`: output discovery and package-manager selection tests.
- `adapter/test/mapper.test.ts`: mapping and edge-case tests.
- `adapter/test/api.test.ts`: REST API compatibility tests with mocked MMWX client.
- `adapter/test/ws.test.ts`: downstream WebSocket behavior tests.
- `adapter/test/startup.test.ts`: startup ordering and fatal initialization tests.
- `adapter/Dockerfile`: production image with Node.js and git.
- `adapter/docker-compose.yml`: local deployment example using an `.env` file.
- `adapter/.env.example`: safe configuration placeholders only.
- `adapter/.dockerignore`: excludes source control, secrets, test data, and local theme cache.
- `adapter/README.md`: Docker usage, environment variables, supported compatibility boundary, and troubleshooting.

---

### Task 1: Bootstrap the TypeScript service and configuration boundary

**Files:**
- Create: `adapter/package.json`
- Create: `adapter/package-lock.json`
- Create: `adapter/tsconfig.json`
- Create: `adapter/src/config.ts`
- Create: `adapter/src/log.ts`
- Test: `adapter/test/config.test.ts`

**Interfaces:**
- Produces `AppConfig` with `mmwxOrigin`, `probeToken`, `themeRepo`, `themeRef`, `themeBuild`, `port`, `cacheTtlMs`, `dataDir`.
- Produces `loadConfig(env: NodeJS.ProcessEnv): AppConfig`.
- Produces `ConfigError` with a safe human-readable message that never includes token contents.

- [ ] **Step 1: Create the package and strict compiler configuration**

Use Node.js 22-compatible ESM output, strict type checking, and `node:test`. Add only `ws` and its type package as runtime dependencies; use TypeScript as a development dependency.

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "npm run build && node --test dist/test/*.test.js"
  }
}
```

- [ ] **Step 2: Write failing configuration tests**

Cover missing `MMWX_ORIGIN`, missing `PROBE_TOKEN`, invalid non-HTTPS production origin, missing `THEME_REPO`, default port `8080`, and token redaction in thrown errors.

```ts
test('rejects a production HTTP MMWX origin', () => {
  assert.throws(
    () => loadConfig({ MMWX_ORIGIN: 'http://panel.example.com', PROBE_TOKEN: 'secret', THEME_REPO: 'https://github.com/a/b' }),
    /MMWX_ORIGIN must use HTTPS/,
  )
})
```

- [ ] **Step 3: Implement `loadConfig` and redacted logging**

Normalize trailing slashes from `MMWX_ORIGIN`, default `THEME_REF` to `main`, default `PORT` to `8080`, default `CACHE_TTL` to `5` seconds, and resolve `DATA_DIR` to `/data` in the container. Reject malformed integers and repository URLs before startup.

- [ ] **Step 4: Run the focused test**

Run: `cd adapter && npm test -- --test-name-pattern="configuration"`

Expected: all configuration tests pass.

- [ ] **Step 5: Commit the bootstrap unit**

```bash
git add adapter/package.json adapter/package-lock.json adapter/tsconfig.json adapter/src/config.ts adapter/src/log.ts adapter/test/config.test.ts
git commit -m "初始化适配器配置边界"
```

---

### Task 2: Implement secure runtime theme acquisition and build detection

**Files:**
- Create: `adapter/src/theme/types.ts`
- Create: `adapter/src/theme/repository.ts`
- Create: `adapter/src/theme/builder.ts`
- Create: `adapter/src/theme/loader.ts`
- Test: `adapter/test/theme-repository.test.ts`
- Test: `adapter/test/theme-builder.test.ts`

**Interfaces:**
- `parseGitHubRepo(value: string): { owner: string; name: string }`.
- `resolveThemeRef(value: string): string`.
- `acquireTheme(source: ThemeSource, targetDir: string): Promise<string>`.
- `detectBuildPlan(repoDir: string): Promise<BuildPlan>`.
- `buildTheme(plan: BuildPlan, repoDir: string, outputDir: string): Promise<string>`.
- `loadTheme(config: AppConfig): Promise<LoadedTheme>`.

- [ ] **Step 1: Write repository validation tests**

Accept only `https://github.com/<owner>/<repo>` and the equivalent `.git` URL. Reject query strings, fragments, local paths, arbitrary hosts, and empty owner/repository names. Preserve `THEME_REF` exactly after rejecting whitespace and shell metacharacters.

- [ ] **Step 2: Implement repository validation and git acquisition**

Use `spawnFile('git', ['clone', '--depth', '1', '--branch', ref, repoUrl, targetDir])` for branch/tag acquisition. For a commit ref, clone the default branch, then run `git fetch --depth 1 origin ref` and `git checkout --detach ref`. Never invoke a shell string.

- [ ] **Step 3: Write build-plan tests against temporary fixture repositories**

Test these exact cases: root `index.html` means no build; `package-lock.json` selects npm; `pnpm-lock.yaml` selects pnpm; `bun.lockb` or `bun.lock` selects bun; a package with no `build` script fails with a clear message; output discovery accepts only `dist`, `build`, `out`, `public`, or root.

- [ ] **Step 4: Implement build-plan detection and execution**

Read `package.json` as JSON. Select the package manager by lockfile priority `pnpm`, `bun`, then npm. Run install with the lockfile-preserving command (`pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`, or `npm ci`) and then the declared `build` script. Set `CI=true`, use a controlled working directory, and inherit only non-secret build environment variables.

- [ ] **Step 5: Implement output containment checks**

Resolve the selected output directory and verify it is a descendant of the repository directory. Reject symlink escapes and missing `index.html`. Copy or atomically rename the result into `${DATA_DIR}/themes/current`.

- [ ] **Step 6: Run focused theme-loader tests**

Run: `cd adapter && npm test -- --test-name-pattern="theme"`

Expected: repository parsing, package-manager selection, output discovery, and failure paths pass.

- [ ] **Step 7: Commit the theme-loader unit**

```bash
git add adapter/src/theme adapter/test/theme-*.test.ts
git commit -m "增加运行时 Komari 主题加载器"
```

---

### Task 3: Implement the MMWX client with fixed upstream routes

**Files:**
- Create: `adapter/src/mmwx/types.ts`
- Create: `adapter/src/mmwx/client.ts`
- Test: `adapter/test/mmwx-client.test.ts`

**Interfaces:**
- `MmwxClient.fetchProbe(): Promise<ProbePayload>`.
- `MmwxClient.fetchSeries(query: SeriesQuery): Promise<ProbeSeriesPayload>`.
- `MmwxClient.openStream(onMessage: (payload: ProbePayload) => void, onClose: () => void): Closeable`.

- [ ] **Step 1: Write tests for fixed path and header behavior**

Mock `fetch` and assert that the client calls exactly `/api/public/probe-servers` and `/api/public/probe-series`, sends `X-MMwx-Probe-Token`, never sends browser cookies or authorization, forwards query parameters, and does not allow a caller-provided origin.

- [ ] **Step 2: Define MMWX payload types from the reference implementation**

Port the relevant shapes from `jiwo-probe/src/types.ts`: `ProbePayload`, `ProbeServer`, `ProbePingSeries`, `ProbeBucket`, `ProbeReturnRoute`, and system-series point types. Keep optional fields optional.

- [ ] **Step 3: Implement fixed-origin HTTP requests**

Construct URLs from the validated `MMWX_ORIGIN` and fixed paths only. Use `AbortSignal.timeout(10_000)` for normal requests. Treat non-2xx responses as typed upstream errors; do not include `PROBE_TOKEN` in errors.

- [ ] **Step 4: Implement the upstream WebSocket client**

Use `ws` to connect to `MMWX_ORIGIN` with `http` replaced by `ws`, set `X-MMwx-Probe-Token`, and connect only to `/api/public/probe-ws`. Return a close handle and translate connection errors into adapter-level status events.

- [ ] **Step 5: Run the focused client tests**

Run: `cd adapter && npm test -- --test-name-pattern="MMWX"`

Expected: all fixed-route, header, query, timeout, and WebSocket connection tests pass.

- [ ] **Step 6: Commit the MMWX client unit**

```bash
git add adapter/src/mmwx adapter/test/mmwx-client.test.ts
git commit -m "接入妙妙屋 X 独立探针接口"
```

---

### Task 4: Implement pure MMWX-to-Komari mapping and snapshot cache

**Files:**
- Create: `adapter/src/komari/types.ts`
- Create: `adapter/src/komari/mapper.ts`
- Create: `adapter/src/komari/service.ts`
- Test: `adapter/test/mapper.test.ts`

**Interfaces:**
- `toKomariNode(server: ProbeServer, index: number): KomariNode`.
- `toKomariRecord(server: ProbeServer, index: number, now: Date): KomariRecord`.
- `toPingHistory(servers: ProbeServer[], now: Date): PingHistory`.
- `toLoadHistory(series: MmwxSystemSeries): LoadHistory`.
- `KomariDataService.getSnapshot(): Promise<KomariSnapshot>`.
- `KomariDataService.getPingHistory(query): Promise<PingHistory>`.
- `KomariDataService.getLoadHistory(uuid, query): Promise<LoadHistory>`.

- [ ] **Step 1: Write mapping tests using representative MMWX fixtures**

Assert stable UUIDs `mmwx-0`, `mmwx-1`; CPU/memory/network/uplink/downlink mapping; load-average parsing; country/region fallback; ping task construction; system-series timestamp ordering; offline nodes; empty arrays; invalid numeric values; and preservation of traffic-period fields.

- [ ] **Step 2: Implement pure mapping functions**

Keep mapping functions side-effect-free. Filter non-finite values. Preserve `null` for unavailable ping buckets and omit values that MMWX does not provide. Map MMWX upload to Komari outbound fields and download to inbound fields consistently.

- [ ] **Step 3: Implement snapshot and history caches**

Cache the latest probe snapshot for `cacheTtlMs`; cache series by normalized query key. Deduplicate concurrent requests with in-flight promises. On an upstream failure, serve a still-valid cached value only when it has not exceeded `2 * cacheTtlMs`; otherwise propagate a 502-level adapter error.

- [ ] **Step 4: Run mapper and service tests**

Run: `cd adapter && npm test -- --test-name-pattern="mapping|cache|history"`

Expected: pure mapping and cache behavior pass without network access.

- [ ] **Step 5: Commit the data unit**

```bash
git add adapter/src/komari adapter/test/mapper.test.ts
git commit -m "增加 MMWX 到 Komari 的数据映射"
```

---

### Task 5: Implement the Komari-compatible REST API

**Files:**
- Create: `adapter/src/http/api.ts`
- Test: `adapter/test/api.test.ts`

**Interfaces:**
- `createApiRouter(service: KomariDataService): ApiRouter`.
- `ApiRouter.handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>`.

- [ ] **Step 1: Write route contract tests**

Test the following responses using a fake `KomariDataService`: `GET /api/nodes`, `GET /api/public`, `GET /api/me`, `GET /api/records/ping?hours=1`, `GET /api/records/load?uuid=mmwx-0&hours=1`, unsupported methods as 405, unknown API paths as 404, and upstream failures as JSON 502 responses.

- [ ] **Step 2: Implement response helpers**

Return JSON with `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store` for API responses. Support both raw Komari-style payloads and the `{ status, message, data }` envelope only where required by the target theme fixtures; keep one consistent response shape per endpoint.

- [ ] **Step 3: Implement core endpoints**

Implement `/api/nodes`, `/api/public`, `/api/me`, `/api/records/ping`, and `/api/records/load`. Return anonymous state from `/api/me` as `{ logged_in: false }`. Validate UUIDs against the internal `mmwx-<nonnegative integer>` format before querying.

- [ ] **Step 4: Implement read-only RPC2 compatibility**

Implement `POST /api/rpc2` with JSON-RPC 2.0 parsing. Support the public methods required by the first two fixtures, including metric/history queries if requested by their built assets. Reject all other methods with a JSON-RPC method-not-found error; never implement mutation or admin methods.

- [ ] **Step 5: Run REST tests**

Run: `cd adapter && npm test -- --test-name-pattern="API|route|RPC"`

Expected: all route, method, envelope, validation, and error tests pass.

- [ ] **Step 6: Commit the REST API unit**

```bash
git add adapter/src/http/api.ts adapter/test/api.test.ts
git commit -m "提供 Komari 只读兼容接口"
```

---

### Task 6: Implement WebSocket compatibility and static SPA serving

**Files:**
- Create: `adapter/src/http/static.ts`
- Create: `adapter/src/http/server.ts`
- Test: `adapter/test/ws.test.ts`

**Interfaces:**
- `createHttpServer(config: AppConfig, theme: LoadedTheme, api: ApiRouter, mmwx: MmwxClient): ServerHandle`.
- `ServerHandle.listen(): Promise<void>`.
- `ServerHandle.close(): Promise<void>`.

- [ ] **Step 1: Write WebSocket contract tests**

Test downstream `GET /api/clients` upgrade, client message `get`, response payload containing `online` and `data`, reconnect-safe cleanup, and `/api/stream` forwarding. Verify that an upstream 101 response is not converted into a normal HTTP response.

- [ ] **Step 2: Implement Komari `/api/clients` WebSocket**

On each client `get` message, obtain the latest snapshot and send a JSON object compatible with `KomariWSPayload`. Do not broadcast secret headers or MMWX raw credentials. Close idle clients during graceful shutdown.

- [ ] **Step 3: Implement MMWX `/api/stream` proxying**

Create one upstream connection per downstream stream client, forward only text/binary frames, and close both sides when either side closes. If upstream connection fails, close downstream with a clear protocol error; HTTP polling remains available.

- [ ] **Step 4: Implement safe static file serving**

Resolve request paths under the loaded theme root, reject `..` traversal and symlink escapes, set content types from a fixed extension map, and use the theme `index.html` for non-API SPA routes. Never fall back to a host filesystem path.

- [ ] **Step 5: Run HTTP/WebSocket tests**

Run: `cd adapter && npm test -- --test-name-pattern="WebSocket|static|server"`

Expected: REST, static, upgrade, close, and fallback behavior pass.

- [ ] **Step 6: Commit the server unit**

```bash
git add adapter/src/http/static.ts adapter/src/http/server.ts adapter/test/ws.test.ts
git commit -m "增加主题静态服务和实时接口"
```

---

### Task 7: Add startup lifecycle, Docker image, and local deployment files

**Files:**
- Create: `adapter/src/main.ts`
- Create: `adapter/Dockerfile`
- Create: `adapter/docker-compose.yml`
- Create: `adapter/.env.example`
- Create: `adapter/.dockerignore`
- Modify: `adapter/package.json`
- Test: `adapter/test/startup.test.ts`

**Interfaces:**
- `start(): Promise<ServerHandle>` from `adapter/src/main.ts`.
- Docker image exposes TCP port `8080` by default.

- [ ] **Step 1: Write startup tests**

Mock `loadConfig`, `loadTheme`, and server creation to verify startup order: validate config → load theme → create adapter service → create server → listen. Verify that a theme-loader failure exits nonzero and does not start an HTTP listener.

- [ ] **Step 2: Implement startup and signal handling**

Register `SIGTERM` and `SIGINT`, close WebSocket clients and HTTP server, and exit with code 1 for configuration, clone, build, or theme-output failures. Log repository URL/ref and selected output directory, but never log `PROBE_TOKEN`.

- [ ] **Step 3: Create the production Dockerfile**

Use a Node.js 22 Debian-slim base with `git` installed. Build TypeScript in a builder stage, copy only compiled adapter files and production dependencies into the runtime stage, create `/data`, run as a non-root user, expose `8080`, and start `node dist/main.js`.

- [ ] **Step 4: Add Compose and environment examples**

Use:

```yaml
services:
  mmwx-komari-adapter:
    build: .
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      - theme-data:/data

volumes:
  theme-data:
```

`.env.example` must contain placeholders only for `MMWX_ORIGIN`, `PROBE_TOKEN`, `THEME_REPO`, `THEME_REF`, `PORT`, and `CACHE_TTL`.

- [ ] **Step 5: Build and smoke-test the image**

Run:

```bash
cd adapter
npm test
docker build -t mmwx-komari-adapter:test .
docker run --rm -e MMWX_ORIGIN=https://panel.example.com -e PROBE_TOKEN=placeholder -e THEME_REPO=https://github.com/stqfdyr/komari-theme-adhesive-note -e THEME_REF=main -p 8080:8080 mmwx-komari-adapter:test
```

The final command may fail at the upstream request without a real controller, but image build and startup theme acquisition must be observable and the token must not appear in logs.

- [ ] **Step 6: Commit deployment files**

```bash
git add adapter/src/main.ts adapter/Dockerfile adapter/docker-compose.yml adapter/.env.example adapter/.dockerignore adapter/package.json adapter/test/startup.test.ts
git commit -m "增加 Docker 部署和启动生命周期"
```

---

### Task 8: Validate the two first-party theme repositories and document compatibility

**Files:**
- Modify: `adapter/README.md`
- Create: `adapter/test/fixtures/theme-adhesive-note.json`
- Create: `adapter/test/fixtures/theme-junimo.json`
- Create: `adapter/test/theme-smoke.test.ts`

- [ ] **Step 1: Record the observed API requests for both themes**

Build each repository at a pinned ref in a disposable directory, inspect the generated assets for `/api/` and WebSocket paths, and record the exact requests in the fixture files. Do not infer endpoints from names alone.

- [ ] **Step 2: Add smoke tests for both repositories**

Use a fake MMWX service and serve each built theme through the adapter. Assert that the root page loads, referenced assets return 200, every observed API request returns a valid response, and no request attempts to call the original Komari origin.

- [ ] **Step 3: Close compatibility gaps in the shared adapter layer**

When a smoke test fails, add the missing behavior to `komari/` or `http/` as a shared endpoint/protocol implementation. Do not add `if theme === ...` branches.

- [ ] **Step 4: Document deployment and boundaries**

Document `MMWX_ORIGIN`, `PROBE_TOKEN`, `THEME_REPO`, `THEME_REF`, port mapping, persistent `/data`, startup build behavior, pinned refs, supported Komari read-only APIs, and the fact that themes requiring private/admin APIs are outside scope.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
cd adapter
npm test
docker build -t mmwx-komari-adapter:test .
```

Expected: all unit, protocol, theme smoke, and image build checks pass. Any unavailable real MMWX controller test must be explicitly reported as an environment limitation rather than marked successful.

- [ ] **Step 6: Commit the validation and documentation unit**

```bash
git add adapter/README.md adapter/test/fixtures adapter/test/theme-smoke.test.ts adapter/src
git commit -m "验证 Komari 主题兼容性并补充文档"
```

---

## Handoff Notes

The current workspace is not yet a Git repository. Before executing Task 1, initialize or provide the target repository boundary, then keep `jiwo-probe/` as a read-only reference checkout. Do not commit the reference clone or any `.env` file containing a real token.
