import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProbePayload, ProbeSeriesPayload, ProbeServer } from '../src/mmwx/types.js'
import { toKomariNode, toKomariPublicNodes, toKomariRecord, toLoadHistory, toPingHistory, toSystemMetricHistory } from '../src/komari/mapper.js'
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

test('maps current metrics from real MMWX probe fields', () => {
  const mmwxServer = server({
    cpu: undefined,
    memory: undefined,
    load: undefined,
    upload: undefined,
    download: undefined,
    uplink: undefined,
    downlink: undefined,
    totalUpload: undefined,
    totalDownload: undefined,
    trafficPeriod: undefined,
    cpu_pct: '3.5',
    loadavg: '0.07 0.09 0.11 1/149 1261978',
    mem_used: '388132864',
    mem_total: '1004605440',
    disk_used: '7899017216',
    disk_total: '20922114048',
    upload_speed: '2024',
    download_speed: '1802',
    traffic_used_up: '123',
    traffic_used_down: '456',
    traffic_used_total: '579',
    period_start: '2026-08-04',
    period_end: '2026-09-04',
  })

  const node = toKomariNode(mmwxServer, 0)
  const record = toKomariRecord(mmwxServer, 0, now)

  assert.equal(node.cpu, 3.5)
  assert.equal(node.memory, 388132864)
  assert.deepEqual(node.load, { load1: 0.07, load5: 0.09, load15: 0.11 })
  assert.deepEqual(node.network, {
    up: 2024,
    down: 1802,
    totalUp: 123,
    totalDown: 456,
    total: 579,
  })
  assert.deepEqual(node.ram, { used: 388132864, total: 1004605440 })
  assert.deepEqual(node.disk, { used: 7899017216, total: 20922114048 })
  assert.equal(node.traffic_period, '2026-08-04/2026-09-04')
  assert.deepEqual(record.cpu, { usage: 3.5 })
  assert.deepEqual(record.ram, { used: 388132864, total: 1004605440 })
  assert.deepEqual(record.load, { load1: 0.07, load5: 0.09, load15: 0.11 })
  assert.deepEqual(record.network, {
    up: 2024,
    down: 1802,
    totalUp: 123,
    totalDown: 456,
    total: 579,
  })
  assert.deepEqual(record.disk, { used: 7899017216, total: 20922114048 })
})

test('maps public node fallback fields and traffic mode aliases', () => {
  const [node] = toKomariPublicNodes({
    servers: [server({
      cpu_name: undefined,
      cpu_model: 'AMD EPYC 7B13',
      kernel_version: undefined,
      kernel: '6.1.0-34-amd64',
      gpu_name: undefined,
      virtualization: undefined,
      expired_at: undefined,
      expires_at: '2026-09-21T00:00:00.000Z',
      traffic_limit_type: undefined,
      traffic_stats_mode: 'both',
    })],
  })

  assert.equal(node.cpu_name, 'AMD EPYC 7B13')
  assert.equal(node.kernel_version, '6.1.0-34-amd64')
  assert.equal(node.gpu_name, 'None')
  assert.equal(node.virtualization, 'unknown')
  assert.equal(node.expired_at, '2026-09-21T00:00:00.000Z')
  assert.equal(node.traffic_limit_type, 'sum')
})

test('maps system metrics with separate realtime and cumulative network fields', () => {
  const history = toSystemMetricHistory({
    cpu_pct: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 3.5 }],
    mem_used: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 256 }],
    mem_total: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 1024 }],
    swap_used: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 64 }],
    swap_total: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 128 }],
    disk_used: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 10240 }],
    disk_total: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 20480 }],
    load1: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 0.2 }],
    upload_speed: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 12 }],
    download_speed: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 34 }],
    cumulative_up: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 567 }],
    cumulative_down: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 890 }],
    process: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 99 }],
    connections: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 11 }],
    connections_udp: [{ timestamp: '2026-08-21T00:00:00.000Z', value: 2 }],
  }, 0)

  assert.deepEqual(history.records, [{
    client: 'mmwx-0',
    time: '2026-08-21T00:00:00.000Z',
    cpu: 3.5,
    ram: 256,
    mem_total: 1024,
    swap: 64,
    swap_total: 128,
    load: 0.2,
    disk: 10240,
    disk_total: 20480,
    net_out: 12,
    net_in: 34,
    net_total_up: 567,
    net_total_down: 890,
    process: 99,
    connections: 11,
    connections_udp: 2,
  }])
})

