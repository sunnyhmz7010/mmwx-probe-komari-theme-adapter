import { readFileSync } from 'node:fs'

import type { MmwxMetricPoint, MmwxProbeSeries, MmwxProbeSeriesBucket, MmwxSystemMetricSeries, MmwxSystemSeriesPoint, ProbeAppearance, ProbeBucket, ProbeDailyTraffic, ProbeLicenseBadge, ProbePayload, ProbePingSeries, ProbeReturnRoute, ProbeSeriesPayload, ProbeServer, SeriesQuery } from '../mmwx/types.js'
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
  KomariCommonRecords,
  KomariLoadRecords,
  KomariMetricPoint,
  KomariMetricSeries,
  KomariNodeStatusMap,
  KomariPingMetricStat,
  KomariPingMetricStats,
  KomariPingRecords,
  KomariPublicPingTask,
  KomariPublicNode,
  KomariPublicSettings,
  KomariRecentReport,
  KomariSnapshot,
  KomariQueryMetrics,
  KomariVersionInfo,
  LoadHistory,
  PingHistory,
} from './types.js'

interface DataClient {
  fetchProbe(): Promise<ProbePayload>
  fetchSeries(query: SeriesQuery): Promise<ProbeSeriesPayload>
}

interface ThemeSource {
  repoUrl: string
  ref: string
  themeShort?: string
  themeSettings?: Record<string, unknown> | null
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

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function dateOnlyOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') {
    const timestamp = value > 1e12 ? value : value * 1000
    return new Date(timestamp).toISOString().slice(0, 10)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
    if (dateMatch) return dateMatch[1]
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) {
      const timestamp = numeric > 1e12 ? numeric : numeric * 1000
      return new Date(timestamp).toISOString().slice(0, 10)
    }
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10)
  }
  return undefined
}

function dateTimeOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') {
    const timestamp = value > 1e12 ? value : value * 1000
    return new Date(timestamp).toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) {
      const timestamp = numeric > 1e12 ? numeric : numeric * 1000
      return new Date(timestamp).toISOString()
    }
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return undefined
}

function themeNameFromSource(source?: ThemeSource): string {
  const short = stringOrUndefined(source?.themeShort)
  if (short) return short
  const repoName = source?.repoUrl
    ?.split('/')
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.git$/i, '')
    ?.trim()
  if (!repoName) return 'pixel'
  const normalized = repoName.replace(/^komari-theme-/i, '').replace(/_/g, '-').trim()
  return normalized || 'pixel'
}

function normalizeProbeAppearance(input: ProbeAppearance | null | undefined, source?: ThemeSource): NonNullable<ProbePayload['appearance']> {
  return {
    theme: stringOrUndefined(input?.theme) || themeNameFromSource(source),
    color_mode: input?.color_mode === 'dark' || input?.color_mode === 'system' ? input.color_mode : 'light',
    revision: stringOrUndefined(input?.revision) || stringOrUndefined(source?.ref),
  }
}

function normalizeProbeLicenseBadge(input: ProbePayload['license_badge']): ProbePayload['license_badge'] | undefined {
  const name = stringOrUndefined(input?.name)
  const displayName = stringOrUndefined(input?.display_name)
  if (!name && !displayName) return undefined
  return {
    ...(name ? { name } : {}),
    ...(displayName ? { display_name: displayName } : {}),
  }
}

function normalizeDailyTraffic(rows: ProbeServer['daily_traffic']): ProbeDailyTraffic[] {
  const result: ProbeDailyTraffic[] = []
  for (const row of rows ?? []) {
    const date = dateOnlyOrUndefined(row?.date)
    if (!date) continue
    const uplink = numberOrUndefined(row?.uplink) ?? 0
    const downlink = numberOrUndefined(row?.downlink) ?? 0
    result.push({
      date,
      uplink,
      downlink,
      total: numberOrUndefined(row?.total) ?? uplink + downlink,
    })
  }
  return result
}

function normalizePingBuckets(input: ProbeBucket['buckets']): MmwxProbeSeriesBucket[] {
  const buckets: MmwxProbeSeriesBucket[] = []
  for (const bucket of input ?? []) {
    const ms = numberOrUndefined(bucket?.ms)
    const loss = numberOrUndefined(bucket?.loss)
    if (ms === undefined && loss === undefined) continue
    buckets.push({
      ...(ms !== undefined ? { ms } : {}),
      ...(loss !== undefined ? { loss } : {}),
    })
  }
  return buckets
}

