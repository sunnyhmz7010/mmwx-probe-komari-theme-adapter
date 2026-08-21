import type { MmwxMetricPoint, MmwxProbeSeries, MmwxSystemMetricSeries, MmwxSystemSeries, MmwxSystemSeriesPoint, ProbeBucket, ProbePingSeries, ProbePayload, ProbeSeriesPayload, ProbeServer } from '../mmwx/types.js'
import type {
  KomariLoad,
  KomariLoadRecord,
  KomariLoadRecords,
  KomariNetwork,
  KomariNode,
  KomariNodeStatus,
  KomariNodeStatusMap,
  KomariPublicNode,
  KomariRecentReport,
  KomariRecord,
  KomariPingRecord,
  KomariPingRecordTask,
  KomariPingRecords,
  LoadHistory,
  LoadHistoryRecord,
  PingHistory,
  PingTask,
} from './types.js'

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
  const totalUp = firstFinite([server.totalUpload, server.net_total_up, server.cumulative_up, server.traffic_used_up])
  const totalDown = firstFinite([server.totalDownload, server.net_total_down, server.cumulative_down, server.traffic_used_down])
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
  applyMetric(series.mem_total, (record, value) => { record.mem_total = value })
  applyMetric(series.swap_used, (record, value) => { record.swap = value })
  applyMetric(series.swap_total, (record, value) => { record.swap_total = value })
  applyMetric(series.disk_used, (record, value) => { record.disk = value })
  applyMetric(series.disk_total, (record, value) => { record.disk_total = value })
  applyMetric(series.upload_speed, (record, value) => { record.net_out = value })
  applyMetric(series.download_speed, (record, value) => { record.net_in = value })
  applyMetric(series.cumulative_up ?? series.traffic_up, (record, value) => { record.net_total_up = value })
  applyMetric(series.cumulative_down ?? series.traffic_down, (record, value) => { record.net_total_down = value })
  applyMetric(series.process, (record, value) => { record.process = value })
  applyMetric(series.connections, (record, value) => { record.connections = value })
  applyMetric(series.connections_udp, (record, value) => { record.connections_udp = value })

  const records = [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, record]) => record)
  return { count: records.length, records }
}

const NEVER_EXPIRES = '0001-01-01T00:00:00.000Z'

