import type { MmwxMetricPoint, MmwxProbeSeries, MmwxSystemMetricSeries, MmwxSystemSeries, MmwxSystemSeriesPoint, ProbeBucket, ProbePingSeries, ProbeSeriesPayload, ProbeServer } from '../mmwx/types.js'
import type { KomariLoad, KomariNetwork, KomariNode, KomariRecord, LoadHistory, LoadHistoryRecord, PingHistory, PingTask } from './types.js'

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

function firstFinite(values: readonly unknown[]): number | undefined {
  for (const value of values) {
    const numeric = numberOrUndefined(value)
    if (numeric !== undefined) return numeric
  }
  return undefined
}

function loadAverage(value: ProbeServer['load'] | ProbeServer['loadavg'] | MmwxSystemSeriesPoint['load']): KomariLoad | undefined {
  const load: KomariLoad = {}
  if (Array.isArray(value)) {
    const [load1, load5, load15] = value.map(numberOrUndefined)
    if (load1 !== undefined) load.load1 = load1
    if (load5 !== undefined) load.load5 = load5
    if (load15 !== undefined) load.load15 = load15
  } else if (typeof value === 'string' && value.trim().includes(' ')) {
    const [load1, load5, load15] = value.trim().split(/\s+/).map(numberOrUndefined)
    if (load1 !== undefined) load.load1 = load1
    if (load5 !== undefined) load.load5 = load5
    if (load15 !== undefined) load.load15 = load15
  } else {
    const load1 = numberOrUndefined(value)
    if (load1 !== undefined) load.load1 = load1
  }
  return Object.keys(load).length > 0 ? load : undefined
}

function network(server: ProbeServer): KomariNetwork | undefined {
  const result: KomariNetwork = {}
  const up = firstFinite([server.upload, server.upload_speed])
  const down = firstFinite([server.download, server.download_speed])
  const totalUp = firstFinite([server.totalUpload, server.traffic_used_up])
  const totalDown = firstFinite([server.totalDownload, server.traffic_used_down])
  const total = numberOrUndefined(server.traffic_used_total)
  const uplink = numberOrUndefined(server.uplink)
  const downlink = numberOrUndefined(server.downlink)
  if (up !== undefined) result.up = up
  if (down !== undefined) result.down = down
  if (totalUp !== undefined) result.totalUp = totalUp
  if (totalDown !== undefined) result.totalDown = totalDown
  if (total !== undefined) result.total = total
  if (uplink !== undefined) result.uplink = uplink
  if (downlink !== undefined) result.downlink = downlink
  return Object.keys(result).length > 0 ? result : undefined
}

function resource(used: unknown, total: unknown): { used?: number; total?: number } | undefined {
  const result: { used?: number; total?: number } = {}
  const usedValue = numberOrUndefined(used)
  const totalValue = numberOrUndefined(total)
  if (usedValue !== undefined) result.used = usedValue
  if (totalValue !== undefined) result.total = totalValue
  return Object.keys(result).length > 0 ? result : undefined
}

function trafficPeriod(server: ProbeServer): string | undefined {
  const explicit = server.trafficPeriod?.trim()
  if (explicit) return explicit
  if (server.period_start && server.period_end) return `${server.period_start}/${server.period_end}`
  return undefined
}

function nodeName(server: ProbeServer, index: number): string {
  return server.name?.trim() || server.host?.trim() || `MMWX Node ${index + 1}`
}

export function toKomariNode(server: ProbeServer, index: number): KomariNode {
  const node: KomariNode = {
    uuid: `mmwx-${index}`,
    name: nodeName(server, index),
    online: server.online !== false,
  }
  const region = server.region?.trim() || server.country?.trim()
  const cpu = firstFinite([server.cpu, server.cpu_pct])
  const memory = firstFinite([server.memory, server.mem_used])
  const ram = resource(firstFinite([server.memory, server.mem_used]), server.mem_total)
  const disk = resource(server.disk_used, server.disk_total)
  const load = loadAverage(server.load ?? server.loadavg)
  const mappedNetwork = network(server)
  if (region) node.region = region
  if (cpu !== undefined) node.cpu = cpu
  if (memory !== undefined) node.memory = memory
  if (ram) node.ram = ram
  if (disk) node.disk = disk
  if (load) node.load = load
  if (mappedNetwork) node.network = mappedNetwork
  const mappedTrafficPeriod = trafficPeriod(server)
  if (mappedTrafficPeriod) node.traffic_period = mappedTrafficPeriod
  return node
}

