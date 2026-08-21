import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'

import type { AppConfig } from '../config.js'
import { KomariDataService } from '../komari/service.js'
import type { LoadedTheme } from '../theme/types.js'
import type { ApiRouter } from './api.js'
import { dispatchRpc2 } from './api.js'
import { serveStatic } from './static.js'
import type { MmwxClient } from '../mmwx/client.js'

export interface ServerHandle {
  listen(): Promise<void>
  close(): Promise<void>
}

export function createHttpServer(config: AppConfig, theme: LoadedTheme, api: ApiRouter, mmwx: MmwxClient): ServerHandle {
  const snapshotService = new KomariDataService(mmwx, config.cacheTtlMs)
  const clientsWss = new WebSocketServer({ noServer: true })
  const streamWss = new WebSocketServer({ noServer: true })
  const clients = new Set<WebSocket>()
  const streams = new Set<{ downstream: WebSocket; upstream: WebSocket }>()
  const server = http.createServer(async (request, response) => {
    if (await api.handle(request, response)) return
    if (await serveStatic(theme.directory, request, response)) return
    response.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
    response.end(JSON.stringify({ status: 'error', message: 'not found', data: null }))
  })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://adapter.local')
    if (url.pathname === '/api/rpc2') {
      clientsWss.handleUpgrade(request, socket, head, (ws) => {
        clients.add(ws)
        ws.on('close', () => clients.delete(ws))
        ws.on('message', async (raw) => {
          try {
            const rpc = JSON.parse(raw.toString()) as { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, string | number | boolean | undefined> }
            ws.send(JSON.stringify(await dispatchRpc2(snapshotService, rpc)))
          } catch {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
          }
        })
      })
      return
    }
    if (url.pathname === '/api/clients') {
      clientsWss.handleUpgrade(request, socket, head, (ws) => {
        clients.add(ws)
        ws.on('close', () => clients.delete(ws))
        ws.on('message', async (raw) => {
          if (raw.toString().trim() !== 'get') return
          const snapshot = await snapshotService.getSnapshot()
          ws.send(JSON.stringify({
            online: snapshot.nodes.some((node) => node.online),
            data: snapshot.nodes,
          }))
        })
      })
      return
    }
    if (url.pathname === '/api/stream') {
      streamWss.handleUpgrade(request, socket, head, (downstream) => {
        const upstream = new WebSocket(mmwx.streamUrl(), {
          headers: mmwx.probeHeaders(),
        })
        const pair = { downstream, upstream }
        streams.add(pair)

        const closePair = (code = 1000, reason = 'closed'): void => {
          if (downstream.readyState === WebSocket.OPEN || downstream.readyState === WebSocket.CONNECTING) downstream.close(code, reason)
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(code, reason)
        }

        const pending: Array<{ data: WebSocket.RawData; isBinary: boolean }> = []
        downstream.on('message', (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data, { binary: isBinary })
          } else if (upstream.readyState === WebSocket.CONNECTING) {
            pending.push({ data, isBinary })
          }
        })
        upstream.on('open', () => {
          for (const message of pending.splice(0)) {
            upstream.send(message.data, { binary: message.isBinary })
          }
          upstream.on('message', (data, isBinary) => {
            if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary: isBinary })
          })
        })
        upstream.on('close', () => closePair())
        upstream.on('error', () => closePair(1011, 'upstream error'))
        downstream.on('close', () => {
          streams.delete(pair)
          closePair()
        })
        downstream.on('error', () => closePair(1011, 'downstream error'))
      })
      return
    }
    socket.destroy()
  })

  return {
    listen: async () => {
      await new Promise<void>((resolve) => server.listen(config.port, resolve))
    },
    close: async () => {
      for (const ws of clients) ws.close()
      for (const pair of streams) {
        pair.upstream.close()
        pair.downstream.close()
      }
      await new Promise<void>((resolve) => clientsWss.close(() => resolve()))
      await new Promise<void>((resolve) => streamWss.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
