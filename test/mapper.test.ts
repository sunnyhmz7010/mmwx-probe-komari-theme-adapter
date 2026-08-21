import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProbePayload, ProbeSeriesPayload, ProbeServer } from '../src/mmwx/types.js'
import { toKomariNode, toKomariRecord, toLoadHistory, toPingHistory } from '../src/komari/mapper.js'
import { KomariDataService } from '../src/komari/service.js'

const now = new Date('2026-08-21T00:00:00.000Z')

function server(overrides: Partial<ProbeServer> = {}): ProbeServer {
  return {
    name: 'Tokyo',
    country: 'JP',
    region: 'Asia',
    online: true,
    cpu: '12.5',
    memory: 2048,
    load: ['0.1', '0.2', '0.3'],
    upload: 10,
    download: 20,
    uplink: 100,
    downlink: 200,
    totalUpload: 1000,
    totalDownload: 2000,
    trafficPeriod: 'monthly',
    ping: [
      { name: 'Google', value: 25, loss: 0 },
      { name: 'Cloudflare', value: null, loss: 100 },
    ],
    ...overrides,
  }
}

test('maps stable node UUIDs and metrics with location fallback', () => {
  const node = toKomariNode(server({ country: undefined, region: 'EU' }), 1)

  assert.equal(node.uuid, 'mmwx-1')
  assert.equal(node.name, 'Tokyo')
  assert.equal(node.online, true)
  assert.equal(node.region, 'EU')
  assert.equal(node.cpu, 12.5)
  assert.equal(node.memory, 2048)
  assert.equal(node.network?.up, 10)
  assert.equal(node.network?.down, 20)
  assert.equal(node.network?.totalUp, 1000)
  assert.equal(node.network?.totalDown, 2000)
  assert.deepEqual(node.load, { load1: 0.1, load5: 0.2, load15: 0.3 })
  assert.equal(node.traffic_period, 'monthly')
})

test('uses country when region is unavailable and filters invalid numbers', () => {
  const node = toKomariNode(server({
    country: 'US',
    region: undefined,
    cpu: 'not-a-number',
    load: ['1', 'NaN', 'Infinity'],
    upload: 'bad',
  }), 0)

  assert.equal(node.region, 'US')
  assert.equal('cpu' in node, false)
  assert.deepEqual(node.load, { load1: 1 })
  assert.equal(node.network?.up, undefined)
})

test('maps realtime records and preserves offline state', () => {
  const record = toKomariRecord(server({ online: false, memory: undefined }), 0, now)

  assert.equal(record.uuid, 'mmwx-0')
  assert.equal(record.online, false)
  assert.deepEqual(record.cpu, { usage: 12.5 })
  assert.equal(record.ram, undefined)
  assert.deepEqual(record.network, { up: 10, down: 20, totalUp: 1000, totalDown: 2000, uplink: 100, downlink: 200 })
  assert.equal(record.updated_at, now.toISOString())
})

test('builds ping tasks and preserves null for unavailable buckets', () => {
  const history = toPingHistory([server()], now)

  assert.equal(history.count, 2)
  assert.deepEqual(history.records[0], {
    task_id: 0,
    time: now.toISOString(),
    value: 25,
    client: 'mmwx-0',
  })
  assert.deepEqual(history.records[1], {
    task_id: 1,
    time: now.toISOString(),
    value: null,
    client: 'mmwx-0',
  })
  assert.deepEqual(history.tasks, [
    { id: 0, name: 'Google', clients: ['mmwx-0'], default_on: true, type: 'icmp', interval: 30 },
    { id: 1, name: 'Cloudflare', clients: ['mmwx-0'], default_on: true, type: 'icmp', interval: 30 },
  ])
})

test('maps load history in timestamp order and omits invalid values', () => {
  const history = toLoadHistory({
    serverId: 0,
    points: [
      { timestamp: '2026-08-21T00:02:00.000Z', cpu: '2', memory: '20', load: ['0.2'], upload: '3', download: '4' },
      { timestamp: '2026-08-21T00:01:00.000Z', cpu: 'bad', memory: null, load: 0.5, upload: Infinity, download: '6' },
    ],
  })

  assert.deepEqual(history.records, [
    { client: 'mmwx-0', time: '2026-08-21T00:01:00.000Z', load: 0.5, net_in: 6 },
    { client: 'mmwx-0', time: '2026-08-21T00:02:00.000Z', cpu: 2, ram: 20, load: 0.2, net_out: 3, net_in: 4 },
  ])
  assert.equal(history.count, 2)
})

test('caches snapshots, deduplicates concurrent requests, and serves a short stale fallback', async () => {
  let calls = 0
  let shouldFail = false
  const payload: ProbePayload = { servers: [server()] }
  const client = {
    fetchProbe: async () => {
      calls += 1
      if (shouldFail) throw new Error('upstream unavailable')
      await new Promise((resolve) => setTimeout(resolve, 5))
      return payload
    },
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({ systems: [] }),
  }
  const service = new KomariDataService(client, 20)

  const [first, second] = await Promise.all([service.getSnapshot(), service.getSnapshot()])
  assert.equal(calls, 1)
  assert.equal(first.nodes[0].uuid, 'mmwx-0')
  assert.deepEqual(second, first)

  await new Promise((resolve) => setTimeout(resolve, 25))
  shouldFail = true
  const stale = await service.getSnapshot()
  assert.deepEqual(stale, first)
  assert.equal(calls, 2)

  await new Promise((resolve) => setTimeout(resolve, 25))
  await assert.rejects(() => service.getSnapshot(), (error: unknown) => (
    error instanceof Error
      && (error as { statusCode?: number }).statusCode === 502
  ))
})

test('serves ping history from the cached probe snapshot without dropping buckets', async () => {
  const client = {
    fetchProbe: async () => ({ servers: [server()] }),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({ systems: [] }),
  }
  const service = new KomariDataService(client, 1000)

  const history = await service.getPingHistory({ hours: 1 })

  assert.equal(history.count, 2)
  assert.equal(history.records[0].value, 25)
  assert.equal(history.records[1].value, null)
  assert.deepEqual(history.tasks.map((task) => task.name), ['Google', 'Cloudflare'])
})

test('caches series by normalized query key and resolves the requested node history', async () => {
  let calls = 0
  const client = {
    fetchProbe: async () => ({ servers: [] }),
    fetchSeries: async (query: Record<string, unknown>) => {
      calls += 1
      return {
        systems: [{
          serverId: query.uuid === 'mmwx-1' ? 1 : 0,
          points: [{ timestamp: '2026-08-21T00:00:00.000Z', cpu: 3 }],
        }],
      }
    },
  }
  const service = new KomariDataService(client, 1000)

  const first = await service.getLoadHistory('mmwx-1', { hours: 1, load_type: 'cpu' })
  const second = await service.getLoadHistory('mmwx-1', { load_type: 'cpu', hours: 1 })

  assert.equal(calls, 1)
  assert.deepEqual(first, second)
  assert.deepEqual(first.records[0], { client: 'mmwx-1', time: '2026-08-21T00:00:00.000Z', cpu: 3 })
})
