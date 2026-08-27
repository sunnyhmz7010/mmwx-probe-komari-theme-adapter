import type { ProbePayload, ProbeServer } from './types.js'

// 历史采样缓冲：用实时快照帧在适配器内自建逐次密度历史，
// 弥补主控 probe-series 只提供聚合桶（1h 视图约 5 分钟/桶）的粒度限制。
// 热层保留最近 1 小时逐帧原样；更早数据按分钟降采样进入冷层，整体覆盖 25 小时（满足 hours=24 查询）。
const HOT_WINDOW_MS = 60 * 60 * 1000
const COLD_WINDOW_MS = 25 * 60 * 60 * 1000
const COLD_BUCKET_MS = 60 * 1000
const MAX_HOT_POINTS = 2400
const MAX_COLD_POINTS = 1800

export interface BufferedLoadPoint {
  t: number
  cpu?: number
  ram?: number
  mem_total?: number
  load?: number
  net_out?: number
  net_in?: number
  net_total_up?: number
  net_total_down?: number
}

export interface BufferedPingPoint {
  t: number
  value: number | null
  loss: number | null
}

interface PointSeries<T extends { t: number }> {
  hot: T[]
  cold: Map<number, T>
}

interface ClientSeries {
  load: PointSeries<BufferedLoadPoint>
  ping: Map<string, PointSeries<BufferedPingPoint>>
}

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

function load1Of(value: ProbeServer['load'] | ProbeServer['loadavg']): number | undefined {
  if (Array.isArray(value)) return numberOrUndefined(value[0])
  if (typeof value === 'string' && value.trim().includes(' ')) return numberOrUndefined(value.trim().split(/\s+/)[0])
  return numberOrUndefined(value)
}

function pingTaskName(bucket: { key?: string | null; name?: string | null; label?: string | null }, index: number): string {
  return bucket.name?.trim() || bucket.label?.trim() || bucket.key?.trim() || `Ping ${index + 1}`
}

/**
 * ProbeHistoryBuffer 以实时帧为样本源维护各节点的 load 与 ping 滚动历史。
 * 内存态，不持久化：重启后由 KomariService 回退主控聚合桶合并，运行满窗口后完全为逐帧密度。
 */
export class ProbeHistoryBuffer {
  private readonly clients = new Map<number, ClientSeries>()

  public ingest(payload: ProbePayload, at: Date = new Date()): void {
    const servers = Array.isArray(payload.servers) ? payload.servers : []
    const t = Math.floor(at.getTime() / 1000) * 1000
    for (let index = 0; index < servers.length; index += 1) {
      const server = servers[index]
      // 离线节点的帧字段是残值，不记为新样本，离线时段保持「无数据」语义。
      if (server.online === false) continue
      const series = this.clientSeries(index)
      this.appendLoad(series, server, t)
      this.appendPing(series, server, t)
    }
  }

  public snapshotLoad(index: number): BufferedLoadPoint[] {
    return this.mergeSeries(this.clients.get(index)?.load)
  }

  public snapshotPing(index: number): Map<string, BufferedPingPoint[]> {
    const result = new Map<string, BufferedPingPoint[]>()
    const series = this.clients.get(index)
    if (!series) return result
    for (const [name, points] of series.ping) {
      const merged = this.mergeSeries(points)
      if (merged.length > 0) result.set(name, merged)
    }
    return result
  }

  private clientSeries(index: number): ClientSeries {
    let series = this.clients.get(index)
    if (!series) {
      series = { load: { hot: [], cold: new Map() }, ping: new Map() }
      this.clients.set(index, series)
    }
    return series
  }

  private appendLoad(series: ClientSeries, server: ProbeServer, t: number): void {
    const point: BufferedLoadPoint = { t }
    const cpu = firstFinite([server.cpu, server.cpu_pct])
    const ram = firstFinite([server.memory, server.mem_used])
    const memTotal = numberOrUndefined(server.mem_total)
    const load = load1Of(server.load ?? server.loadavg)
    const netOut = firstFinite([server.upload, server.upload_speed])
    const netIn = firstFinite([server.download, server.download_speed])
    const netTotalUp = firstFinite([server.net_total_up, server.cumulative_up])
    const netTotalDown = firstFinite([server.net_total_down, server.cumulative_down])
    if (cpu !== undefined) point.cpu = cpu
    if (ram !== undefined) point.ram = ram
    if (memTotal !== undefined) point.mem_total = memTotal
    if (load !== undefined) point.load = load
    if (netOut !== undefined) point.net_out = netOut
    if (netIn !== undefined) point.net_in = netIn
    if (netTotalUp !== undefined) point.net_total_up = netTotalUp
    if (netTotalDown !== undefined) point.net_total_down = netTotalDown
    // 整帧无有效指标时不产生样本，避免空白时段被残帧填出假数据。
    if (Object.keys(point).length === 1) return
    this.append(series.load, point, t)
  }

  private appendPing(series: ClientSeries, server: ProbeServer, t: number): void {
    const buckets = server.ping ?? []
    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index]
      const name = pingTaskName(bucket, index)
      let points = series.ping.get(name)
      if (!points) {
        points = { hot: [], cold: new Map() }
        series.ping.set(name, points)
      }
      const value = firstFinite([bucket.value, bucket.latency, bucket.current_ms]) ?? null
      const loss = numberOrUndefined(bucket.loss) ?? numberOrUndefined(bucket.loss_pct) ?? null
      this.append(points, { t, value, loss }, t)
    }
  }

  private append<T extends { t: number }>(target: PointSeries<T>, point: T, t: number): void {
    // 同一秒的重复帧（WS 帧与 HTTP 快照同源）覆盖，不产生重复样本。
    const last = target.hot[target.hot.length - 1]
    if (last && last.t === t) {
      target.hot[target.hot.length - 1] = point
      return
    }
    target.hot.push(point)
    this.applyRetention(target, t)
  }

  private applyRetention<T extends { t: number }>(target: PointSeries<T>, now: number): void {
    // 热层超出 1 小时的点按分钟降采样移入冷层，同一分钟保留最后一条。
    while (target.hot.length > 0 && target.hot[0].t <= now - HOT_WINDOW_MS) {
      const evicted = target.hot.shift()
      if (evicted) target.cold.set(Math.floor(evicted.t / COLD_BUCKET_MS) * COLD_BUCKET_MS, evicted)
    }
    if (target.hot.length > MAX_HOT_POINTS) target.hot.splice(0, target.hot.length - MAX_HOT_POINTS)
    // 冷层按 25 小时窗口过期，再以容量上限兜底（1 分钟粒度下 1800 桶约 30 小时）。
    while (target.cold.size > 0) {
      const oldest = target.cold.keys().next().value as number | undefined
      if (oldest === undefined || oldest >= now - COLD_WINDOW_MS) break
      target.cold.delete(oldest)
    }
    while (target.cold.size > MAX_COLD_POINTS) {
      const oldest = target.cold.keys().next().value as number | undefined
      if (oldest === undefined) break
      target.cold.delete(oldest)
    }
  }

  private mergeSeries<T extends { t: number }>(series?: PointSeries<T>): T[] {
    if (!series) return []
    return [...series.cold.values(), ...series.hot].sort((left, right) => left.t - right.t)
  }
}
