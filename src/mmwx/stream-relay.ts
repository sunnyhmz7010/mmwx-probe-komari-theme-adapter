import WebSocket from 'ws'

import type { ProbeHistoryBuffer } from './history-buffer.js'
import type { ProbePayload, ProbeSeriesPayload, SeriesQuery } from './types.js'

const MAX_FRAME_AGE_MS = 12_000
const IDLE_CLOSE_MS = 30_000
const RECONNECT_MAX_MS = 30_000

export interface ProbeOrigin {
  fetchProbe(): Promise<ProbePayload>
  fetchSeries(query: SeriesQuery): Promise<ProbeSeriesPayload>
  streamUrl(): string
  probeHeaders(): Record<string, string>
}

/**
 * ProbeStreamRelay 主控降载：单进程内维护一条到主控探针的共享 WebSocket，
 * 把实时快照帧广播给所有下游访客连接，并对 HTTP 快照请求复用最近一帧，
 * 避免按访客数增加主控 WebSocket 与实时数据查询。
 */
export class ProbeStreamRelay {
  private upstream: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private latestPayload: ProbePayload | null = null
  private latestAt = 0
  private snapshotRequest: Promise<ProbePayload> | null = null
  private readonly clients = new Set<WebSocket>()

  public constructor(
    private readonly origin: ProbeOrigin,
    private readonly history?: ProbeHistoryBuffer,
  ) {}

  public async fetchProbe(): Promise<ProbePayload> {
    if (this.latestPayload !== null && this.frameAgeMs() <= MAX_FRAME_AGE_MS) {
      return this.latestPayload
    }
    return this.ensureSnapshot()
  }

  public async fetchSeries(query: SeriesQuery): Promise<ProbeSeriesPayload> {
    return this.origin.fetchSeries(query)
  }

  public subscribe(downstream: WebSocket): void {
    this.clients.add(downstream)
    this.cancelIdleClose()
    const latest = this.latestPayload
    if (latest !== null && this.frameAgeMs() <= MAX_FRAME_AGE_MS) {
      this.sendTo(downstream, latest)
    } else {
      void this.seed(downstream)
    }
    this.ensureUpstream()
  }

  public unsubscribe(downstream: WebSocket): void {
    this.clients.delete(downstream)
    this.onClientCountChanged()
  }

  public close(): void {
    for (const client of this.clients) {
      try {
        client.close(1001, 'server shutting down')
      } catch {
        // 连接可能已关闭。
      }
    }
    this.clients.clear()
    this.cancelReconnect()
    this.cancelIdleClose()
    this.closeUpstream()
  }

  private async ensureSnapshot(): Promise<ProbePayload> {
    if (this.snapshotRequest) return this.snapshotRequest
    this.snapshotRequest = this.origin.fetchProbe()
      .then((payload) => {
        this.remember(payload)
        return payload
      })
      .finally(() => {
        this.snapshotRequest = null
      })
    return this.snapshotRequest
  }

  private async seed(downstream: WebSocket): Promise<void> {
    try {
      const payload = await this.ensureSnapshot()
      if (downstream.readyState === WebSocket.OPEN) this.sendTo(downstream, payload)
    } catch (error) {
      console.warn('ProbeStreamHub seed snapshot failed', error)
    }
  }

  private frameAgeMs(): number {
    return Date.now() - this.latestAt
  }

  private remember(payload: ProbePayload): void {
    this.latestPayload = payload
    this.latestAt = Date.now()
    // 每一帧（WS 实时帧或 HTTP 快照）同时喂给历史缓冲，形成逐次密度采样。
    this.history?.ingest(payload, new Date(this.latestAt))
    for (const client of this.clients) {
      this.sendTo(client, payload)
    }
  }

  private sendTo(client: WebSocket, payload: ProbePayload): void {
    try {
      client.send(JSON.stringify(payload))
    } catch {
      try {
        client.close(1011, 'send failed')
      } catch {
        // 连接可能已关闭。
      }
    }
  }

  private ensureUpstream(): void {
    if (this.clients.size === 0) return
    if (this.upstream && (this.upstream.readyState === WebSocket.OPEN || this.upstream.readyState === WebSocket.CONNECTING)) return
    this.connectUpstream()
  }

  private connectUpstream(): void {
    const socket = new WebSocket(this.origin.streamUrl(), {
      headers: this.origin.probeHeaders(),
    })
    this.upstream = socket

    socket.on('open', () => {
      this.reconnectAttempts = 0
      this.cancelReconnect()
    })
    socket.on('message', (data) => {
      if (this.upstream !== socket) return
      try {
        this.remember(JSON.parse(data.toString()) as ProbePayload)
      } catch {
        // 忽略单条无法解析的上游帧，保持连接继续。
      }
    })
    socket.on('close', () => {
      if (this.upstream !== socket) return
      this.upstream = null
      this.onUpstreamClosed()
    })
    socket.on('error', () => {
      // close 事件随后触发，统一在 onUpstreamClosed 中处理。
    })
  }

  private onUpstreamClosed(): void {
    if (this.clients.size > 0) this.scheduleReconnect()
  }

  private onClientCountChanged(): void {
    if (this.clients.size > 0) {
      this.cancelIdleClose()
      this.ensureUpstream()
    } else {
      this.scheduleIdleClose()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.clients.size === 0) return
    const delay = Math.min(1_000 * (2 ** this.reconnectAttempts), RECONNECT_MAX_MS)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.ensureUpstream()
    }, delay)
  }

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private scheduleIdleClose(): void {
    if (this.idleTimer) return
    this.cancelReconnect()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.clients.size > 0) return
      this.reconnectAttempts = 0
      this.closeUpstream()
    }, IDLE_CLOSE_MS)
  }

  private cancelIdleClose(): void {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private closeUpstream(): void {
    const socket = this.upstream
    this.upstream = null
    if (!socket) return
    try {
      socket.close(1000, 'ProbeHub idle')
    } catch {
      // 上游已关闭。
    }
  }
}
