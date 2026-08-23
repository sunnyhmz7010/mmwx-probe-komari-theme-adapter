import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
}

const HEAD_SYNC_SCRIPT = `<script>(()=>{const text=(v)=>typeof v==="string"?v.trim():"";fetch("/api/probe",{cache:"no-store"}).then((r)=>r.ok?r.json():null).then((d)=>{if(!d)return;const title=text(d.title);if(title)document.title=title;const icon=text(d.icon);if(icon){let link=document.querySelector('link[rel~="icon"]');if(!link){link=document.createElement("link");link.rel="icon";document.head.appendChild(link)}link.href=icon}}).catch(()=>{})})();</script>`

// 模拟 Komari 主控提供的主题资源路径。主题自带这些资源时优先主题，
// 否则回退到镜像内置资源，保证依赖主控静态资源的主题（如 emerald）图标可用。
const BUILTIN_ASSETS_DIR = path.resolve(process.cwd(), 'static-assets')
const BUILTIN_ASSET_PREFIXES = ['/assets/flags/', '/assets/logo/']

interface Candidate {
  filePath: string
  contentType: string
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function isBuiltinAssetPath(pathname: string): boolean {
  return BUILTIN_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function builtinAssetPath(pathname: string): string {
  return pathname.replace(/^\/assets\/(flags|logo)\//, '/$1/')
}

async function resolveCandidate(root: string, pathname: string): Promise<Candidate | null> {
  let safePathname: string
  try {
    safePathname = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (safePathname.includes('\0') || safePathname.includes('..')) return null
  const relative = safePathname.replace(/^\/+/, '')
  const resolved = path.resolve(root, relative || '.')
  const rootReal = await realpath(root)
  const targetReal = await realpath(resolved).catch(() => null)
  if (!targetReal || !isWithin(rootReal, targetReal)) return null
  const stat = await lstat(resolved)
  if (stat.isDirectory()) {
    const indexPath = path.join(resolved, 'index.html')
    const indexReal = await realpath(indexPath).catch(() => null)
    if (!indexReal || !isWithin(rootReal, indexReal)) return null
    return { filePath: indexReal, contentType: 'text/html; charset=utf-8' }
  }
  if (!stat.isFile() && !stat.isSymbolicLink()) return null
  return { filePath: targetReal, contentType: contentTypeFor(targetReal) }
}

async function indexCandidate(root: string): Promise<Candidate | null> {
  const indexPath = path.join(root, 'index.html')
  const rootReal = await realpath(root)
  const indexReal = await realpath(indexPath).catch(() => null)
  if (!indexReal || !isWithin(rootReal, indexReal)) return null
  return { filePath: indexReal, contentType: 'text/html; charset=utf-8' }
}

async function serveCandidate(candidate: Candidate, request: IncomingMessage, response: ServerResponse): Promise<void> {
  let body = request.method === 'HEAD' ? undefined : await readFile(candidate.filePath)
  if (body && candidate.contentType.startsWith('text/html')) {
    const html = body.toString('utf8')
    body = Buffer.from(html.includes('</head>')
      ? html.replace('</head>', `${HEAD_SYNC_SCRIPT}</head>`)
      : `${html}${HEAD_SYNC_SCRIPT}`)
  }
  response.writeHead(200, {
    'Content-Type': candidate.contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

export async function serveStatic(root: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const url = new URL(request.url ?? '/', 'http://adapter.local')

  // flags/logo 资源：优先主题构建产物，未命中回退内置资源，避免 SPA fallback 返回 HTML 导致裂图。
  if (isBuiltinAssetPath(url.pathname)) {
    const candidate = await resolveCandidate(root, url.pathname) ?? await resolveCandidate(BUILTIN_ASSETS_DIR, builtinAssetPath(url.pathname))
    if (!candidate) return false
    await serveCandidate(candidate, request, response)
    return true
  }

  const candidate = url.pathname === '/' ? await indexCandidate(root) : await resolveCandidate(root, url.pathname)
  const selected = candidate ?? await indexCandidate(root)
  if (!selected) return false
  await serveCandidate(selected, request, response)
  return true
}
