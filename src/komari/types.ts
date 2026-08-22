export interface KomariSnapshot {
  nodes: KomariNode[]
  records: KomariRecord[]
}

export interface KomariPublicNode {
  uuid: string
  name: string
  cpu_name: string
  virtualization: string
  arch: string
  cpu_cores: number
  cpu_physical_cores: number
  os: string
  kernel_version: string
  gpu_name: string
  region: string
  mem_total: number
  swap_total: number
  disk_total: number
  weight: number
  price: number
  billing_cycle: number
  auto_renewal: boolean
  currency: string
  expired_at: string
  group: string
  tags: string
  hidden: boolean
  traffic_limit: number
  traffic_limit_type: string
  created_at: string
  updated_at: string
  public_remark?: string
}

export interface KomariNodeStatus {
  client: string
  time: string
  cpu: number
  gpu: number
  ram: number
  ram_total: number
  swap: number
  swap_total: number
  load: number
  load5: number
  load15: number
  temp: number
  disk: number
  disk_total: number
  net_in: number
  net_out: number
  net_total_up: number
  net_total_down: number
  net_total_out?: number
  net_total_down_alt?: number
  process: number
  connections: number
  connections_udp: number
  online: boolean
  uptime: number
}

export type KomariNodeStatusMap = Record<string, KomariNodeStatus>

export interface KomariRecentReport {
  uuid: string
  cpu?: { usage?: number }
  ram?: { total?: number; used?: number }
  swap?: { total?: number; used?: number }
  load?: { load1?: number; load5?: number; load15?: number }
  disk?: { total?: number; used?: number }
  network?: {
    up?: number
    down?: number
    totalUp?: number
    totalDown?: number
  }
  connections?: { tcp?: number; udp?: number }
  uptime?: number
  process?: number
  updated_at: string
}

export interface KomariPublicSettings {
  sitename: string
  description: string
  theme: string
  theme_settings?: Record<string, unknown> | null
  private_site: boolean
  record_enabled: boolean
  record_preserve_time: number
  ping_record_preserve_time: number
  custom_head: string
  custom_body: string
  oauth_enable: boolean
  oauth_provider: string
  disable_password_login: boolean
  cors_origin_check_enabled: boolean
  visitor_audit_enabled: boolean
}

export interface KomariVersionInfo {
  version: string
  hash: string
}

export interface KomariLoadRecord {
  client: string
  time: string
  cpu: number
  gpu: number
  ram: number
  ram_total: number
  swap: number
  swap_total: number
  load: number
  temp: number
  disk: number
  disk_total: number
  net_in: number
  net_out: number
  net_total_up: number
  net_total_down: number
  traffic_up?: number
  traffic_down?: number
  process: number
  connections: number
  connections_udp: number
}

export interface KomariLoadRecords {
  count: number
  records: KomariLoadRecord[]
  has_gpu_data?: boolean
  gpu_devices?: string[]
}

export interface KomariCommonRecords {
  count: number
  records: Array<KomariLoadRecord | KomariPingRecord>
  has_gpu_data?: boolean
  gpu_devices?: string[]
  from?: string
  to?: string
  tasks?: KomariPingRecordTask[]
  basic_info?: { clients: string[] }
}

export interface KomariPingRecord {
  task_id: number
  time: string
  value: number
  client: string
}

export interface KomariPingRecordTask {
  id: number
  name: string
  type: string
  interval: number
  default_on: boolean
  total: number
  loss: number
  min: number
  max: number
  avg: number
}

export interface KomariMetricPoint {
  time: string
  value: number | null
  count: number
}

export interface KomariMetricSeries {
  metric_key: string
  entity_id: string
  tags?: Record<string, string>
  interval_seconds: number
  points: KomariMetricPoint[]
}

export interface KomariQueryMetrics {
  start?: string
  end?: string
  count: number
  series: KomariMetricSeries[]
}

export interface KomariPingMetricStat {
  entity_id: string
  task_id: number
  name: string
  type: string
  interval: number
  total: number
  valid: number
  loss: number
  min: number
  max: number
  avg: number
  latest: number | null
  p50: number | null
  p99: number | null
  stddev: number | null
  p99_p50_ratio: number | null
}

export interface KomariPingMetricStats {
  count: number
  stats: KomariPingMetricStat[]
}

export interface KomariPingRecords {
  count: number
  records: KomariPingRecord[]
  tasks?: KomariPingRecordTask[]
  basic_info?: { clients: string[] }
}

export interface KomariNode {
  uuid: string
  name: string
  online: boolean
  region?: string
  cpu?: number
  memory?: number
  ram?: KomariResource
  disk?: KomariResource
  load?: KomariLoad
  network?: KomariNetwork
  traffic_period?: string
}

export interface KomariResource {
  used?: number
  total?: number
}

export interface KomariLoad {
  load1?: number
  load5?: number
  load15?: number
}

export interface KomariNetwork {
  up?: number
  down?: number
  totalUp?: number
  totalDown?: number
  total?: number
  uplink?: number
  downlink?: number
}

export interface KomariRecord {
  uuid: string
  online: boolean
  updated_at: string
  cpu?: { usage: number }
  ram?: KomariResource
  disk?: KomariResource
  load?: KomariLoad
  network?: KomariNetwork
}

export interface PingHistory {
  count: number
  records: PingHistoryRecord[]
  tasks: PingTask[]
  basic_info: { clients: string[] }
}

export interface PingHistoryRecord {
  task_id: number
  time: string
  value: number | null
  loss?: number | null
  client: string
}

export interface PingTask {
  id: number
  name: string
  clients: string[]
  default_on: boolean
  type: 'icmp'
  interval: number
}

export interface KomariPublicPingTask extends PingTask {
  target?: string
}

export interface LoadHistory {
  count: number
  records: LoadHistoryRecord[]
}

export interface LoadHistoryRecord {
  client: string
  time: string
  cpu?: number
  ram?: number
  load?: number
  net_out?: number
  net_in?: number
  net_total_up?: number
  net_total_down?: number
  swap?: number
  swap_total?: number
  mem_total?: number
  disk?: number
  disk_total?: number
  process?: number
  connections?: number
  connections_udp?: number
}

export interface AdapterError extends Error {
  statusCode?: number
}
