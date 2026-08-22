import type { IncomingMessage, ServerResponse } from 'node:http'

import type { KomariDataService } from '../komari/service.js'
import type { SeriesQuery } from '../mmwx/types.js'

export interface ApiRouter {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>
}

type Query = Record<string, string>

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: SeriesQuery
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
}

export function createApiRouter(service: KomariDataService): ApiRouter {
  return {
    async handle(request, response) {
      const url = new URL(request.url ?? '/', 'http://adapter.local')
      if (!url.pathname.startsWith('/api/')) return false

      try {
        if (url.pathname === '/api/rpc2') {
          if (request.method !== 'POST') return methodNotAllowed(response)
          return await handleRpc2(service, request, response)
        }

        if (request.method !== 'GET') return methodNotAllowed(response)
        if (url.pathname === '/api/probe') {
          return json(response, 200, await service.getProbePayload())
        }
        if (url.pathname === '/api/series') {
          return json(response, 200, await service.getSeriesPayload(queryFrom(url)))
        }
        if (url.pathname === '/api/nodes') {
          const snapshot = await service.getSnapshot()
          return json(response, 200, envelope(snapshot.nodes))
        }
        if (url.pathname === '/api/public') {
          return json(response, 200, envelope(await service.getPublicSettings()))
        }
        if (url.pathname === '/api/me') {
          return json(response, 200, { logged_in: false })
        }
        if (url.pathname === '/api/records/ping') {
          return json(response, 200, await service.getPingHistory(queryFrom(url)))
        }
        if (url.pathname === '/api/records/load') {
          const query = queryFrom(url)
          if (!isInternalUuid(query.uuid)) return json(response, 400, envelope(null, 'invalid uuid', 'error'))
          return json(response, 200, await service.getLoadHistory(query.uuid, query))
        }
        return json(response, 404, envelope(null, 'not found', 'error'))
      } catch (error: unknown) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : 500
        return json(response, statusCode, envelope(null, error instanceof Error ? error.message : 'upstream error', 'error'))
      }
    },
  }
}

function envelope(data: unknown, message = 'success', status = 'success'): { status: string; message: string; data: unknown } {
  return { status, message, data }
}

function methodNotAllowed(response: ServerResponse): boolean {
  return json(response, 405, envelope(null, 'method not allowed', 'error'))
}

function json(response: ServerResponse, statusCode: number, payload: unknown): boolean {
  response.writeHead(statusCode, JSON_HEADERS)
  response.end(JSON.stringify(payload))
  return true
}

function queryFrom(url: URL): Query {
  return Object.fromEntries(url.searchParams.entries())
}

function isInternalUuid(value: unknown): value is string {
  return typeof value === 'string' && /^mmwx-(0|[1-9]\d*)$/.test(value)
}

async function handleRpc2(service: KomariDataService, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  let rpc: JsonRpcRequest
  try {
    rpc = JSON.parse(await readBody(request)) as JsonRpcRequest
  } catch {
    return json(response, 200, rpcError(null, -32700, 'Parse error'))
  }

  const id = rpc.id ?? null
  return json(response, 200, await dispatchRpc2(service, rpc))
}

export async function dispatchRpc2(service: KomariDataService, rpc: JsonRpcRequest): Promise<unknown> {
  const id = rpc.id ?? null
  const params = rpc.params ?? {}
  try {
    if (rpc.method === 'rpc.ping') return rpcResult(id, 'pong')
    if (rpc.method === 'nodes.list' || rpc.method === 'public.nodes' || rpc.method === 'public:getNodesInformation') {
      if (rpc.method === 'public:getNodesInformation') {
        return rpcResult(id, await service.getNodesInformation())
      }
      const snapshot = await service.getSnapshot()
      return rpcResult(id, snapshot.nodes)
    }
    if (rpc.method === 'public:getPublicSettings') {
      return rpcResult(id, await service.getPublicSettings())
    }
    if (rpc.method === 'common:getNodes') {
      return rpcResult(id, await service.getNodes())
    }
    if (rpc.method === 'common:getNodesLatestStatus') {
      return rpcResult(id, await service.getNodesLatestStatus())
    }
    if (rpc.method === 'public:getClientRecentRecords') {
      return rpcResult(id, await service.getClientRecentRecords())
    }
    if (rpc.method === 'public:getVersion') {
      return rpcResult(id, await service.getVersion())
    }
    if (rpc.method === 'records.ping' || rpc.method === 'public:getPingRecords') {
      if (rpc.method === 'public:getPingRecords') {
        return rpcResult(id, await service.getPingRecords(params))
      }
      return rpcResult(id, await service.getPingHistory(params))
    }
    if (rpc.method === 'common:getRecords') {
      return rpcResult(id, await service.getRecords(params))
    }
    if (rpc.method === 'records.load' || rpc.method === 'public:getRecordsByUUID') {
      if (!isInternalUuid(params.uuid)) return rpcError(id, -32602, 'Invalid params')
      if (rpc.method === 'public:getRecordsByUUID') {
        return rpcResult(id, await service.getLoadRecords(params.uuid, params))
      }
      return rpcResult(id, await service.getLoadHistory(params.uuid, params))
    }
    if (rpc.method === 'public:queryMetrics') {
      return rpcResult(id, await service.getQueryMetrics(params))
    }
    if (rpc.method === 'public:getPingMetricStats') {
      return rpcResult(id, await service.getPingMetricStats(params))
    }
    if (rpc.method === 'public:getPublicPingTasks') {
      return rpcResult(id, await service.getPublicPingTasks(params))
    }
    return rpcError(id, -32601, 'Method not found')
  } catch (error: unknown) {
    return rpcError(id, -32000, error instanceof Error ? error.message : 'Upstream error')
  }
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown): { jsonrpc: '2.0'; id: JsonRpcRequest['id']; result: unknown } {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string): { jsonrpc: '2.0'; id: JsonRpcRequest['id']; error: { code: number; message: string } } {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}
