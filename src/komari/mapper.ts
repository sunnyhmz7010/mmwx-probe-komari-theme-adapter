import type { MmwxSystemSeries, MmwxSystemSeriesPoint, ProbeBucket, ProbeServer } from '../mmwx/types.js'
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

function loadAverage(value: ProbeServer['load'] | MmwxSystemSeriesPoint['load']): KomariLoad | undefined {
  const load: KomariLoad = {}
  if (Array.isArray(value)) {
    const [load1, load5, load15] = value.map(numberOrUndefined)
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
  const up = numberOrUndefined(server.upload)
  const down = numberOrUndefined(server.download)
  const totalUp = numberOrUndefined(server.totalUpload)
  const totalDown = numberOrUndefined(server.totalDownload)
  const uplink = numberOrUndefined(server.uplink)
  const downlink = numberOrUndefined(server.downlink)
  if (up !== undefined) result.up = up
  if (down !== undefined) result.down = down
  if (totalUp !== undefined) result.totalUp = totalUp
  if (totalDown !== undefined) result.totalDown = totalDown
  if (uplink !== undefined) result.uplink = uplink
  if (downlink !== undefined) result.downlink = downlink
  return Object.keys(result).length > 0 ? result : undefined
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
  const cpu = numberOrUndefined(server.cpu)
  const memory = numberOrUndefined(server.memory)
  const load = loadAverage(server.load)
  const mappedNetwork = network(server)
  if (region) node.region = region
  if (cpu !== undefined) node.cpu = cpu
  if (memory !== undefined) node.memory = memory
  if (load) node.load = load
  if (mappedNetwork) node.network = mappedNetwork
  if (server.trafficPeriod) node.traffic_period = server.trafficPeriod
  return node
}

export function toKomariRecord(server: ProbeServer, index: number, now: Date): KomariRecord {
  const record: KomariRecord = {
    uuid: `mmwx-${index}`,
    online: server.online !== false,
    updated_at: now.toISOString(),
  }
  const cpu = numberOrUndefined(server.cpu)
  const ram = numberOrUndefined(server.memory)
  const load = loadAverage(server.load)
  const mappedNetwork = network(server)
  if (cpu !== undefined) record.cpu = { usage: cpu }
  if (ram !== undefined) record.ram = { used: ram }
  if (load) record.load = load
  if (mappedNetwork) record.network = mappedNetwork
  return record
}

function bucketValue(bucket: ProbeBucket): number | null {
  return firstFinite([bucket.value, bucket.latency]) ?? null
}

export function toPingHistory(servers: ProbeServer[], now: Date): PingHistory {
  const tasksByName = new Map<string, PingTask>()
  const records = servers.flatMap((server, index) => {
    const client = `mmwx-${index}`
    return (server.ping ?? []).map((bucket) => {
      const name = bucket.name?.trim() || `Ping ${tasksByName.size + 1}`
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
