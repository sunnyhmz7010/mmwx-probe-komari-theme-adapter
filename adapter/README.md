# MMWX Komari Theme Adapter

Docker-deployable Node.js service for serving a runtime Komari theme while exposing a read-only Komari-compatible API backed by MMWX independent-probe endpoints.

## Quick start

```bash
cp .env.example .env
# edit .env
docker compose up --build
```

The service listens on `PORT` and serves:

- Komari-compatible read-only API under `/api/*`
- the built theme for all non-API routes
- WebSocket compatibility on `/api/rpc2`, `/api/clients`, and `/api/stream`

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `MMWX_ORIGIN` | yes | - | MMWX controller origin. Production must use HTTPS. HTTP is allowed only for `localhost` and `127.0.0.1`. |
| `PROBE_TOKEN` | yes | - | Sent only to MMWX as `X-MMwx-Probe-Token`; never exposed to theme assets or API responses. |
| `THEME_REPO` | yes | - | GitHub HTTPS repository URL, for example `https://github.com/stqfdyr/komari-theme-adhesive-note`. |
| `THEME_REF` | no | `main` | Branch, tag, or commit. Production should pin a tag or commit. |
| `PORT` | no | `8080` | HTTP listen port inside the container. |
| `CACHE_TTL` | no | `5` | Cache TTL in seconds for MMWX probe data. |

Persist `/data` so the current built theme survives container restarts.

## Theme build behavior

At startup the adapter:

1. validates `THEME_REPO` and `THEME_REF`;
2. clones the GitHub repository into a temporary directory;
3. detects whether the theme is a static root `index.html` or a package build;
4. selects package manager by lockfile priority: `pnpm-lock.yaml`, `bun.lock`/`bun.lockb`, then `package-lock.json`;
5. runs install/build with `CI=true` and without secret environment variables;
6. validates output containment and `index.html`;
7. atomically publishes the result to `/data/themes/current`.

Invalid repository configuration, build failures, missing output, and symlink escapes fail startup.

## Supported compatibility boundary

Implemented public/read-only endpoints:

- `GET /api/nodes`
- `GET /api/public`
- `GET /api/me`
- `GET /api/records/ping`
- `GET /api/records/load`
- `POST /api/rpc2`
- `GET /api/rpc2` WebSocket
- `GET /api/clients` WebSocket
- `GET /api/stream` WebSocket proxy

Read-only RPC2 methods currently supported:

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

Mutation, admin, login, and theme-management APIs are intentionally unsupported.

## Validated theme observations

The first compatibility fixtures were inspected at these pinned commits:

- `stqfdyr/komari-theme-adhesive-note` at `8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914`
- `vaspike/junimo` at `8c899e1f1601600bfd8bc83f40d4538ee39b8944`

Observed requests are recorded under `test/fixtures/`.

## Troubleshooting

- `MMWX_ORIGIN must use HTTPS`: use an HTTPS controller URL in production.
- theme clone fails: verify `THEME_REPO`, `THEME_REF`, and network access to GitHub.
- theme build fails: ensure the selected lockfile package manager is available in the image or use a static theme with root `index.html`.
- no live data: verify `PROBE_TOKEN` is valid for the MMWX public probe endpoints.
