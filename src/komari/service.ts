import { readFileSync } from 'node:fs'

import type { MmwxSystemMetricSeries, ProbePayload, ProbeSeriesPayload, SeriesQuery } from '../mmwx/types.js'
import {
  toKomariLoadRecords,
  toKomariNode,
  toKomariNodeStatusMap,
  toKomariPublicNodes,
  toKomariRecentReports,
  toKomariRecord,
  toKomariPingRecords,
  toLoadHistory,
  toPingSeriesHistory,
  toSystemMetricHistory,
} from './mapper.js'
import type {
  KomariLoadRecords,
  KomariNodeStatusMap,
  KomariPingRecords,
  KomariPublicNode,
  KomariPublicSettings,
  KomariRecentReport,
  KomariSnapshot,
  KomariVersionInfo,
  LoadHistory,
  PingHistory,
} from './types.js'

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

const PACKAGE_VERSION = readPackageVersion()
const BUILD_HASH = process.env.GITHUB_SHA?.trim() || process.env.GIT_COMMIT?.trim() || 'unknown'

function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    const version = parsed.version?.trim()
    return version || '0.0.0'
  } catch {
    return '0.0.0'
  }
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

  public async getProbePayload(): Promise<ProbePayload> {
    return (await this.getSnapshotValue()).payload
  }

  public async getNodesInformation(): Promise<KomariPublicNode[]> {
    return toKomariPublicNodes(await this.getProbePayload())
  }

  public async getPublicSettings(): Promise<KomariPublicSettings> {
    return {
      sitename: '妙妙屋 X 主控',
      description: '已部署支持独立探针访问密钥的妙妙屋 X 主控',
      theme: 'AdhesiveNote',
      theme_settings: null,
      private_site: false,
      record_enabled: true,
      record_preserve_time: 24,
      ping_record_preserve_time: 24,
      custom_head: '',
      custom_body: '',
      oauth_enable: false,
      oauth_provider: '',
      disable_password_login: false,
      cors_origin_check_enabled: true,
      visitor_audit_enabled: false,
    }
  }

  public async getNodesLatestStatus(): Promise<KomariNodeStatusMap> {
    return toKomariNodeStatusMap(await this.getProbePayload())
  }

  public async getClientRecentRecords(): Promise<KomariRecentReport[]> {
    return toKomariRecentReports(await this.getProbePayload())
  }

  public async getVersion(): Promise<KomariVersionInfo> {
    return {
      version: `v${PACKAGE_VERSION}`,
      hash: BUILD_HASH,
    }
  }

  public async getSeriesPayload(query: SeriesQuery): Promise<ProbeSeriesPayload> {
    return await this.getSeries(query)
  }

  public async getPingHistory(query: SeriesQuery): Promise<PingHistory> {
    const index = serverIndexFromQuery(query)
    const payload = await this.getSeries(seriesQuery(query, { server: String(index), range: rangeFromQuery(query), all: '1' }))
    if (payload.pings || payload.all_series || payload.series) return toPingSeriesHistory(payload, index)
    return { count: 0, records: [], tasks: [], basic_info: { clients: [] } }
  }

  public async getLoadHistory(uuid: string, query: SeriesQuery): Promise<LoadHistory> {
    const index = serverIndexFromUuid(uuid)
    const payload = await this.getSeries(seriesQuery(query, { server: String(index), range: rangeFromQuery(query), metric: 'system' }))
    if (isSystemMetricSeries(payload.series)) return toSystemMetricHistory(payload.series, index)
    const series = payload.systems?.find((item) => Number(item.serverId) === index) ?? payload.systems?.[0] ?? { serverId: index, points: [] }
    return toLoadHistory({ ...series, serverId: index })
  }

  public async getLoadRecords(uuid: string, query: SeriesQuery): Promise<KomariLoadRecords> {
    return toKomariLoadRecords(await this.getLoadHistory(uuid, query))
  }

  public async getPingRecords(query: SeriesQuery): Promise<KomariPingRecords> {
    return toKomariPingRecords(await this.getPingHistory(query))
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

function seriesQuery(query: SeriesQuery, override: SeriesQuery = {}): SeriesQuery {
  const { uuid: _uuid, task_id: _taskId, load_type: _loadType, hours: _hours, ...upstreamQuery } = query
  return { ...upstreamQuery, ...override }
}

function serverIndexFromQuery(query: SeriesQuery): number {
  return serverIndexFromUuid(query.uuid)
}

function serverIndexFromUuid(uuid: unknown): number {
  if (typeof uuid !== 'string') return 0
  const match = uuid.match(/^mmwx-(0|[1-9]\d*)$/)
  return match ? Number(match[1]) : 0
}

function rangeFromQuery(query: SeriesQuery): string {
  if (typeof query.range === 'string' && /^(?:1h|6h|24h)$/.test(query.range)) return query.range
  const raw = query.hours
  const hours = typeof raw === 'number' ? raw : Number(raw)
  if (hours <= 1) return '1h'
  if (hours <= 6) return '6h'
  return '24h'
}

function isSystemMetricSeries(value: unknown): value is MmwxSystemMetricSeries {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray((value as { buckets?: unknown }).buckets)
    && (
      Array.isArray((value as { cpu_pct?: unknown }).cpu_pct)
      || Array.isArray((value as { mem_used?: unknown }).mem_used)
      || Array.isArray((value as { upload_speed?: unknown }).upload_speed)
      || Array.isArray((value as { download_speed?: unknown }).download_speed)
    )
}
