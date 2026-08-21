import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import { test } from 'node:test'

import { createApiRouter } from '../src/http/api.js'
import { KomariDataService } from '../src/komari/service.js'
import type { ProbePayload, ProbeSeriesPayload, SeriesQuery } from '../src/mmwx/types.js'

interface TestResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: unknown
}

function fakeService(overrides: Partial<KomariDataService> = {}): KomariDataService {
  return {
    getProbePayload: async () => ({
      servers: [{
        name: 'node-0',
        online: true,
        daily_traffic: [{ date: '2026-08-21', uplink: 1, downlink: 2, total: 3 }],
        traffic_used_up: 1,
        traffic_used_down: 2,
        traffic_used_total: 3,
        period_start: '2026-08-01T00:00:00.000Z',
        period_end: '2026-09-01T00:00:00.000Z',
      }],
    } as ProbePayload),
    getSeriesPayload: async () => ({
      pings: [{ serverId: 0, route: 'Google', points: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 10, loss: 0 }] }],
      systems: [{ serverId: 0, points: [{ timestamp: '2026-08-21T00:00:00.000Z', cpu: 1 }] }],
    } as ProbeSeriesPayload),
    getSnapshot: async () => ({
      nodes: [{ uuid: 'mmwx-0', name: 'node-0', online: true }],
      records: [{ uuid: 'mmwx-0', online: true, updated_at: '2026-08-21T00:00:00.000Z' }],
    }),
    getPingHistory: async () => ({
      count: 1,
      records: [{ task_id: 0, time: '2026-08-21T00:00:00.000Z', value: 10, client: 'mmwx-0' }],
      tasks: [{ id: 0, name: 'Google', clients: ['mmwx-0'], default_on: true, type: 'icmp', interval: 30 }],
      basic_info: { clients: ['mmwx-0'] },
    }),
    getLoadHistory: async () => ({
      count: 1,
      records: [{ client: 'mmwx-0', time: '2026-08-21T00:00:00.000Z', cpu: 1 }],
    }),
    ...overrides,
  } as unknown as KomariDataService
}

async function withApi(service: KomariDataService, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const router = createApiRouter(service)
  const server = http.createServer((request, response) => {
    router.handle(request, response).then((handled: boolean) => {
      if (!handled && !response.headersSent) {
        response.writeHead(500)
        response.end()
      }
    }).catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'unknown' }))
    })
  })
  server.listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function request(baseUrl: string, path: string, init: RequestInit = {}): Promise<TestResponse> {
  const response = await fetch(`${baseUrl}${path}`, init)
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.json(),
  }
}

function assertJsonHeaders(response: TestResponse): void {
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.headers['cache-control'], 'no-store')
}

test('API routes return Komari-compatible public resources', async () => {
  await withApi(fakeService(), async (baseUrl) => {
    const nodes = await request(baseUrl, '/api/nodes')
    assert.equal(nodes.status, 200)
    assertJsonHeaders(nodes)
    assert.deepEqual(nodes.body, { status: 'success', message: 'success', data: [{ uuid: 'mmwx-0', name: 'node-0', online: true }] })

    const publicInfo = await request(baseUrl, '/api/public')
    assert.equal(publicInfo.status, 200)
    assert.deepEqual(publicInfo.body, { status: 'success', message: 'success', data: { nodes: 1 } })

    const me = await request(baseUrl, '/api/me')
    assert.equal(me.status, 200)
    assert.deepEqual(me.body, { logged_in: false })
  })
})

test('API routes expose MMWX probe-compatible fixed HTTP paths', async () => {
  const seen: unknown[] = []
  await withApi(fakeService({
    getProbePayload: async () => {
      seen.push(['probe'])
      return {
        servers: [{
          name: 'node-0',
          online: true,
          daily_traffic: [{ date: '2026-08-21', uplink: 1, downlink: 2, total: 3 }],
          traffic_used_up: 1,
          traffic_used_down: 2,
          traffic_used_total: 3,
          period_start: '2026-08-01T00:00:00.000Z',
          period_end: '2026-09-01T00:00:00.000Z',
        }],
      } as ProbePayload
    },
    getSeriesPayload: async (query: SeriesQuery) => {
      seen.push(['series', query])
      return { pings: [], systems: [] }
    },
  } as Partial<KomariDataService>), async (baseUrl) => {
    const probe = await request(baseUrl, '/api/probe')
    assert.equal(probe.status, 200)
    assertJsonHeaders(probe)
    assert.deepEqual(probe.body, {
      servers: [{
        name: 'node-0',
        online: true,
        daily_traffic: [{ date: '2026-08-21', uplink: 1, downlink: 2, total: 3 }],
        traffic_used_up: 1,
        traffic_used_down: 2,
        traffic_used_total: 3,
        period_start: '2026-08-01T00:00:00.000Z',
        period_end: '2026-09-01T00:00:00.000Z',
      }],
    })

    const series = await request(baseUrl, '/api/series?hours=24&metric=system')
    assert.equal(series.status, 200)
    assert.deepEqual(series.body, { pings: [], systems: [] })
    assert.deepEqual(seen, [
      ['probe'],
      ['series', { hours: '24', metric: 'system' }],
    ])
  })
})

