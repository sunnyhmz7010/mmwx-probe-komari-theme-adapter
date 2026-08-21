export interface ProbePayload {
  servers: ProbeServer[]
  updatedAt?: string | number | null
}

export interface ProbeServer {
  id?: string | number
  name?: string | null
  host?: string | null
  cpu_name?: string | null
  cpu_model?: string | null
  virtualization?: string | null
  arch?: string | null
  cpu_cores?: number | string | null
  cpu_physical_cores?: number | string | null
  os?: string | null
  kernel_version?: string | null
  kernel?: string | null
  gpu_name?: string | null
  gpu?: number | string | null
  region?: string | null
  region_country?: string | null
  region_name?: string | null
  region_city?: string | null
  provider_name?: string | null
  provider_url?: string | null
  country?: string | null
  online?: boolean | null
  cpu?: number | string | null
  cpu_pct?: number | string | null
  memory?: number | string | null
  mem_used?: number | string | null
  mem_total?: number | string | null
  swap?: number | string | null
  swap_total?: number | string | null
  disk_used?: number | string | null
  disk_total?: number | string | null
  load?: number | string | readonly (number | string | null)[] | null
  loadavg?: string | null
  temp?: number | string | null
  upload?: number | string | null
  upload_speed?: number | string | null
  download?: number | string | null
  download_speed?: number | string | null
  uplink?: number | string | null
  downlink?: number | string | null
  totalUpload?: number | string | null
  totalDownload?: number | string | null
  net_total_up?: number | string | null
  net_total_down?: number | string | null
  trafficPeriod?: string | null
  daily_traffic?: ProbeDailyTraffic[] | null
  traffic_used_up?: number | string | null
  traffic_used_down?: number | string | null
  traffic_used_total?: number | string | null
  traffic_used?: number | string | null
  cumulative_up?: number | string | null
  cumulative_down?: number | string | null
  traffic_stats_mode?: string | null
  period_start?: string | number | null
  period_end?: string | number | null
  process?: number | string | null
  connections?: number | string | null
  connections_udp?: number | string | null
  uptime?: number | string | null
  weight?: number | string | null
  price?: number | string | null
  billing_cycle?: number | string | null
  auto_renewal?: boolean | null
  currency?: string | null
  expired_at?: string | number | null
  expires_at?: string | number | null
  group?: string | null
  tags?: string | null
  hidden?: boolean | null
  traffic_limit?: number | string | null
  traffic_limit_type?: string | null
  created_at?: string | number | null
  updated_at?: string | number | null
  public_remark?: string | null
  ping?: ProbeBucket[] | null
  routes?: ProbeReturnRoute[] | null
}

export interface ProbeDailyTraffic {
  date?: string | null
  uplink?: number | string | null
  downlink?: number | string | null
  total?: number | string | null
}

export interface ProbeBucket {
  key?: string | null
  name?: string | null
  label?: string | null
  value?: number | string | null
  loss?: number | string | null
  latency?: number | string | null
  current_ms?: number | string | null
  loss_pct?: number | string | null
  buckets?: MmwxProbeSeriesBucket[]
}

export interface ProbeReturnRoute {
  name?: string | null
  host?: string | null
  region?: string | null
  country?: string | null
  latency?: number | string | null
  loss?: number | string | null
}

export interface SeriesQuery {
  hours?: number | string
  uuid?: string
  server?: number | string
  range?: string
  metric?: string
  all?: number | string
  [key: string]: string | number | boolean | readonly string[] | readonly number[] | undefined
}

export interface ProbeSeriesPayload {
  pings?: ProbePingSeries[]
  systems?: MmwxSystemSeries[]
  success?: boolean
  bucket_sec?: number
  generated_at?: number
  series?: MmwxProbeSeries | MmwxSystemMetricSeries
  all_series?: MmwxProbeSeries[]
}

export interface ProbePingSeries {
  serverId?: string | number
  route?: string | null
  points: ProbeSeriesPoint[]
}

export interface MmwxProbeSeries {
  key?: string | null
  label?: string | null
  current_ms?: number | string | null
  loss_pct?: number | string | null
  buckets?: MmwxProbeSeriesBucket[]
}

export interface MmwxProbeSeriesBucket {
  ms?: number | string | null
  loss?: number | string | null
}

export interface MmwxSystemMetricSeries {
  cpu_pct?: MmwxMetricPoint[]
  mem_used?: MmwxMetricPoint[]
  mem_total?: MmwxMetricPoint[]
  swap_used?: MmwxMetricPoint[]
  swap_total?: MmwxMetricPoint[]
  disk_used?: MmwxMetricPoint[]
  disk_total?: MmwxMetricPoint[]
  load1?: MmwxMetricPoint[]
  load5?: MmwxMetricPoint[]
  load15?: MmwxMetricPoint[]
  load?: MmwxMetricPoint[]
  upload_speed?: MmwxMetricPoint[]
  download_speed?: MmwxMetricPoint[]
  traffic_up?: MmwxMetricPoint[]
  traffic_down?: MmwxMetricPoint[]
  cumulative_up?: MmwxMetricPoint[]
  cumulative_down?: MmwxMetricPoint[]
  process?: MmwxMetricPoint[]
  connections?: MmwxMetricPoint[]
  connections_udp?: MmwxMetricPoint[]
}

export interface MmwxMetricPoint {
  t?: string | number
  timestamp?: string | number
  value?: number | string | null
}

export interface ProbeSeriesPoint {
  timestamp: string | number
  value?: number | string | null
  loss?: number | string | null
}

export interface MmwxSystemSeries {
  serverId?: string | number
  points: MmwxSystemSeriesPoint[]
}

export interface MmwxSystemSeriesPoint {
  timestamp: string | number
  cpu?: number | string | null
  memory?: number | string | null
  load?: number | string | readonly (number | string | null)[] | null
  upload?: number | string | null
  download?: number | string | null
  upload_speed?: number | string | null
  download_speed?: number | string | null
  mem_total?: number | string | null
  swap?: number | string | null
  swap_total?: number | string | null
  disk_used?: number | string | null
  disk_total?: number | string | null
  net_total_up?: number | string | null
  net_total_down?: number | string | null
  cumulative_up?: number | string | null
  cumulative_down?: number | string | null
  traffic_up?: number | string | null
  traffic_down?: number | string | null
  process?: number | string | null
  connections?: number | string | null
  connections_udp?: number | string | null
}