function stringOrDefault(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return fallback
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function dateTimeOrDefault(value: unknown, fallback: Date): string {
  if (value === null || value === undefined || value === '') return fallback.toISOString()
  if (typeof value === 'number') {
    const timestamp = value > 1e12 ? value : value * 1000
    return new Date(timestamp).toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback.toISOString()
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) {
      const timestamp = numeric > 1e12 ? numeric : numeric * 1000
      return new Date(timestamp).toISOString()
    }
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return fallback.toISOString()
}

function regionLabel(server: ProbeServer): string {
  return server.region?.trim()
    || server.country?.trim()
    || server.region_country?.trim()
    || server.region_name?.trim()
    || server.region_city?.trim()
    || ''
}

function publicRemark(server: ProbeServer): string | undefined {
  return server.public_remark?.trim()
    || server.provider_name?.trim()
    || server.host?.trim()
    || undefined
}

export function toKomariPublicNodes(payload: ProbePayload, now = new Date()): KomariPublicNode[] {
  return payload.servers.map((server, index) => ({
    uuid: `mmwx-${index}`,
    name: nodeName(server, index),
    cpu_name: stringOrDefault(server.cpu_name ?? server.cpu_model, 'Unknown CPU'),
    virtualization: stringOrDefault(server.virtualization, 'unknown'),
    arch: stringOrDefault(server.arch, 'amd64'),
    cpu_cores: numberOrUndefined(server.cpu_cores) ?? 1,
    cpu_physical_cores: numberOrUndefined(server.cpu_physical_cores) ?? 1,
    os: stringOrDefault(server.os, 'Linux'),
    kernel_version: stringOrDefault(server.kernel_version ?? server.kernel, 'unknown'),
    gpu_name: stringOrDefault(server.gpu_name, 'None'),
    region: regionLabel(server),
    mem_total: numberOrUndefined(server.mem_total) ?? 0,
    swap_total: numberOrUndefined(server.swap_total) ?? 0,
    disk_total: numberOrUndefined(server.disk_total) ?? 0,
    weight: numberOrUndefined(server.weight) ?? 0,
    price: numberOrUndefined(server.price) ?? 0,
    billing_cycle: numberOrUndefined(server.billing_cycle) ?? 30,
    auto_renewal: boolOrDefault(server.auto_renewal, false),
    currency: stringOrDefault(server.currency, '$'),
    expired_at: isEmptyDateValue(server.expired_at ?? server.expires_at)
      ? NEVER_EXPIRES
      : dateTimeOrDefault(server.expired_at ?? server.expires_at, new Date(0)),
    group: stringOrDefault(server.group, ''),
    tags: stringOrDefault(server.tags, ''),
    hidden: boolOrDefault(server.hidden, false),
    traffic_limit: numberOrUndefined(server.traffic_limit) ?? 0,
    traffic_limit_type: trafficLimitType(server),
    created_at: dateTimeOrDefault(server.created_at, now),
    updated_at: dateTimeOrDefault(server.updated_at, now),
    public_remark: publicRemark(server),
  }))
}

function trafficLimitType(server: ProbeServer): string {
  const raw = stringOrDefault(server.traffic_limit_type ?? server.traffic_stats_mode, 'max').toLowerCase()
  if (raw === 'both') return 'sum'
  if (raw === 'upload') return 'up'
  if (raw === 'download') return 'down'
  return raw || 'max'
}

function isEmptyDateValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

export function toKomariNodeStatusMap(payload: ProbePayload, now = new Date()): KomariNodeStatusMap {
  return Object.fromEntries(payload.servers.map((server, index) => [ `mmwx-${index}`, toKomariNodeStatus(server, index, now) ]))
}

export function toKomariNodeStatus(server: ProbeServer, index: number, now = new Date()): KomariNodeStatus {
  const load = loadAverage(server.load ?? server.loadavg)
  const status: KomariNodeStatus = {
    client: `mmwx-${index}`,
    time: dateTimeOrDefault(server.updated_at, now),
    cpu: firstFinite([server.cpu, server.cpu_pct]) ?? 0,
    gpu: numberOrUndefined(server.gpu) ?? 0,
    ram: firstFinite([server.memory, server.mem_used]) ?? 0,
    ram_total: numberOrUndefined(server.mem_total) ?? 0,
    swap: numberOrUndefined(server.swap) ?? 0,
    swap_total: numberOrUndefined(server.swap_total) ?? 0,
    load: load?.load1 ?? 0,
    load5: load?.load5 ?? 0,
    load15: load?.load15 ?? 0,
    temp: numberOrUndefined(server.temp) ?? 0,
    disk: numberOrUndefined(server.disk_used) ?? 0,
    disk_total: numberOrUndefined(server.disk_total) ?? 0,
    net_in: firstFinite([server.download, server.download_speed]) ?? 0,
    net_out: firstFinite([server.upload, server.upload_speed]) ?? 0,
    net_total_up: firstFinite([server.net_total_up, server.totalUpload, server.cumulative_up, server.traffic_used_up]) ?? 0,
    net_total_down: firstFinite([server.net_total_down, server.totalDownload, server.cumulative_down, server.traffic_used_down]) ?? 0,
    net_total_out: firstFinite([server.net_total_up, server.totalUpload, server.cumulative_up, server.traffic_used_up]) ?? 0,
    net_total_down_alt: firstFinite([server.net_total_down, server.totalDownload, server.cumulative_down, server.traffic_used_down]) ?? 0,
    process: numberOrUndefined(server.process) ?? 0,
    connections: numberOrUndefined(server.connections) ?? 0,
    connections_udp: numberOrUndefined(server.connections_udp) ?? 0,
    online: server.online !== false,
    uptime: numberOrUndefined(server.uptime) ?? 0,
  }
  return status
}

export function toKomariRecentReports(payload: ProbePayload, now = new Date()): KomariRecentReport[] {
  return payload.servers.map((server, index) => {
    const status = toKomariNodeStatus(server, index, now)
    return {
      uuid: status.client,
      cpu: { usage: status.cpu },
      ram: { used: status.ram, total: status.ram_total },
      swap: { used: status.swap, total: status.swap_total },
      load: { load1: status.load, load5: status.load5, load15: status.load15 },
      disk: { used: status.disk, total: status.disk_total },
      network: {
        up: status.net_out,
        down: status.net_in,
        totalUp: status.net_total_up,
        totalDown: status.net_total_down,
      },
      connections: { tcp: status.connections, udp: status.connections_udp },
      uptime: status.uptime,
      process: status.process,
      updated_at: status.time,
    }
  })
}

function enrichLoadRecord(record: LoadHistoryRecord): KomariLoadRecord {
  return {
    client: record.client,
    time: record.time,
    cpu: record.cpu ?? 0,
    gpu: 0,
    ram: record.ram ?? 0,
    ram_total: record.mem_total ?? 0,
    swap: record.swap ?? 0,
    swap_total: record.swap_total ?? 0,
    load: record.load ?? 0,
    temp: 0,
    disk: record.disk ?? 0,
    disk_total: record.disk_total ?? 0,
    net_in: record.net_in ?? 0,
    net_out: record.net_out ?? 0,
    net_total_up: record.net_total_up ?? 0,
    net_total_down: record.net_total_down ?? 0,
    process: record.process ?? 0,
    connections: record.connections ?? 0,
    connections_udp: record.connections_udp ?? 0,
  }
}

export function toKomariLoadRecords(history: LoadHistory): KomariLoadRecords {
  return {
    count: history.count,
    records: history.records.map(enrichLoadRecord),
    has_gpu_data: false,
    gpu_devices: [],
  }
}

function summarisePingTask(task: PingTask, records: PingHistory['records']): KomariPingRecordTask {
  const taskRecords = records.filter((record) => record.task_id === task.id)
  const values = taskRecords
    .map((record) => record.value)
    .filter((value): value is number => typeof value === 'number' && value >= 0)
  const total = taskRecords.length
  const failed = taskRecords.filter((record) => typeof record.value !== 'number' || record.value < 0).length
  const min = values.length > 0 ? Math.min(...values) : 0
  const max = values.length > 0 ? Math.max(...values) : 0
  const avg = values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
  return {
    id: task.id,
    name: task.name,
    type: task.type,
    interval: task.interval,
    default_on: task.default_on,
    total,
    loss: total > 0 ? Math.round((failed / total) * 100) : 0,
    min,
    max,
    avg,
  }
}

export function toKomariPingRecords(history: PingHistory): KomariPingRecords {
  const records: KomariPingRecord[] = history.records.map((record) => ({
    task_id: record.task_id,
    time: record.time,
    value: typeof record.value === 'number' ? record.value : -1,
    client: record.client,
  }))
  return {
    count: history.count,
    records,
    tasks: history.tasks.map((task) => summarisePingTask(task, records)),
    basic_info: history.basic_info,
  }
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
