import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProbePayload, ProbeSeriesPayload, ProbeServer } from '../src/mmwx/types.js'
import { ProbeHistoryBuffer } from '../src/mmwx/history-buffer.js'
import { KomariDataService } from '../src/komari/service.js'

const T0 = Date.parse('2026-08-27T10:00:00.000Z')

function frame(atMs: number, overrides: Partial<ProbeServer> = {}): { payload: ProbePayload; at: Date } {
  return {
    payload: {
      servers: [{
        name: 'Tokyo',
        online: true,
        cpu: 12.5,
        memory: 2048,
        mem_total: 4096,
        load: ['0.1', '0.2', '0.3'],
        upload: 10,
        download: 20,
        net_total_up: 1000,
        net_total_down: 2000,
        ping: [
          { name: 'Google', value: 25, loss: 0 },
          { name: 'Cloudflare', latency: 3.5, loss_pct: 100 },
        ],
        ...overrides,
      }],
    },
    at: new Date(atMs),
  }
}

test('ingests realtime frames into per-frame load and ping samples', () => {
  const buffer = new ProbeHistoryBuffer()
  const first = frame(T0)
  const second = frame(T0 + 3000, { cpu: 30, ping: [{ name: 'Google', value: 40, loss: 0 }] })
  buffer.ingest(first.payload, first.at)
  buffer.ingest(second.payload, second.at)

  const load = buffer.snapshotLoad(0)
  assert.equal(load.length, 2)
  assert.equal(load[0].t, T0)
  assert.equal(load[0].cpu, 12.5)
  assert.equal(load[1].cpu, 30)
  assert.equal(load[0].net_total_up, 1000)

  const ping = buffer.snapshotPing(0)
  assert.deepEqual([...ping.keys()], ['Google', 'Cloudflare'])
  assert.equal(ping.get('Google')?.length, 2)
  assert.equal(ping.get('Google')?.[1].value, 40)
  // 无 value 的线路回退 latency/current_ms，loss_pct 回退为 loss。
  assert.equal(ping.get('Cloudflare')?.[0].value, 3.5)
  assert.equal(ping.get('Cloudflare')?.[0].loss, 100)
})

test('covers duplicate frames within the same second and offline nodes', () => {
  const buffer = new ProbeHistoryBuffer()
  const first = frame(T0)
  buffer.ingest(first.payload, first.at)
  // 同一秒重复帧（WS 与 HTTP 快照同源）覆盖，不产生重复样本。
  const duplicate = frame(T0, { cpu: 99 })
  buffer.ingest(duplicate.payload, duplicate.at)
  assert.equal(buffer.snapshotLoad(0).length, 1)
  assert.equal(buffer.snapshotLoad(0)[0].cpu, 99)

  // 离线节点的帧字段是残值，不记为新样本。
  const offline = frame(T0 + 6000, { online: false })
  buffer.ingest(offline.payload, offline.at)
  assert.equal(buffer.snapshotLoad(0).length, 1)
})

test('demotes stale frames to the cold layer and drops points beyond the window', () => {
  const buffer = new ProbeHistoryBuffer()
  const stale = frame(T0)
  buffer.ingest(stale.payload, stale.at)
  // 超过热层窗口的帧降级为分钟粒度，但仍在可查询窗口内。
  const recent = frame(T0 + 2 * 60 * 60 * 1000)
  buffer.ingest(recent.payload, recent.at)
  let load = buffer.snapshotLoad(0)
  assert.equal(load.length, 2)
  assert.equal(load[0].t, T0)

  // 超出 25 小时总窗口的点被裁剪。
  const expired = frame(T0 + 26 * 60 * 60 * 1000)
  buffer.ingest(expired.payload, expired.at)
  load = buffer.snapshotLoad(0)
  assert.ok(!load.some((point) => point.t === T0))
})

test('merges buffered ping samples over aggregated series with buffer precedence', async () => {
  const buffer = new ProbeHistoryBuffer()
  const baseSeconds = Math.floor(T0 / 1000)
  const client = {
    fetchProbe: async () => ({ servers: [] }),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({
      bucket_sec: 300,
      generated_at: baseSeconds,
      all_series: [
        { key: 'google', label: 'Google', buckets: [{ ms: 25, loss: 0 }] },
        { key: 'cloudflare', label: 'Cloudflare', buckets: [{ ms: 3, loss: 0 }] },
      ],
    }),
  }
  const service = new KomariDataService(client, undefined, buffer)

  // 缓冲样本与聚合桶同一时刻，逐帧值应优先于桶值。
  const buffered = frame(baseSeconds * 1000, {
    ping: [{ name: 'Google', value: 30, loss: 0 }],
  })
  buffer.ingest(buffered.payload, buffered.at)

  const history = await service.getPingHistory({ uuid: 'mmwx-0', hours: 1 })
  assert.equal(history.count, 2)
  const google = history.records.find((record) => record.time === new Date(baseSeconds * 1000).toISOString())
  assert.equal(google?.value, 30)
  assert.equal(google?.client, 'mmwx-0')
  // 聚合桶填补缓冲未覆盖的线路。
  assert.deepEqual(history.tasks.map((task) => task.name).sort(), ['Cloudflare', 'Google'])
})

test('merges buffered load samples over aggregated series with buffer precedence', async () => {
  const buffer = new ProbeHistoryBuffer()
  const client = {
    fetchProbe: async () => ({ servers: [] }),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({
      systems: [{
        serverId: 0,
        points: [{ timestamp: T0, cpu: 1, memory: 111 }],
      }],
    }),
  }
  const service = new KomariDataService(client, undefined, buffer)

  const buffered = frame(T0, { cpu: 9, memory: 55 })
  buffer.ingest(buffered.payload, buffered.at)
  const later = frame(T0 + 60_000)
  buffer.ingest(later.payload, later.at)

  const history = await service.getLoadHistory('mmwx-0', { hours: 1 })
  assert.equal(history.count, 2)
  assert.equal(history.records[0].cpu, 9)
  assert.equal(history.records[0].ram, 55)
  assert.equal(history.records[0].mem_total, 4096)
  assert.equal(history.records[0].client, 'mmwx-0')
  assert.equal(history.records[1].cpu, 12.5)
})