export function toKomariRecord(server: ProbeServer, index: number, now: Date): KomariRecord {
  const record: KomariRecord = {
    uuid: `mmwx-${index}`,
    online: server.online !== false,
    updated_at: now.toISOString(),
  }
  const cpu = firstFinite([server.cpu, server.cpu_pct])
  const ram = resource(firstFinite([server.memory, server.mem_used]), server.mem_total)
  const disk = resource(server.disk_used, server.disk_total)
  const load = loadAverage(server.load ?? server.loadavg)
  const mappedNetwork = network(server)
  if (cpu !== undefined) record.cpu = { usage: cpu }
  if (ram) record.ram = ram
  if (disk) record.disk = disk
  if (load) record.load = load
  if (mappedNetwork) record.network = mappedNetwork
  return record
}

function bucketValue(bucket: ProbeBucket): number | null {
  return firstFinite([bucket.value, bucket.latency, bucket.current_ms]) ?? null
}

export function toPingHistory(servers: ProbeServer[], now: Date): PingHistory {
  const tasksByName = new Map<string, PingTask>()
  const records = servers.flatMap((server, index) => {
    const client = `mmwx-${index}`
    return (server.ping ?? []).map((bucket) => {
      const name = bucket.name?.trim() || bucket.label?.trim() || bucket.key?.trim() || `Ping ${tasksByName.size + 1}`
      let task = tasksByName.get(name)
      if (!task) {
        task = { id: tasksByName.size, name, clients: [], default_on: true, type: 'icmp', interval: 30 }
        tasksByName.set(name, task)
      }
      if (!task.clients.includes(client)) task.clients.push(client)
      return {
        task_id: task.id,
        time: now.toISOString(),
        value: bucketValue(bucket),
        client,
      }
    })
  })

  return {
    count: records.length,
    records,
    tasks: [...tasksByName.values()],
    basic_info: { clients: servers.map((_, index) => `mmwx-${index}`) },
  }
}

export function toPingSeriesHistory(payload: ProbeSeriesPayload, serverIndexValue = 0): PingHistory {
  if (payload.all_series || payload.series) {
    return toMmwxProbePingHistory(payload, serverIndexValue)
  }
  return toLegacyPingSeriesHistory(payload.pings ?? [])
}

function toLegacyPingSeriesHistory(pings: readonly ProbePingSeries[]): PingHistory {
  const tasksByName = new Map<string, PingTask>()
  const clients = new Set<string>()
  const records = pings.flatMap((series) => {
    const client = `mmwx-${serverIndex(series.serverId)}`
    clients.add(client)
    const name = series.route?.trim() || `Ping ${tasksByName.size + 1}`
    let task = tasksByName.get(name)
    if (!task) {
      task = { id: tasksByName.size, name, clients: [], default_on: true, type: 'icmp', interval: 30 }
      tasksByName.set(name, task)
    }
    if (!task.clients.includes(client)) task.clients.push(client)
    return series.points.map((point) => ({
      task_id: task.id,
      time: new Date(point.timestamp).toISOString(),
      value: firstFinite([point.value]) ?? null,
      loss: firstFinite([point.loss]) ?? null,
      client,
    }))
  }).sort((left, right) => {
    const timeDiff = new Date(left.time).getTime() - new Date(right.time).getTime()
    if (timeDiff !== 0) return timeDiff
    if (left.task_id !== right.task_id) return left.task_id - right.task_id
    return left.client.localeCompare(right.client)
  })

  return {
    count: records.length,
    records,
    tasks: [...tasksByName.values()],
    basic_info: { clients: [...clients].sort() },
  }
}