function normalizeProbePingSeries(input: ProbeBucket, index: number): ProbeBucket {
  const label = stringOrUndefined(input.label) || stringOrUndefined(input.name) || stringOrUndefined(input.key) || `Ping ${index + 1}`
  const currentMs = numberOrUndefined(input.current_ms ?? input.value ?? input.latency)
  const lossPct = numberOrUndefined(input.loss_pct ?? input.loss)
  const buckets = normalizePingBuckets(input.buckets)
  if (buckets.length === 0 && (currentMs !== undefined || lossPct !== undefined)) {
    buckets.push({
      ...(currentMs !== undefined ? { ms: currentMs } : {}),
      ...(lossPct !== undefined ? { loss: lossPct } : {}),
    })
  }
  return {
    ...(stringOrUndefined(input.key) ? { key: stringOrUndefined(input.key) } : {}),
    label,
    ...(stringOrUndefined(input.isp) ? { isp: stringOrUndefined(input.isp) } : {}),
    current_ms: currentMs ?? -1,
    loss_pct: lossPct ?? 0,
    buckets,
  }
}

function normalizeReturnRoute(input: ProbeReturnRoute): ProbeReturnRoute | undefined {
  const routeType = stringOrUndefined(input.route_type ?? input.name ?? input.host ?? input.region ?? input.country)
  const carrier = stringOrUndefined(input.carrier)
  const region = stringOrUndefined(input.region)
  const testedAt = dateTimeOrUndefined(input.tested_at)
  const name = stringOrUndefined(input.name)
  const host = stringOrUndefined(input.host)
  const country = stringOrUndefined(input.country)
  const latency = numberOrUndefined(input.latency)
  const loss = numberOrUndefined(input.loss)
  if (!routeType && !carrier && !region && !testedAt && !name && !host && !country && latency === undefined && loss === undefined) return undefined
  return {
    ...(carrier ? { carrier } : {}),
    ...(region ? { region } : {}),
    ...(routeType ? { route_type: routeType } : {}),
    ...(testedAt ? { tested_at: testedAt } : {}),
    ...(name ? { name } : {}),
    ...(host ? { host } : {}),
    ...(country ? { country } : {}),
    ...(latency !== undefined ? { latency } : {}),
    ...(loss !== undefined ? { loss } : {}),
  }
}

