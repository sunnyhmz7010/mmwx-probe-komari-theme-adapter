import WebSocket from 'ws'

import type { AppConfig } from '../config.js'
import type { ProbePayload, ProbeSeriesPayload, SeriesQuery } from './types.js'

const PROBE_PATH = '/api/public/probe-servers'
const SERIES_PATH = '/api/public/probe-series'
const WS_PATH = '/api/public/probe-ws'

export interface Closeable {
  close(): void
}

export class UpstreamError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

export class MmwxClient {
  public constructor(private readonly config: AppConfig) {}

  public streamUrl(): string {
    return this.wsUrl()
  }

  public probeHeaders(): Record<string, string> {
    return {
      'X-MMwx-Probe-Token': this.config.probeToken,
    }
  }

  public async fetchProbe(): Promise<ProbePayload> {
    return this.fetchJson<ProbePayload>(PROBE_PATH)
  }

  public async fetchSeries(query: SeriesQuery): Promise<ProbeSeriesPayload> {
    return this.fetchJson<ProbeSeriesPayload>(SERIES_PATH, query)
  }

  public openStream(onMessage: (payload: ProbePayload) => void, onClose: () => void): Closeable {
    const ws = new WebSocket(this.wsUrl(), {
      headers: this.probeHeaders(),
    })

    let closed = false
    const finish = (): void => {
      if (closed) return
      closed = true
      onClose()
    }

    ws.on('message', (data) => {
      if (typeof data !== 'string' && !Buffer.isBuffer(data)) return
      try {
        onMessage(JSON.parse(data.toString()) as ProbePayload)
      } catch {
        // 忽略单条无法解析的上游消息，保持流继续；HTTP 轮询仍可提供数据。
      }
    })
    ws.on('close', finish)
    ws.on('error', finish)

    return {
      close: () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      },
    }
  }

  private async fetchJson<T>(pathname: string, query: SeriesQuery = {}): Promise<T> {
    const url = new URL(pathname, this.config.mmwxOrigin)
    for (const [key, value] of Object.entries(query)) {
      if (key !== 'origin' && value !== undefined) url.searchParams.set(key, String(value))
    }

    const response = await fetch(url, {
      headers: {
        'X-MMwx-Probe-Token': this.config.probeToken,
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      throw new UpstreamError(`MMWX upstream ${pathname} failed with status ${response.status}`, response.status)
    }
    return await response.json() as T
  }

  private wsUrl(): string {
    const url = new URL(WS_PATH, this.config.mmwxOrigin)
    if (url.protocol === 'https:') {
      url.protocol = 'wss:'
    } else if (url.protocol === 'http:') {
      url.protocol = 'ws:'
    }
    return url.toString()
  }
}