test('API routes return ping and load history with validated UUIDs', async () => {
  const seen: unknown[] = []
  await withApi(fakeService({
    getPingHistory: async (query: unknown) => {
      seen.push(['ping', query])
      return { count: 0, records: [], tasks: [], basic_info: { clients: [] } }
    },
    getLoadHistory: async (uuid: string, query: unknown) => {
      seen.push(['load', uuid, query])
      return { count: 0, records: [] }
    },
  } as Partial<KomariDataService>), async (baseUrl) => {
    const ping = await request(baseUrl, '/api/records/ping?hours=1')
    assert.equal(ping.status, 200)
    assert.deepEqual(ping.body, { count: 0, records: [], tasks: [], basic_info: { clients: [] } })

    const load = await request(baseUrl, '/api/records/load?uuid=mmwx-0&hours=1')
    assert.equal(load.status, 200)
    assert.deepEqual(load.body, { count: 0, records: [] })

    const invalid = await request(baseUrl, '/api/records/load?uuid=evil&hours=1')
    assert.equal(invalid.status, 400)
    assert.deepEqual(seen, [
      ['ping', { hours: '1' }],
      ['load', 'mmwx-0', { uuid: 'mmwx-0', hours: '1' }],
    ])
  })
})

test('Komari load history requests system metrics from the MMWX series API', async () => {
  const seen: SeriesQuery[] = []
  const service = new KomariDataService({
    fetchProbe: async () => ({ servers: [] }),
    fetchSeries: async (query: SeriesQuery) => {
      seen.push(query)
      return {
        success: true,
        bucket_sec: 300,
        generated_at: 1787313000,
        series: {
          cpu_pct: [{ t: 1787312700, value: 12 }],
          mem_used: [{ t: 1787312700, value: 34 }],
          upload_speed: [{ t: 1787312700, value: 56 }],
          download_speed: [{ t: 1787312700, value: 78 }],
        },
      }
    },
  }, 1000)

  const history = await service.getLoadHistory('mmwx-0', { uuid: 'mmwx-0', hours: '24' })

  assert.deepEqual(seen, [{ server: '0', range: '24h', metric: 'system' }])
  assert.deepEqual(history.records, [{
    client: 'mmwx-0',
    time: '2026-08-21T11:45:00.000Z',
    cpu: 12,
    ram: 34,
    net_out: 56,
    net_in: 78,
  }])
})

test('Komari ping history uses latency and loss points from the MMWX series API', async () => {
  const seen: SeriesQuery[] = []
  const service = new KomariDataService({
    fetchProbe: async () => ({ servers: [{ name: 'node-0' }, { name: 'node-1' }] }),
    fetchSeries: async (query: SeriesQuery) => {
      seen.push(query)
      return {
        success: true,
        bucket_sec: 300,
        generated_at: 1787313000,
        all_series: [
          {
            key: 'google',
            label: 'Google',
            buckets: [{ ms: 10, loss: 0 }, { ms: 11, loss: 1 }],
          },
          {
            key: 'cloudflare',
            label: 'Cloudflare',
            buckets: [{ ms: 20, loss: 2 }, { ms: null, loss: 100 }],
          },
        ],
      }
    },
  }, 1000)

  const history = await service.getPingHistory({ uuid: 'mmwx-0', task_id: '0', hours: '24' })

  assert.deepEqual(seen, [{ server: '0', range: '24h', all: '1' }])
  assert.deepEqual(history, {
    count: 4,
    records: [
      { task_id: 0, time: '2026-08-21T11:45:00.000Z', value: 10, loss: 0, client: 'mmwx-0' },
      { task_id: 1, time: '2026-08-21T11:45:00.000Z', value: 20, loss: 2, client: 'mmwx-0' },
      { task_id: 0, time: '2026-08-21T11:50:00.000Z', value: 11, loss: 1, client: 'mmwx-0' },
      { task_id: 1, time: '2026-08-21T11:50:00.000Z', value: null, loss: 100, client: 'mmwx-0' },
    ],
    tasks: [
      { id: 0, name: 'Google', clients: ['mmwx-0'], default_on: true, type: 'icmp', interval: 30 },
      { id: 1, name: 'Cloudflare', clients: ['mmwx-0'], default_on: true, type: 'icmp', interval: 30 },
    ],
    basic_info: { clients: ['mmwx-0'] },
  })
})

test('API routes reject unsupported methods, unknown API paths, and upstream failures as JSON', async () => {
  await withApi(fakeService({
    getSnapshot: async () => {
      throw Object.assign(new Error('upstream failed'), { statusCode: 502 })
    },
  }), async (baseUrl) => {
    const method = await request(baseUrl, '/api/nodes', { method: 'POST' })
    assert.equal(method.status, 405)
    assertJsonHeaders(method)

    const unknown = await request(baseUrl, '/api/unknown')
    assert.equal(unknown.status, 404)
    assertJsonHeaders(unknown)

    const upstream = await request(baseUrl, '/api/nodes')
    assert.equal(upstream.status, 502)
    assertJsonHeaders(upstream)
    assert.deepEqual(upstream.body, { status: 'error', message: 'upstream failed', data: null })
  })
})

test('RPC2 supports read-only public methods and rejects unknown or mutating methods', async () => {
  await withApi(fakeService(), async (baseUrl) => {
    const nodes = await request(baseUrl, '/api/rpc2', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nodes.list' }),
    })
    assert.equal(nodes.status, 200)
    assert.deepEqual(nodes.body, { jsonrpc: '2.0', id: 1, result: [{ uuid: 'mmwx-0', name: 'node-0', online: true }] })

    const ping = await request(baseUrl, '/api/rpc2', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'records.ping', params: { hours: 1 } }),
    })
    assert.equal(ping.status, 200)
    assert.equal((ping.body as { result?: { count?: number } }).result?.count, 1)

    const unknown = await request(baseUrl, '/api/rpc2', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'admin.deleteNode' }),
    })
    assert.equal(unknown.status, 200)
    assert.deepEqual(unknown.body, { jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'Method not found' } })
  })
})
