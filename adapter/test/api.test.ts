import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import { test } from 'node:test'

import { createApiRouter } from '../src/http/api.js'
import type { KomariDataService } from '../src/komari/service.js'

interface TestResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: unknown
}

function fakeService(overrides: Partial<KomariDataService> = {}): KomariDataService {
  return {
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
  } as KomariDataService
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