function normalizeProbeServer(server: ProbeServer, index: number): ProbeServer {
  const periodStart = dateOnlyOrUndefined(server.period_start)
  const periodEnd = dateOnlyOrUndefined(server.period_end)
  const dailyTrafficStart = dateOnlyOrUndefined(server.daily_traffic_start)
  const dailyTrafficEnd = dateOnlyOrUndefined(server.daily_traffic_end)
  const expiresAt = dateOnlyOrUndefined(server.expires_at)
  const routes = server.return_routes ?? server.routes
  const trafficPeriod = stringOrUndefined(server.trafficPeriod) || (periodStart && periodEnd ? `${periodStart}/${periodEnd}` : undefined)
  const dailyTraffic = normalizeDailyTraffic(server.daily_traffic)
  const returnRoutes = routes?.map((route) => normalizeReturnRoute(route)).filter((route): route is ProbeReturnRoute => route !== undefined)
  const ping = server.ping?.map(normalizeProbePingSeries)
  return {
    id: server.id,
    name: stringOrUndefined(server.name) || stringOrUndefined(server.host) || `MMWX Node ${index + 1}`,
    ...(stringOrUndefined(server.host) ? { host: stringOrUndefined(server.host) } : {}),
    ...(stringOrUndefined(server.cpu_name) ? { cpu_name: stringOrUndefined(server.cpu_name) } : {}),
    ...(stringOrUndefined(server.cpu_model ?? server.cpu_name) ? { cpu_model: stringOrUndefined(server.cpu_model ?? server.cpu_name) } : {}),
    ...(stringOrUndefined(server.virtualization) ? { virtualization: stringOrUndefined(server.virtualization) } : {}),
    ...(stringOrUndefined(server.arch) ? { arch: stringOrUndefined(server.arch) } : {}),
    ...(numberOrUndefined(server.cpu_cores) !== undefined ? { cpu_cores: numberOrUndefined(server.cpu_cores) } : {}),
    ...(numberOrUndefined(server.cpu_physical_cores) !== undefined ? { cpu_physical_cores: numberOrUndefined(server.cpu_physical_cores) } : {}),
    ...(numberOrUndefined(server.cpu_threads) !== undefined ? { cpu_threads: numberOrUndefined(server.cpu_threads) } : {}),
    ...(stringOrUndefined(server.os) ? { os: stringOrUndefined(server.os) } : {}),
    ...(stringOrUndefined(server.kernel_version) ? { kernel_version: stringOrUndefined(server.kernel_version) } : {}),
    ...(stringOrUndefined(server.kernel) ? { kernel: stringOrUndefined(server.kernel) } : {}),
    ...(stringOrUndefined(server.gpu_name) ? { gpu_name: stringOrUndefined(server.gpu_name) } : {}),
    ...(numberOrUndefined(server.gpu) !== undefined ? { gpu: numberOrUndefined(server.gpu) } : {}),
    ...(stringOrUndefined(server.region) ? { region: stringOrUndefined(server.region) } : {}),
    ...(stringOrUndefined(server.region_country) ? { region_country: stringOrUndefined(server.region_country) } : {}),
    ...(stringOrUndefined(server.region_name) ? { region_name: stringOrUndefined(server.region_name) } : {}),
    ...(stringOrUndefined(server.region_city) ? { region_city: stringOrUndefined(server.region_city) } : {}),
    ...(stringOrUndefined(server.provider_name) ? { provider_name: stringOrUndefined(server.provider_name) } : {}),
    ...(stringOrUndefined(server.provider_url) ? { provider_url: stringOrUndefined(server.provider_url) } : {}),
    ...(stringOrUndefined(server.country) ? { country: stringOrUndefined(server.country) } : {}),
    ...(stringOrUndefined(server.revision) ? { revision: stringOrUndefined(server.revision) } : {}),
    online: server.online !== false,
    ...(numberOrUndefined(server.cpu) !== undefined ? { cpu: numberOrUndefined(server.cpu) } : {}),
    ...(numberOrUndefined(server.cpu_pct) !== undefined ? { cpu_pct: numberOrUndefined(server.cpu_pct) } : {}),
    ...(numberOrUndefined(server.memory) !== undefined ? { memory: numberOrUndefined(server.memory) } : {}),
    ...(numberOrUndefined(server.mem_used) !== undefined ? { mem_used: numberOrUndefined(server.mem_used) } : {}),
    ...(numberOrUndefined(server.mem_total) !== undefined ? { mem_total: numberOrUndefined(server.mem_total) } : {}),
    ...(numberOrUndefined(server.swap) !== undefined ? { swap: numberOrUndefined(server.swap) } : {}),
    ...(numberOrUndefined(server.swap_total) !== undefined ? { swap_total: numberOrUndefined(server.swap_total) } : {}),
    ...(numberOrUndefined(server.disk_used) !== undefined ? { disk_used: numberOrUndefined(server.disk_used) } : {}),
    ...(numberOrUndefined(server.disk_total) !== undefined ? { disk_total: numberOrUndefined(server.disk_total) } : {}),
    ...(Array.isArray(server.load) ? { load: server.load.map((value) => numberOrUndefined(value) ?? value) } : stringOrUndefined(server.loadavg) ? { loadavg: stringOrUndefined(server.loadavg) } : numberOrUndefined(server.load) !== undefined ? { load: numberOrUndefined(server.load) } : {}),
    ...(numberOrUndefined(server.temp) !== undefined ? { temp: numberOrUndefined(server.temp) } : {}),
    ...(numberOrUndefined(server.upload) !== undefined ? { upload: numberOrUndefined(server.upload) } : {}),
    ...(numberOrUndefined(server.upload_speed) !== undefined ? { upload_speed: numberOrUndefined(server.upload_speed) } : {}),
    ...(numberOrUndefined(server.download) !== undefined ? { download: numberOrUndefined(server.download) } : {}),
    ...(numberOrUndefined(server.download_speed) !== undefined ? { download_speed: numberOrUndefined(server.download_speed) } : {}),
    ...(numberOrUndefined(server.uplink) !== undefined ? { uplink: numberOrUndefined(server.uplink) } : {}),
    ...(numberOrUndefined(server.downlink) !== undefined ? { downlink: numberOrUndefined(server.downlink) } : {}),
    ...(numberOrUndefined(server.totalUpload) !== undefined ? { totalUpload: numberOrUndefined(server.totalUpload) } : {}),
    ...(numberOrUndefined(server.totalDownload) !== undefined ? { totalDownload: numberOrUndefined(server.totalDownload) } : {}),
    ...(numberOrUndefined(server.net_total_up) !== undefined ? { net_total_up: numberOrUndefined(server.net_total_up) } : {}),
    ...(numberOrUndefined(server.net_total_down) !== undefined ? { net_total_down: numberOrUndefined(server.net_total_down) } : {}),
    ...(trafficPeriod ? { trafficPeriod } : {}),
    ...(dailyTraffic.length > 0 ? { daily_traffic: dailyTraffic } : {}),
    ...(stringOrUndefined(server.traffic_source) ? { traffic_source: stringOrUndefined(server.traffic_source) } : {}),
    ...(stringOrUndefined(server.traffic_used_scope) ? { traffic_used_scope: stringOrUndefined(server.traffic_used_scope) } : {}),
    ...(numberOrUndefined(server.traffic_adjustment) !== undefined ? { traffic_adjustment: numberOrUndefined(server.traffic_adjustment) } : {}),
    ...(numberOrUndefined(server.boot_traffic_up) !== undefined ? { boot_traffic_up: numberOrUndefined(server.boot_traffic_up) } : {}),
    ...(numberOrUndefined(server.boot_traffic_down) !== undefined ? { boot_traffic_down: numberOrUndefined(server.boot_traffic_down) } : {}),
    ...(stringOrUndefined(server.boot_traffic_scope) ? { boot_traffic_scope: stringOrUndefined(server.boot_traffic_scope) } : {}),
    ...(numberOrUndefined(server.cumulative_up) !== undefined ? { cumulative_up: numberOrUndefined(server.cumulative_up) } : {}),
    ...(numberOrUndefined(server.cumulative_down) !== undefined ? { cumulative_down: numberOrUndefined(server.cumulative_down) } : {}),
    ...(stringOrUndefined(server.cumulative_traffic_scope) ? { cumulative_traffic_scope: stringOrUndefined(server.cumulative_traffic_scope) } : {}),
    ...(stringOrUndefined(server.daily_traffic_scope) ? { daily_traffic_scope: stringOrUndefined(server.daily_traffic_scope) } : {}),
    ...(dailyTrafficStart ? { daily_traffic_start: dailyTrafficStart } : {}),
    ...(dailyTrafficEnd ? { daily_traffic_end: dailyTrafficEnd } : {}),
    ...(stringOrUndefined(server.traffic_stats_mode) ? { traffic_stats_mode: stringOrUndefined(server.traffic_stats_mode) } : {}),
    ...(numberOrUndefined(server.traffic_used_up) !== undefined ? { traffic_used_up: numberOrUndefined(server.traffic_used_up) } : {}),
    ...(numberOrUndefined(server.traffic_used_down) !== undefined ? { traffic_used_down: numberOrUndefined(server.traffic_used_down) } : {}),
    ...(numberOrUndefined(server.traffic_used_total) !== undefined ? { traffic_used_total: numberOrUndefined(server.traffic_used_total) } : {}),
    ...(numberOrUndefined(server.traffic_used) !== undefined ? { traffic_used: numberOrUndefined(server.traffic_used) } : {}),
    ...(periodStart ? { period_start: periodStart } : {}),
    ...(periodEnd ? { period_end: periodEnd } : {}),
    ...(numberOrUndefined(server.process) !== undefined ? { process: numberOrUndefined(server.process) } : {}),
    ...(numberOrUndefined(server.connections) !== undefined ? { connections: numberOrUndefined(server.connections) } : {}),
    ...(numberOrUndefined(server.connections_udp) !== undefined ? { connections_udp: numberOrUndefined(server.connections_udp) } : {}),
    ...(numberOrUndefined(server.uptime) !== undefined ? { uptime: numberOrUndefined(server.uptime) } : {}),
    ...(numberOrUndefined(server.weight) !== undefined ? { weight: numberOrUndefined(server.weight) } : {}),
    ...(numberOrUndefined(server.price) !== undefined ? { price: numberOrUndefined(server.price) } : {}),
    ...(numberOrUndefined(server.billing_cycle) !== undefined ? { billing_cycle: numberOrUndefined(server.billing_cycle) } : {}),
    auto_renewal: server.auto_renewal === true,
    ...(stringOrUndefined(server.currency) ? { currency: stringOrUndefined(server.currency) } : {}),
    ...(dateOnlyOrUndefined(server.expired_at) ? { expired_at: dateOnlyOrUndefined(server.expired_at) } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    ...(numberOrUndefined(server.renewal_price) !== undefined ? { renewal_price: numberOrUndefined(server.renewal_price) } : {}),
    ...(numberOrUndefined(server.renewal_price_cny) !== undefined ? { renewal_price_cny: numberOrUndefined(server.renewal_price_cny) } : {}),
    ...(stringOrUndefined(server.renewal_cycle) ? { renewal_cycle: stringOrUndefined(server.renewal_cycle) } : {}),
    ...(stringOrUndefined(server.renewal_currency) ? { renewal_currency: stringOrUndefined(server.renewal_currency) } : {}),
    ...(stringOrUndefined(server.group) ? { group: stringOrUndefined(server.group) } : {}),
    ...(stringOrUndefined(server.tags) ? { tags: stringOrUndefined(server.tags) } : {}),
    hidden: server.hidden === true,
    ...(numberOrUndefined(server.traffic_limit) !== undefined ? { traffic_limit: numberOrUndefined(server.traffic_limit) } : {}),
    ...(stringOrUndefined(server.traffic_limit_type) ? { traffic_limit_type: stringOrUndefined(server.traffic_limit_type) } : {}),
    ...(dateTimeOrUndefined(server.created_at) ? { created_at: dateTimeOrUndefined(server.created_at) } : {}),
    ...(dateTimeOrUndefined(server.updated_at) ? { updated_at: dateTimeOrUndefined(server.updated_at) } : {}),
    ...(stringOrUndefined(server.public_remark) ? { public_remark: stringOrUndefined(server.public_remark) } : {}),
    ...(ping?.length ? { ping } : {}),
    ...(returnRoutes?.length ? { return_routes: returnRoutes } : {}),
    ...(returnRoutes?.length ? { routes: returnRoutes } : {}),
  }
}

function toProbePayload(payload: ProbePayload, source?: ThemeSource): ProbePayload {
  const servers = payload.servers.map((server, index) => normalizeProbeServer(server, index))
  const appearance = normalizeProbeAppearance(payload.appearance, source)
  return {
    enabled: payload.enabled !== false,
    show_globe: payload.show_globe ?? true,
    show_daily_trend: payload.show_daily_trend ?? true,
    show_traffic_hotspots: payload.show_traffic_hotspots ?? true,
    show_traffic_7d: payload.show_traffic_7d ?? true,
    show_resource_heatmap: payload.show_resource_heatmap ?? true,
    show_traffic_quota: payload.show_traffic_quota ?? true,
    show_renewal_timeline: payload.show_renewal_timeline ?? true,
    show_health_score: payload.show_health_score ?? true,
    title: stringOrUndefined(payload.title) || '妙妙屋 X 主控',
    ...(stringOrUndefined(payload.logo) ? { logo: stringOrUndefined(payload.logo) } : {}),
    appearance,
    ...(normalizeProbeLicenseBadge(payload.license_badge) ? { license_badge: normalizeProbeLicenseBadge(payload.license_badge) } : {}),
    servers,
    ...(payload.updatedAt !== undefined ? { updatedAt: payload.updatedAt } : {}),
  }
}

function loadAverage(value: unknown): { load1?: number; load5?: number; load15?: number } | undefined {
  const load: { load1?: number; load5?: number; load15?: number } = {}
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
    private readonly themeSource?: ThemeSource,
  ) {}

  public async getSnapshot(): Promise<KomariSnapshot> {
    return (await this.getSnapshotValue()).snapshot
  }

  public async getProbePayload(): Promise<ProbePayload> {
    return toProbePayload((await this.getSnapshotValue()).payload, this.themeSource)
  }

  public async getNodesInformation(): Promise<KomariPublicNode[]> {
    return toKomariPublicNodes(await this.getProbePayload())
  }

  public async getNodes(): Promise<Record<string, KomariPublicNode>> {
    const nodes = await this.getNodesInformation()
    return Object.fromEntries(nodes.map((node) => [node.uuid, node]))
  }

  public async getPublicSettings(): Promise<KomariPublicSettings> {
    const probe = await this.getProbePayload()
    const themeSettings = this.themeSource?.themeSettings ?? {}
    const logo = stringOrUndefined(probe.logo)
    return {
      sitename: stringOrUndefined(probe.title) || '妙妙屋 X 主控',
      description: '已部署支持独立探针访问密钥的妙妙屋 X 主控',
      theme: probe.appearance?.theme || themeNameFromSource(this.themeSource),
      theme_settings: themeSettings,
      private_site: false,
      record_enabled: true,
      record_preserve_time: 24,
      ping_record_preserve_time: 24,
      custom_head: logo ? `<link rel="icon" href="${escapeHtmlAttribute(logo)}">` : '',
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

  public async getRecords(query: SeriesQuery): Promise<KomariCommonRecords> {
    const type = stringQueryValue(query.type).toLowerCase()
    if (type === 'ping') {
      const history = await this.getPingHistory(query)
      return {
        ...toKomariPingRecords(history),
        has_gpu_data: false,
        gpu_devices: [],
        ...historyRange(query),
      }
    }

    const uuid = resolveEntityUuid(query)
    const history = await this.getLoadHistory(uuid, query)
    return {
      ...toKomariLoadRecords(history),
      ...historyRange(query),
    }
  }

  public async getQueryMetrics(query: SeriesQuery): Promise<KomariQueryMetrics> {
    const entityIds = await this.resolveEntityIdsOrAll(query)
    const metricKeys = resolveMetricKeys(query)
    const payload = await this.getSeries(seriesQuery(query, {
      server: entityIds[0] ? String(serverIndexFromUuid(entityIds[0])) : query.server,
      range: rangeFromQuery(query),
      metric: stringQueryValue(query.metric) || 'system',
    }))
    const pointsByEntity = collectQueryMetricSeries(payload, entityIds, metricKeys)
    const series = [...pointsByEntity.values()].flat()
    const { start, end } = seriesBounds(series)
    return {
      start,
      end,
      count: series.length,
      series,
    }
  }

  public async getPingMetricStats(query: SeriesQuery): Promise<KomariPingMetricStats> {
    const entityIds = await this.resolveEntityIdsOrAll(query)
    const taskIds = resolveNumericList(query.task_ids)
    const histories = await Promise.all(entityIds.map(async (entityId) => this.getPingHistory({ ...query, uuid: entityId })))
    const combined = mergePingHistories(histories)
    const stats = summarisePingMetricStats(combined, entityIds, taskIds)
    return { count: stats.length, stats }
  }

  public async getPublicPingTasks(query: SeriesQuery = {}): Promise<KomariPublicPingTask[]> {
    const entityIds = await this.resolveEntityIdsOrAll(query)
    const histories = await Promise.all(entityIds.map(async (entityId) => this.getPingHistory({ ...query, uuid: entityId })))
    const combined = mergePingHistories(histories)
    const tasks = combined.tasks.map((task) => ({
      ...task,
      target: task.name,
    }))
    return dedupePublicPingTasks(tasks)
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

  private async resolveEntityIdsOrAll(query: SeriesQuery): Promise<string[]> {
    const entityIds = resolveEntityIds(query)
    if (entityIds.length > 0) return entityIds
    return (await this.getNodesInformation()).map((node) => node.uuid)
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

function serverIndexFromServerId(serverId: string | number | undefined): number {
  const numeric = numberOrUndefined(serverId)
  if (numeric !== undefined && numeric >= 0) return Math.trunc(numeric)
  return serverIndexFromUuid(serverId)
}

function rangeFromQuery(query: SeriesQuery): string {
  if (typeof query.range === 'string' && /^(?:1h|6h|24h)$/.test(query.range)) return query.range
  const raw = query.hours
  const hours = typeof raw === 'number' ? raw : Number(raw)
  if (hours <= 1) return '1h'
  if (hours <= 6) return '6h'
  return '24h'
}

function historyRange(query: SeriesQuery): { from?: string; to?: string } {
  const hours = query.hours === undefined ? undefined : Number(query.hours)
  if (hours === undefined || !Number.isFinite(hours)) return {}
  const to = new Date()
  const from = new Date(to.getTime() - Math.max(hours, 0) * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

function stringQueryValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function resolveEntityUuid(query: SeriesQuery): string {
  const entityIds = resolveEntityIds(query)
  return entityIds[0] ?? String(query.uuid ?? query.server ?? 'mmwx-0')
}

function resolveEntityIds(query: SeriesQuery): string[] {
  const raw = query.entity_ids ?? query.entity_id ?? query.uuid
  if (Array.isArray(raw)) {
    const ids = raw.map((value) => normalizeEntityId(String(value))).filter(Boolean)
    if (ids.length > 0) return ids
  }
  if (typeof raw === 'string' && raw.trim()) return [normalizeEntityId(raw.trim())]
  if (typeof raw === 'number' && Number.isFinite(raw)) return [`mmwx-${Math.trunc(raw)}`]
  const server = query.server
  if (Array.isArray(server)) {
    const ids = server.map((value) => normalizeEntityId(String(value))).filter(Boolean)
    if (ids.length > 0) return ids
  }
  if (typeof server === 'string' && server.trim()) return [normalizeEntityId(server.trim())]
  if (typeof server === 'number' && Number.isFinite(server)) return [`mmwx-${Math.trunc(server)}`]
  return []
}

function resolveMetricKeys(query: SeriesQuery): string[] {
  const raw = query.metric_keys ?? query.metric_key ?? query.metrics ?? query.metric
  if (Array.isArray(raw)) return raw.map((value) => String(value)).filter(Boolean)
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map((value) => value.trim()).filter(Boolean)
  }
  return ['cpu.usage', 'memory.used', 'memory.total', 'swap.used', 'swap.total', 'load.average', 'disk.used', 'disk.total', 'net.in.rate', 'net.out.rate', 'net.total.up', 'net.total.down', 'process.count', 'connections.tcp', 'connections.udp', 'traffic.up', 'traffic.down']
}

function resolveNumericList(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item))
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [Math.trunc(value)]
  return []
}

function seriesBounds(series: readonly KomariMetricSeries[]): { start?: string; end?: string } {
  const times = series.flatMap((item) => item.points.map((point) => Date.parse(point.time)).filter((value) => Number.isFinite(value)))
  if (times.length === 0) return {}
  const start = new Date(Math.min(...times))
  const end = new Date(Math.max(...times))
  return { start: start.toISOString(), end: end.toISOString() }
}

function mergePingHistories(histories: readonly PingHistory[]): PingHistory {
  const records = histories.flatMap((history) => history.records)
  const tasks = histories.flatMap((history) => history.tasks)
  const clients = [...new Set(histories.flatMap((history) => history.basic_info.clients))].sort()
  return {
    count: records.length,
    records,
    tasks,
    basic_info: { clients },
  }
}

function dedupePublicPingTasks(tasks: readonly KomariPublicPingTask[]): KomariPublicPingTask[] {
  const seen = new Map<string, KomariPublicPingTask>()
  for (const task of tasks) {
    const key = `${task.id}:${task.name}`
    if (!seen.has(key)) seen.set(key, task)
  }
  return [...seen.values()]
}

function collectQueryMetricSeries(
  payload: ProbeSeriesPayload,
  entityIds: readonly string[],
  metricKeys: readonly string[],
): Map<string, KomariMetricSeries[]> {
  const result = new Map<string, KomariMetricSeries[]>()
  const systems = payload.systems ?? []
  const targets = entityIds.length > 0
    ? [...new Set(entityIds)]
    : [...new Set(systems.map((item) => `mmwx-${serverIndexFromServerId(item.serverId)}`))]

  if (systems.length > 0) {
    for (const entityId of targets) {
      const index = serverIndexFromUuid(entityId)
      const source = systems.find((item) => serverIndexFromServerId(item.serverId) === index) ?? systems[0]
      const series = metricKeys.map((metricKey) => systemMetricSeriesFromPoints(entityId, metricKey, source.points)).filter((item): item is KomariMetricSeries => item !== undefined)
      result.set(entityId, series)
    }
    return result
  }

  const directSeries = payload.series
  if (isSystemMetricSeries(directSeries)) {
    const entityId = targets[0] ?? 'mmwx-0'
    const series = metricKeys.map((metricKey) => directMetricSeriesFromPayload(entityId, metricKey, directSeries)).filter((item): item is KomariMetricSeries => item !== undefined)
    result.set(entityId, series)
  }

  return result
}

function systemMetricSeriesFromPoints(entityId: string, metricKey: string, points: readonly MmwxSystemSeriesPoint[]): KomariMetricSeries | undefined {
  const mapped = points.map((point) => systemMetricPoint(point, metricKey)).filter((point): point is KomariMetricPoint => point !== undefined)
  if (mapped.length === 0) return undefined
  return {
    metric_key: metricKey,
    entity_id: entityId,
    interval_seconds: inferIntervalSeconds(mapped),
    points: mapped,
  }
}

function directMetricSeriesFromPayload(entityId: string, metricKey: string, payload: MmwxSystemMetricSeries): KomariMetricSeries | undefined {
  const points = directMetricPoints(payload, metricKey)
  if (points.length === 0) return undefined
  return {
    metric_key: metricKey,
    entity_id: entityId,
    interval_seconds: inferIntervalSeconds(points),
    points,
  }
}

function directMetricPoints(payload: MmwxSystemMetricSeries, metricKey: string): KomariMetricPoint[] {
  const source = metricSourceByKey(payload, metricKey)
  return (source ?? []).map((point) => {
    const time = metricPointTime(point)
    const value = numberOrUndefined(point.value)
    if (time === undefined) return undefined
    return { time, value: value ?? null, count: Number.isFinite(value ?? NaN) ? 1 : 0 }
  }).filter((point): point is KomariMetricPoint => point !== undefined)
}

function metricSourceByKey(payload: MmwxSystemMetricSeries, metricKey: string): readonly MmwxMetricPoint[] | undefined {
  switch (metricKey) {
    case 'cpu.usage': return payload.cpu_pct
    case 'memory.used': return payload.mem_used
    case 'memory.total': return payload.mem_total
    case 'swap.used': return payload.swap_used
    case 'swap.total': return payload.swap_total
    case 'load.average':
    case 'load.1': return payload.load1 ?? payload.load
    case 'load.5': return payload.load5
    case 'load.15': return payload.load15
    case 'disk.used': return payload.disk_used
    case 'disk.total': return payload.disk_total
    case 'net.in.rate': return payload.download_speed
    case 'net.out.rate': return payload.upload_speed
    case 'net.total.up':
    case 'traffic.up': return payload.cumulative_up ?? payload.traffic_up
    case 'net.total.down':
    case 'traffic.down': return payload.cumulative_down ?? payload.traffic_down
    case 'process.count': return payload.process
    case 'connections.tcp': return payload.connections
    case 'connections.udp': return payload.connections_udp
    default: return undefined
  }
}

function systemMetricPoint(point: MmwxSystemSeriesPoint, metricKey: string): KomariMetricPoint | undefined {
  const time = metricPointTime(point)
  if (time === undefined) return undefined
  const value = systemMetricValue(point, metricKey)
  return { time, value, count: value === null ? 0 : 1 }
}

function systemMetricValue(point: MmwxSystemSeriesPoint, metricKey: string): number | null {
  switch (metricKey) {
    case 'cpu.usage':
      return numberOrUndefined(point.cpu) ?? null
    case 'memory.used':
      return numberOrUndefined(point.memory) ?? null
    case 'memory.total':
      return numberOrUndefined(point.mem_total) ?? null
    case 'swap.used':
      return numberOrUndefined(point.swap) ?? null
    case 'swap.total':
      return numberOrUndefined(point.swap_total) ?? null
    case 'load.average':
    case 'load.1':
      return loadAverage(point.load)?.load1 ?? null
    case 'load.5':
      return loadAverage(point.load)?.load5 ?? null
    case 'load.15':
      return loadAverage(point.load)?.load15 ?? null
    case 'disk.used':
      return numberOrUndefined(point.disk_used) ?? null
    case 'disk.total':
      return numberOrUndefined(point.disk_total) ?? null
    case 'net.in.rate':
      return numberOrUndefined(point.download_speed ?? point.download) ?? null
    case 'net.out.rate':
      return numberOrUndefined(point.upload_speed ?? point.upload) ?? null
    case 'net.total.up':
    case 'traffic.up':
      return numberOrUndefined(point.cumulative_up ?? point.net_total_up ?? point.traffic_up) ?? null
    case 'net.total.down':
    case 'traffic.down':
      return numberOrUndefined(point.cumulative_down ?? point.net_total_down ?? point.traffic_down) ?? null
    case 'process.count':
      return numberOrUndefined(point.process) ?? null
    case 'connections.tcp':
      return numberOrUndefined(point.connections) ?? null
    case 'connections.udp':
      return numberOrUndefined(point.connections_udp) ?? null
    default:
      return numberOrUndefined(point.load) ?? null
  }
}

function metricPointTime(point: MmwxMetricPoint | MmwxSystemSeriesPoint): string | undefined {
  const raw = 't' in point ? point.t : point.timestamp
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw === 'number') return new Date(raw > 1e12 ? raw : raw * 1000).toISOString()
  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    return new Date(numeric > 1e12 ? numeric : numeric * 1000).toISOString()
  }
  const parsed = Date.parse(String(raw))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

function inferIntervalSeconds(points: readonly KomariMetricPoint[]): number {
  if (points.length < 2) return 300
  const sorted = [...points].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
  const diffs = sorted.slice(1).map((point, index) => {
    const current = Date.parse(point.time)
    const previous = Date.parse(sorted[index].time)
    return Math.max(1, Math.round((current - previous) / 1000))
  }).filter((value) => Number.isFinite(value) && value > 0)
  return diffs[0] ?? 300
}

function summarisePingMetricStats(history: PingHistory, entityIds: readonly string[], taskIds: readonly number[]): KomariPingMetricStat[] {
  const entityFilter = new Set(entityIds)
  const taskFilter = new Set(taskIds)
  const taskById = new Map(history.tasks.map((task) => [task.id, task]))
  const groups = new Map<string, PingHistory['records']>()

  for (const record of history.records) {
    if (entityFilter.size > 0 && !entityFilter.has(record.client)) continue
    if (taskFilter.size > 0 && !taskFilter.has(record.task_id)) continue
    const key = `${record.client}:${record.task_id}`
    const group = groups.get(key) ?? []
    group.push(record)
    groups.set(key, group)
  }

  return [...groups.entries()].map(([key, records]) => {
    const [entityId, taskIdRaw] = key.split(':')
    const taskId = Number(taskIdRaw)
    const task = taskById.get(taskId)
    const values = records
      .map((record) => typeof record.value === 'number' && record.value >= 0 ? record.value : undefined)
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right)
    const total = records.length
    const valid = values.length
    const loss = total > 0 ? Math.round(((total - valid) / total) * 100) : 0
    const latest = latestPingValue(records)
    const min = valid > 0 ? values[0] : 0
    const max = valid > 0 ? values[values.length - 1] : 0
    const avg = valid > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / valid) : 0
    const p50 = valid > 0 ? percentile(values, 0.5) : null
    const p99 = valid > 0 ? percentile(values, 0.99) : null
    const stddev = valid > 0 ? standardDeviation(values) : null
    return {
      entity_id: entityId,
      task_id: taskId,
      name: task?.name ?? `Ping ${taskId}`,
      type: task?.type ?? 'icmp',
      interval: task?.interval ?? 30,
      total,
      valid,
      loss,
      min,
      max,
      avg,
      latest,
      p50,
      p99,
      stddev,
      p99_p50_ratio: p50 && p50 > 0 && p99 !== null ? Number((p99 / p50).toFixed(2)) : null,
    }
  })
}

function latestPingValue(records: readonly PingHistory['records'][number][]): number | null {
  const latest = [...records].sort((left, right) => Date.parse(left.time) - Date.parse(right.time)).at(-1)
  return latest && typeof latest.value === 'number' && latest.value >= 0 ? latest.value : null
}

function percentile(values: readonly number[], ratio: number): number | null {
  if (values.length === 0) return null
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))
  return values[index] ?? null
}

function standardDeviation(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length
  return Number(Math.sqrt(variance).toFixed(2))
}

function normalizeEntityId(value: string): string {
  if (/^mmwx-(0|[1-9]\d*)$/.test(value)) return value
  if (/^(0|[1-9]\d*)$/.test(value)) return `mmwx-${value}`
  return value
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
