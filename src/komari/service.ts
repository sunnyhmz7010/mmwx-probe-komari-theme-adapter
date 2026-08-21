import type { ProbePayload, ProbeSeriesPayload, SeriesQuery } from '../mmwx/types.js'
import { toKomariNode, toKomariRecord, toLoadHistory, toPingHistory } from './mapper.js'
import type { KomariSnapshot, LoadHistory, PingHistory } from './types.js'

interface DataClient {
  fetchProbe(): Promise<ProbePayload>
  fetchSeries(query: SeriesQuery): Promise<ProbeSeriesPayload>
}

interface CacheEntry<T> {
  value: T
  fetchedAt: number
}

interface SnapshotValue {
  snapshot: KomariSnapshot
  payload: ProbePayload
}

export class KomariServiceError extends Error {
  public readonly statusCode = 502

  public constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'KomariServiceError'
  }
}

export class KomariDataService {
  private snapshot?: CacheEntry<SnapshotValue>
  private snapshotInflight?: Promise<SnapshotValue>
  private readonly series = new Map<string, CacheEntry<ProbeSeriesPayload>>()
  private readonly seriesInflight = new Map<string, Promise<ProbeSeriesPayload>>()

  public constructor(
    private readonly client: DataClient,
    private readonly cacheTtlMs: number,
  ) {}

  public async getSnapshot(): Promise<KomariSnapshot> {
    return (await this.getSnapshotValue()).snapshot
  }

  public async getPingHistory(query: SeriesQuery): Promise<PingHistory> {
    const cached = await this.getSnapshotValue()
    return toPingHistory(cached.payload.servers, new Date())
  }

  public async getLoadHistory(uuid: string, query: SeriesQuery): Promise<LoadHistory> {
    const payload = await this.getSeries({ ...query, uuid })
    const index = Number(uuid.replace(/^mmwx-/, ''))
    const series = payload.systems?.find((item) => Number(item.serverId) === index) ?? payload.systems?.[0] ?? { serverId: index, points: [] }
    return toLoadHistory({ ...series, serverId: index })
  }

  private async getSnapshotValue(): Promise<SnapshotValue> {
    const cached = this.snapshot
    const now = Date.now()
    if (cached && now - cached.fetchedAt <= this.cacheTtlMs) return cached.value
    if (this.snapshotInflight) return this.snapshotInflight

    this.snapshotInflight = this.client.fetchProbe()
      .then((payload) => {
        const value = { snapshot: toSnapshot(payload), payload }
        this.snapshot = { value, fetchedAt: Date.now() }
        return value
      })
      .catch((error: unknown) => {
        if (cached && Date.now() - cached.fetchedAt <= 2 * this.cacheTtlMs) return cached.value
        throw new KomariServiceError('MMWX probe snapshot unavailable', error)
      })
      .finally(() => {
        this.snapshotInflight = undefined
      })
    return this.snapshotInflight
  }

  private async getSeries(query: SeriesQuery): Promise<ProbeSeriesPayload> {
    const key = stableKey(query)
    const cached = this.series.get(key)
    const now = Date.now()
    if (cached && now - cached.fetchedAt <= this.cacheTtlMs) return cached.value
    const inflight = this.seriesInflight.get(key)
    if (inflight) return inflight

    const request = this.client.fetchSeries(query)
      .then((payload) => {
        this.series.set(key, { value: payload, fetchedAt: Date.now() })
        return payload
      })
      .catch((error: unknown) => {
        if (cached && Date.now() - cached.fetchedAt <= 2 * this.cacheTtlMs) return cached.value
        throw new KomariServiceError('MMWX probe history unavailable', error)
      })
      .finally(() => {
        this.seriesInflight.delete(key)
      })
    this.seriesInflight.set(key, request)
    return request
  }
}

function toSnapshot(payload: ProbePayload): KomariSnapshot {
  const now = new Date()
  return {
    nodes: payload.servers.map(toKomariNode),
    records: payload.servers.map((server, index) => toKomariRecord(server, index, now)),
  }
}

function stableKey(query: SeriesQuery): string {
  return JSON.stringify(Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)))
}
