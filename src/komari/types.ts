export interface KomariSnapshot {
  nodes: KomariNode[]
  records: KomariRecord[]
}

export interface KomariNode {
  uuid: string
  name: string
  online: boolean
  region?: string
  cpu?: number
  memory?: number
  load?: KomariLoad
  network?: KomariNetwork
  traffic_period?: string
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
  uplink?: number
  downlink?: number
}

export interface KomariRecord {
  uuid: string
  online: boolean
  updated_at: string
  cpu?: { usage: number }
  ram?: { used: number }
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
}

export interface AdapterError extends Error {
  statusCode?: number
}
