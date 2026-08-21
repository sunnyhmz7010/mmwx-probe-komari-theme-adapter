import type { IncomingMessage, ServerResponse } from 'node:http'

import type { KomariDataService } from '../komari/service.js'

export interface ApiRouter {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>
}

type Query = Record<string, string>

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Query
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
        if (url.pathname === '/api/nodes') {
          const snapshot = await service.getSnapshot()
          return json(response, 200, envelope(snapshot.nodes))
        }
        if (url.pathname === '/api/public') {
          const snapshot = await service.getSnapshot()
          return json(response, 200, envelope({ nodes: snapshot.nodes.length }))
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
  const params = rpc.params ?? {}
  if (rpc.method === 'nodes.list' || rpc.method === 'public.nodes') {
    const snapshot = await service.getSnapshot()
    return json(response, 200, rpcResult(id, snapshot.nodes))
  }
  if (rpc.method === 'records.ping') {
    return json(response, 200, rpcResult(id, await service.getPingHistory(params)))
  }
  if (rpc.method === 'records.load') {
    if (!isInternalUuid(params.uuid)) return json(response, 200, rpcError(id, -32602, 'Invalid params'))
    return json(response, 200, rpcResult(id, await service.getLoadHistory(params.uuid, params)))
  }
  return json(response, 200, rpcError(id, -32601, 'Method not found'))
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
