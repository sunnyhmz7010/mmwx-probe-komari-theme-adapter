export interface ProbePayload {
  servers: ProbeServer[]
  updatedAt?: string | number | null
}

export interface ProbeServer {
  id?: string | number
  name?: string | null
  host?: string | null
  region?: string | null
  country?: string | null
  online?: boolean | null
  cpu?: number | string | null
  memory?: number | string | null
  load?: number | string | readonly (number | string | null)[] | null
  upload?: number | string | null
  download?: number | string | null
  uplink?: number | string | null
  downlink?: number | string | null
  totalUpload?: number | string | null
  totalDownload?: number | string | null
  trafficPeriod?: string | null
  daily_traffic?: ProbeDailyTraffic[] | null
  traffic_used_up?: number | string | null
  traffic_used_down?: number | string | null
  traffic_used_total?: number | string | null
  traffic_used?: number | string | null
  period_start?: string | number | null
  period_end?: string | number | null
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
  name?: string | null
  value?: number | string | null
  loss?: number | string | null
  latency?: number | string | null
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
  [key: string]: string | number | boolean | undefined
}

export interface ProbeSeriesPayload {
  pings?: ProbePingSeries[]
  systems?: MmwxSystemSeries[]
}

export interface ProbePingSeries {
  serverId?: string | number
  route?: string | null
  points: ProbeSeriesPoint[]
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
}