function toMmwxProbePingHistory(payload: ProbeSeriesPayload, serverIndexValue: number): PingHistory {
  const bucketSec = numberOrUndefined(payload.bucket_sec) ?? 300
  const generatedAt = numberOrUndefined(payload.generated_at) ?? Math.floor(Date.now() / 1000)
  const series = payload.all_series ?? (isProbeSeries(payload.series) ? [payload.series] : [])
  const client = `mmwx-${serverIndexValue}`
  const tasks = series.map((item, index): PingTask => ({
    id: index,
    name: item.label?.trim() || item.key?.trim() || `Ping ${index + 1}`,
    clients: [client],
    default_on: true,
    type: 'icmp',
    interval: 30,
  }))
  const maxBuckets = Math.max(0, ...series.map((item) => item.buckets?.length ?? 0))
  const baseTime = generatedAt - (generatedAt % bucketSec)
  const records = series.flatMap((item, taskId) => (item.buckets ?? []).map((bucket, index) => ({
    task_id: taskId,
    time: new Date((baseTime - (maxBuckets - 1 - index) * bucketSec) * 1000).toISOString(),
    value: numberOrUndefined(bucket.ms) ?? null,
    loss: numberOrUndefined(bucket.loss) ?? null,
    client,
  }))).sort((left, right) => {
    const timeDiff = new Date(left.time).getTime() - new Date(right.time).getTime()
    if (timeDiff !== 0) return timeDiff
    return left.task_id - right.task_id
  })

  return {
    count: records.length,
    records,
    tasks,
    basic_info: { clients: [client] },
  }
}

function serverIndex(serverId: string | number | undefined): number {
  const numeric = numberOrUndefined(serverId)
  return numeric !== undefined && numeric >= 0 ? Math.trunc(numeric) : 0
}

export function toLoadHistory(series: MmwxSystemSeries): LoadHistory {
  const client = `mmwx-${serverIndex(series.serverId)}`
  const records = series.points
    .map((point): LoadHistoryRecord => {
      const record: LoadHistoryRecord = { client, time: new Date(point.timestamp).toISOString() }
      const cpu = numberOrUndefined(point.cpu)
      const ram = numberOrUndefined(point.memory)
      const load = loadAverage(point.load)?.load1
      const netOut = numberOrUndefined(point.upload)
      const netIn = numberOrUndefined(point.download)
      if (cpu !== undefined) record.cpu = cpu
      if (ram !== undefined) record.ram = ram
      if (load !== undefined) record.load = load
      if (netOut !== undefined) record.net_out = netOut
      if (netIn !== undefined) record.net_in = netIn
      return record
    })
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  return { count: records.length, records }
}

export function toSystemMetricHistory(series: MmwxSystemMetricSeries, serverIndexValue: number): LoadHistory {
  const byTime = new Map<number, LoadHistoryRecord>()
  const applyMetric = (points: readonly MmwxMetricPoint[] | undefined, assign: (record: LoadHistoryRecord, value: number) => void): void => {
    for (const point of points ?? []) {
      const timestamp = metricTimestamp(point)
      const value = numberOrUndefined(point.value)
      if (timestamp === undefined || value === undefined) continue
      const existing = byTime.get(timestamp) ?? { client: `mmwx-${serverIndexValue}`, time: new Date(timestamp * 1000).toISOString() }
      assign(existing, value)
      byTime.set(timestamp, existing)
    }
  }

  applyMetric(series.cpu_pct, (record, value) => { record.cpu = value })
  applyMetric(series.mem_used, (record, value) => { record.ram = value })
  applyMetric(series.load1 ?? series.load, (record, value) => { record.load = value })
  applyMetric(series.upload_speed ?? series.traffic_up, (record, value) => { record.net_out = value })
  applyMetric(series.download_speed ?? series.traffic_down, (record, value) => { record.net_in = value })

  const records = [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, record]) => record)
  return { count: records.length, records }
}

function metricTimestamp(point: MmwxMetricPoint): number | undefined {
  const raw = point.t ?? point.timestamp
  const numeric = numberOrUndefined(raw)
  if (numeric !== undefined) return Math.trunc(numeric)
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return Math.trunc(parsed / 1000)
  }
  return undefined
}

function isProbeSeries(value: unknown): value is MmwxProbeSeries {
  return typeof value === 'object' && value !== null && Array.isArray((value as { buckets?: unknown }).buckets)
}
