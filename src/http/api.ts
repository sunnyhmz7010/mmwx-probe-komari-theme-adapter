import type { IncomingMessage, ServerResponse } from 'node:http'

import type { KomariDataService } from '../komari/service.js'
import type { SeriesQuery } from '../mmwx/types.js'

export interface ApiRouter {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>
}

export interface ApiRouterOptions {
  adminToken?: string
}

type Query = Record<string, string>

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: SeriesQuery
}

interface RpcMethodHelp {
  name: string
  summary: string
  description: string
  params: Array<{ name: string; type: string; description: string }>
  returns: string
}

const RPC_METHOD_HELP: Record<string, RpcMethodHelp> = {
  'common:getNodes': {
    name: 'common:getNodes',
    summary: '获取节点信息',
    description: '获取所有可见节点的 Komari 客户端信息。',
    params: [],
    returns: 'Record<string, Client>',
  },
  'common:getNodesLatestStatus': {
    name: 'common:getNodesLatestStatus',
    summary: '获取节点最新状态',
    description: '获取所有可见节点的最新运行状态。',
    params: [],
    returns: 'Record<string, NodeStatus>',
  },
  'common:getNodeRecentStatus': {
    name: 'common:getNodeRecentStatus',
    summary: '获取节点最近状态',
    description: '获取指定节点的最近状态记录。',
    params: [{ name: 'uuid', type: 'string', description: '节点 UUID' }],
    returns: '{ count: number; records: StatusRecord[] }',
  },
  'common:getPublicInfo': {
    name: 'common:getPublicInfo',
    summary: '获取公开站点信息',
    description: '获取公开站点设置与主题配置。',
    params: [],
    returns: 'PublicInfo',
  },
  'common:getBackendVersion': {
    name: 'common:getBackendVersion',
    summary: '获取后端版本',
    description: '获取适配器后端版本与构建哈希。',
    params: [],
    returns: 'VersionInfo',
  },
  'common:getMe': {
    name: 'common:getMe',
    summary: '获取当前用户',
    description: '获取当前访问者的登录状态。',
    params: [],
    returns: 'MeInfo',
  },
  'common:getRecords': {
    name: 'common:getRecords',
    summary: '获取历史记录',
    description: '获取节点负载或 Ping 历史记录。',
    params: [{ name: 'type', type: 'string', description: 'load 或 ping' }],
    returns: 'RecordsResponse',
  },
}

const RPC_METHODS = [
  'rpc.ping',
  'rpc.getMethods',
  'rpc.getHelp',
  'rpc.getVersion',
  ...Object.keys(RPC_METHOD_HELP),
  'public:getMe',
  'public:getNodesInformation',
  'public:getClientRecentRecords',
  'public:getPublicInfo',
  'public:getVersion',
  'public:getPingRecords',
  'public:getRecordsByUUID',
  'public:queryMetrics',
  'public:getPingMetricStats',
  'public:getPublicPingTasks',
]

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
}

export function createApiRouter(service: KomariDataService, options: ApiRouterOptions = {}): ApiRouter {
  return {
    async handle(request, response) {
      const url = new URL(request.url ?? '/', 'http://adapter.local')
      if (!url.pathname.startsWith('/api/')) return false

      try {
        if (url.pathname === '/api/rpc2') {
          if (request.method !== 'POST') return methodNotAllowed(response)
          return await handleRpc2(service, request, response)
        }

        if (url.pathname === '/api/version' && request.method === 'GET') {
          return json(response, 200, envelope(await service.getVersion()))
        }

        if (url.pathname === '/api/admin/theme/settings' && request.method === 'POST') {
          if (!options.adminToken) return json(response, 403, envelope(null, 'admin theme settings are disabled', 'error'))
          if (!hasAdminToken(request, options.adminToken)) return json(response, 401, envelope(null, 'unauthorized', 'error'))
          const body = await readJsonObject(request)
          return json(response, 200, envelope(await service.updateThemeSettings(body)))
        }

        if (request.method !== 'GET') return methodNotAllowed(response)
        if (url.pathname === '/api/probe') {
          return json(response, 200, await service.getRawProbePayload())
        }
        if (url.pathname === '/api/series') {
          return json(response, 200, await service.getSeriesPayload(queryFrom(url)))
        }
        if (url.pathname === '/api/nodes') {
          const snapshot = await service.getSnapshot()
          return json(response, 200, envelope(snapshot.nodes))
        }
        if (url.pathname === '/api/admin/client/list') {
          return json(response, 200, envelope(await service.getNodesInformation()))
        }
        if (url.pathname === '/api/admin/ping') {
          return json(response, 200, envelope(await service.getPublicPingTasks(queryFrom(url))))
        }
        if (url.pathname === '/api/admin/theme/settings') {
          return json(response, 200, envelope(await service.getThemeSettings()))
        }
        if (url.pathname === '/api/public') {
          return json(response, 200, envelope(await service.getPublicSettings()))
        }
        if (url.pathname === '/api/me') {
          return json(response, 200, await service.getMe())
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

function hasAdminToken(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization
  if (typeof header !== 'string') return false
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] === expected
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readBody(request))
  } catch {
    throw Object.assign(new Error('request body must be valid JSON'), { statusCode: 400 })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw Object.assign(new Error('request body must be a JSON object'), { statusCode: 400 })
  }
  return parsed as Record<string, unknown>
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
    if (rpc.method === 'rpc.getMethods') return rpcResult(id, RPC_METHODS)
    if (rpc.method === 'rpc.getHelp') {
      const method = typeof params.method === 'string' ? params.method : undefined
      if (method) {
        const help = RPC_METHOD_HELP[method]
        return help ? rpcResult(id, help) : rpcError(id, -32601, 'Method not found')
      }
      return rpcResult(id, Object.values(RPC_METHOD_HELP))
    }
    if (rpc.method === 'rpc.getVersion' || rpc.method === 'common:getBackendVersion') {
      return rpcResult(id, await service.getVersion())
    }
    if (rpc.method === 'common:getMe' || rpc.method === 'public:getMe') {
      return rpcResult(id, await service.getMe())
    }
    if (rpc.method === 'common:getPublicInfo') {
      return rpcResult(id, await service.getPublicInfo())
    }
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
      return rpcResult(id, await service.getNodes(typeof params.uuid === 'string' ? params.uuid : undefined))
    }
    if (rpc.method === 'common:getNodesLatestStatus') {
      return rpcResult(id, await service.getNodesLatestStatus(params))
    }
    if (rpc.method === 'common:getNodeRecentStatus') {
      if (typeof params.uuid !== 'string' || !params.uuid) return rpcError(id, -32602, 'Invalid params')
      const limit = typeof params.limit === 'number' ? params.limit : undefined
      return rpcResult(id, await service.getNodeRecentStatus(params.uuid, limit))
    }
    if (rpc.method === 'public:getClientRecentRecords') {
      return rpcResult(id, await service.getClientRecentRecords(params))
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
