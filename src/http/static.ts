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

export async function serveStatic(root: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const url = new URL(request.url ?? '/', 'http://adapter.local')
  const candidate = url.pathname === '/' ? await indexCandidate(root) : await resolveCandidate(root, url.pathname)
  const selected = candidate ?? await indexCandidate(root)
  if (!selected) return false

  let body = request.method === 'HEAD' ? undefined : await readFile(selected.filePath)
  if (body && selected.contentType.startsWith('text/html')) {
    const html = body.toString('utf8')
    body = Buffer.from(html.includes('</head>')
      ? html.replace('</head>', `${HEAD_SYNC_SCRIPT}</head>`)
      : `${html}${HEAD_SYNC_SCRIPT}`)
  }
  response.writeHead(200, {
    'Content-Type': selected.contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  })
  response.end(body)
  return true
}