test('builds ping tasks and preserves null for unavailable buckets', () => {
  const history = toPingHistory([server()], now)

  assert.equal(history.count, 2)
  assert.deepEqual(history.records[0], {
    task_id: 1,
    time: now.toISOString(),
    value: 25,
    client: 'mmwx-0',
  })
  assert.deepEqual(history.records[1], {
    task_id: 2,
    time: now.toISOString(),
    value: null,
    client: 'mmwx-0',
  })
  assert.deepEqual(history.tasks, [
    { id: 1, name: 'Google', clients: ['mmwx-0'], default_on: true, type: 'icmp', interval: 30 },
    { id: 2, name: 'Cloudflare', clients: ['mmwx-0'], default_on: true, type: 'icmp', interval: 30 },
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
  const service = new KomariDataService(client, 100)

  const [first, second] = await Promise.all([service.getSnapshot(), service.getSnapshot()])
  assert.equal(calls, 1)
  assert.equal(first.nodes[0].uuid, 'mmwx-0')
  assert.deepEqual(second, first)

  await new Promise((resolve) => setTimeout(resolve, 120))
  shouldFail = true
  const stale = await service.getSnapshot()
  assert.deepEqual(stale, first)
  assert.equal(calls, 2)

  await new Promise((resolve) => setTimeout(resolve, 120))
  await assert.rejects(() => service.getSnapshot(), (error: unknown) => (
    error instanceof Error
      && (error as { statusCode?: number }).statusCode === 502
  ))
})

test('serves ping history from cached MMWX series without dropping points', async () => {
  let calls = 0
  const client = {
    fetchProbe: async () => ({ servers: [server()] }),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => {
      calls += 1
      return {
        pings: [
          {
            serverId: 0,
            route: 'Google',
            points: [
              { timestamp: '2026-08-21T00:00:00.000Z', value: 25 },
              { timestamp: '2026-08-21T00:01:00.000Z', value: null, loss: 100 },
            ],
          },
        ],
      }
    },
  }
  const service = new KomariDataService(client, 1000)

  const first = await service.getPingHistory({ hours: 1 })
  const second = await service.getPingHistory({ hours: 1 })

  assert.equal(calls, 1)
  assert.deepEqual(second, first)
  assert.equal(first.count, 2)
  assert.equal(first.records[0].value, 25)
  assert.equal(first.records[1].value, null)
  assert.equal(first.records[1].loss, 100)
  assert.deepEqual(first.tasks.map((task) => task.name), ['Google'])
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

test('wraps raw probe payload into theme-ready envelope with normalized fields', async () => {
  const service = new KomariDataService({
    fetchProbe: async () => ({
      servers: [{
        name: 'node-0',
        host: 'node.example.com',
        cpu_name: 'AMD EPYC 7B13',
        virtualization: 'kvm',
        arch: 'amd64',
        cpu_cores: '2',
        cpu_physical_cores: '4',
        cpu_threads: '8',
        os: 'Debian GNU/Linux 12',
        kernel: '6.1.0-34-amd64',
        region_city: 'Tokyo',
        region_name: 'Kanto',
        region_country: 'JP',
        online: true,
        cpu_pct: '3.5',
        mem_used: '388132864',
        mem_total: '1004605440',
        disk_used: '7899017216',
        disk_total: '20922114048',
        upload_speed: '2024',
        download_speed: '1802',
        traffic_used_up: '123',
        traffic_used_down: '456',
        traffic_used_total: '579',
        traffic_used_scope: 'configured_period',
        traffic_stats_mode: 'both',
        traffic_source: 'system',
        traffic_adjustment: '-12',
        boot_traffic_up: '321',
        boot_traffic_down: '654',
        cumulative_up: '987',
        cumulative_down: '654',
        daily_traffic: [{ date: '2026-08-04T00:00:00Z', uplink: '10', downlink: '20', total: '30' }],
        period_start: '2026-08-04T00:00:00.000Z',
        period_end: '2026-09-04T00:00:00.000Z',
        expires_at: '2026-09-21T00:00:00.000Z',
        renewal_price: '9.5',
        renewal_price_cny: '68',
        renewal_cycle: 'month',
        renewal_currency: 'CNY',
        ping: [{
          key: 'google',
          label: 'Google',
          isp: 'IIJ',
          value: '25',
          loss: '1',
          buckets: [{ ms: '25', loss: '1' }],
        }],
        return_routes: [{
          carrier: 'telecom',
          route_type: 'CMIN',
          tested_at: '2026-08-21T00:00:00.000Z',
        }],
      }],
    } as ProbePayload),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({ systems: [] }),
  }, 1000, { repoUrl: 'https://github.com/vaspike/junimo', ref: 'main', themeTitle: '服务器状态' } as never)

  const payload = await service.getProbePayload()
  const server = payload.servers[0]

  assert.equal(payload.enabled, true)
  assert.equal(payload.show_globe, true)
  assert.equal(payload.show_health_score, true)
  assert.equal(payload.title, '服务器状态')
  assert.deepEqual(payload.appearance, { theme: 'junimo', color_mode: 'light', revision: 'main' })
  assert.equal(server.cpu_model, 'AMD EPYC 7B13')
  assert.equal(server.cpu_cores, 2)
  assert.equal(server.cpu_threads, 8)
  assert.equal(server.cpu_pct, 3.5)
  assert.equal(server.mem_used, 388132864)
  assert.equal(server.daily_traffic?.[0]?.date, '2026-08-04')
  assert.equal(server.period_start, '2026-08-04')
  assert.equal(server.period_end, '2026-09-04')
  assert.equal(server.expires_at, '2026-09-21')
  assert.equal(server.renewal_price_cny, 68)
  assert.equal(server.traffic_adjustment, -12)
  assert.equal(server.traffic_used_total, 579)
  assert.equal(server.ping?.[0]?.current_ms, 25)
  assert.equal(server.ping?.[0]?.loss_pct, 1)
  assert.equal(server.return_routes?.[0]?.route_type, 'CMIN')
})

test('projects public settings from probe snapshot and loaded theme metadata', async () => {
  const themeSettings = { layout: 'paper', accent: 'blue' }
  const service = new KomariDataService({
    fetchProbe: async () => ({
      title: '星穹主控',
      logo: 'https://example.com/logo.png',
      icon: 'https://example.com/favicon.png',
      appearance: { color_mode: 'dark' },
      servers: [server()],
    } as ProbePayload),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({ systems: [] }),
  }, 1000, {
    repoUrl: 'https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism',
    ref: 'main',
    themeSettings,
  } as never)

  const settings = await service.getPublicSettings()

  assert.deepEqual(settings, {
    sitename: '星穹主控',
    description: '已部署支持独立探针访问密钥的妙妙屋 X 主控',
    theme: 'Glassmorphism',
    theme_settings: themeSettings,
    private_site: false,
    record_enabled: true,
    record_preserve_time: 24,
    ping_record_preserve_time: 24,
    custom_head: '<link rel="icon" href="https://example.com/favicon.png"><script>document.title="星穹主控";</script>',
    custom_body: '',
    oauth_enable: false,
    oauth_provider: '',
    disable_password_login: false,
    cors_origin_check_enabled: true,
    visitor_audit_enabled: false,
  })
})

test('keeps header logo separate from browser favicon metadata', async () => {
  const service = new KomariDataService({
    fetchProbe: async () => ({
      logo: 'https://example.com/logo.svg',
      servers: [server()],
    } as ProbePayload),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({ systems: [] }),
  }, 1000, {
    repoUrl: 'https://github.com/Tokinx/komari-theme-emerald',
    ref: 'master',
    themeTitle: '服务器状态',
  } as never)

  const probe = await service.getProbePayload()
  const settings = await service.getPublicSettings()

  assert.equal(probe.title, '服务器状态')
  assert.equal(probe.logo, 'https://example.com/logo.svg')
  assert.equal(probe.icon, undefined)
  assert.equal(settings.sitename, '服务器状态')
  assert.equal(settings.custom_head, '<script>document.title="服务器状态";</script>')
})

test('uses only explicit probe icon for browser favicon metadata', async () => {
  const service = new KomariDataService({
    fetchProbe: async () => ({
      icon: 'https://example.com/icon.svg',
      servers: [server()],
    } as ProbePayload),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({ systems: [] }),
  }, 1000, {
    repoUrl: 'https://github.com/Tokinx/komari-theme-emerald',
    ref: 'master',
    themeTitle: '服务器状态',
  } as never)

  const probe = await service.getProbePayload()
  const settings = await service.getPublicSettings()

  assert.equal(probe.title, '服务器状态')
  assert.equal(probe.logo, undefined)
  assert.equal(probe.icon, 'https://example.com/icon.svg')
  assert.equal(settings.sitename, '服务器状态')
  assert.equal(settings.custom_head, '<link rel="icon" href="https://example.com/icon.svg"><script>document.title="服务器状态";</script>')
})

test('maps ping buckets into Komari metric query series', async () => {
  const service = new KomariDataService({
    fetchProbe: async () => ({ servers: [server()] }),
    fetchSeries: async (query: Record<string, unknown>): Promise<ProbeSeriesPayload> => {
      assert.equal(query.all, '1')
      return {
        bucket_sec: 300,
        generated_at: 1787400000,
        all_series: [
          {
            key: 'google',
            label: 'Google',
            buckets: [
              { ms: 25, loss: 0 },
              { ms: 30, loss: 2 },
            ],
          },
        ],
      }
    },
  }, 1000)

  const metrics = await service.getQueryMetrics({
    entity_id: 'mmwx-0',
    metric_keys: ['ping.latency_ms', 'ping.loss'],
    hours: 1,
  })

  assert.deepEqual(metrics.series.map((item) => [item.metric_key, (item as { tags?: Record<string, string> }).tags]), [
    ['ping.latency_ms', { task_id: '1' }],
    ['ping.loss', { task_id: '1' }],
  ])
  assert.deepEqual(metrics.series[0].points.map((point) => point.value), [25, 30])
  assert.deepEqual(metrics.series[1].points.map((point) => point.value), [0, 2])
})

test('uses current probe values as metric fallback when system history omits available fields', async () => {
  const service = new KomariDataService({
    fetchProbe: async () => ({
      servers: [server({
        disk_used: 10,
        disk_total: 100,
        process: 22,
        connections: 9,
        connections_udp: 3,
      })],
    }),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({
      bucket_sec: 300,
      generated_at: 1787400000,
      series: {
        cpu_pct: [{ timestamp: 1787399700, value: 5 }],
      },
    }),
  }, 1000)

  const metrics = await service.getQueryMetrics({
    entity_id: 'mmwx-0',
    metric_keys: ['disk.used', 'disk.total', 'process.count', 'connections.tcp', 'connections.udp'],
    hours: 1,
  })

  const valueByMetric = Object.fromEntries(metrics.series.map((item) => [item.metric_key, item.points[0]?.value]))
  assert.deepEqual(valueByMetric, {
    'disk.used': 10,
    'disk.total': 100,
    'process.count': 22,
    'connections.tcp': 9,
    'connections.udp': 3,
  })
})

test('derives Junimo homepage ping bindings from available public ping tasks', async () => {
  const service = new KomariDataService({
    fetchProbe: async () => ({ servers: [server()] }),
    fetchSeries: async (): Promise<ProbeSeriesPayload> => ({
      bucket_sec: 300,
      generated_at: 1787400000,
      all_series: [{
        key: 'google',
        label: 'Google',
        buckets: [{ ms: 25, loss: 0 }],
      }],
    }),
  }, 1000, {
    repoUrl: 'https://github.com/vaspike/junimo',
    ref: 'main',
  } as never)

  const settings = await service.getPublicSettings()

  assert.deepEqual(settings.theme_settings, {
    showPingChart: true,
    homepagePingBindings: { '1': ['mmwx-0'] },
  })
})
