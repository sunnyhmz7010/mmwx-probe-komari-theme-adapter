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
    if (serveThemeManifest(theme, request, response)) return
    if (serveThemeSettingsAdmin(theme, request, response)) return
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

function serveThemeManifest(theme: LoadedTheme, request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const url = new URL(request.url ?? '/', 'http://adapter.local')
  if (!/^\/themes\/[^/]+\/komari-theme\.json$/.test(url.pathname)) return false
  if (!theme.manifest) return false
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  })
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify(theme.manifest))
  return true
}

function serveThemeSettingsAdmin(theme: LoadedTheme, request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const url = new URL(request.url ?? '/', 'http://adapter.local')
  if (url.pathname !== '/admin/settings/theme') return false
  const html = adminThemeSettingsHtml(theme)
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  })
  response.end(request.method === 'HEAD' ? undefined : html)
  return true
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function adminThemeSettingsHtml(theme: LoadedTheme): string {
  const title = htmlEscape(theme.title ?? theme.short ?? 'Komari Theme')
  const meta = {
    title: theme.title,
    short: theme.short,
    repoUrl: theme.source.repoUrl,
    ref: theme.source.ref,
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MMWX Komari Theme Settings</title>
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:960px;margin:32px auto;padding:0 16px;color:#111827;background:#f9fafb}
main{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;box-shadow:0 1px 2px #0000000d}
label{display:block;margin:14px 0 6px;font-weight:600}.field{margin-bottom:14px}input,select,textarea{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font:inherit}input[type=checkbox]{width:auto}
textarea{min-height:120px}button{padding:10px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}button:disabled{background:#9ca3af}
pre,.notice{background:#f3f4f6;border-radius:8px;padding:12px;overflow:auto}.muted{color:#6b7280}.error{color:#b91c1c}.ok{color:#047857}
</style>
</head>
<body>
<main>
<h1>MMWX Komari Theme Settings</h1>
<p class="muted">当前主题：${title}</p>
<p class="muted">仓库：${htmlEscape(theme.source.repoUrl)} @ ${htmlEscape(theme.source.ref)}</p>
<div id="app" class="notice">加载中...</div>
</main>
<script id="theme-meta" type="application/json">${safeJson(meta)}</script>
<script>
const app=document.getElementById("app");
const meta=JSON.parse(document.getElementById("theme-meta").textContent);
const text=(v)=>typeof v==="string"?v:"";
const html=(v)=>String(v).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]));
const label=(v)=>typeof v==="string"?v:v&&typeof v==="object"?(v["zh-CN"]||v.zh||v.en||Object.values(v)[0]||""):"";
const parseOptions=(v)=>Array.isArray(v)?v:String(v||"").split(",").map((x)=>x.trim()).filter(Boolean);
async function json(url,init){const r=await fetch(url,init);const d=await r.json().catch(()=>({status:"error",message:"invalid json"}));if(!r.ok)throw new Error(d.message||("HTTP "+r.status));return d.data??d.result??d}
function fieldValue(settings,f){return settings&&Object.prototype.hasOwnProperty.call(settings,f.key)?settings[f.key]:f.default}
function renderField(f,settings){
 if(f.type==="title")return '<h2>'+html(label(f.name)||"设置")+'</h2>';
 if(f.type==="textbox")return '<p class="notice">'+html(label(f.name)||label(f.help)||"")+'</p>';
 if(!f.key)return "";
 const name=html(label(f.name)||f.key), help=label(f.help);
 const value=fieldValue(settings,f);
 let control="";
 if(f.type==="switch"||f.type==="boolean"){control='<input data-key="'+html(f.key)+'" data-type="switch" type="checkbox" '+(value===true?"checked":"")+'>'}
 else if(f.type==="select"||f.type==="radio"){control='<select data-key="'+html(f.key)+'" data-type="value">'+parseOptions(f.options).map((o)=>{const ov=typeof o==="object"?(o.value??o.key??o.label??o.name):o;return '<option value="'+html(ov)+'" '+(String(value)===String(ov)?"selected":"")+'>'+html(typeof o==="object"?label(o.label??o.name) || ov:o)+'</option>'}).join("")+'</select>'}
 else if(f.type==="number"||f.type==="integer"||f.type==="slider"){control='<input data-key="'+html(f.key)+'" data-type="number" type="number" value="'+html(value??0)+'">'}
 else if(f.type==="richtext"||f.type==="nodes"||f.type==="pingtasks"){control='<textarea data-key="'+html(f.key)+'" data-type="'+(f.type==="richtext"?"value":"json")+'">'+html(f.type==="richtext"?(value??""):JSON.stringify(value??[]))+'</textarea>'}
 else{control='<input data-key="'+html(f.key)+'" data-type="value" value="'+html(value??"")+'">'}
 return '<div class="field"><label>'+name+'</label>'+control+(help?'<p class="muted">'+html(help)+'</p>':"")+'</div>';
}
function collect(){
 const out={};
 for(const el of app.querySelectorAll("[data-key]")){
  const key=el.getAttribute("data-key"), type=el.getAttribute("data-type");
  if(type==="switch")out[key]=el.checked;
  else if(type==="number")out[key]=Number(el.value);
  else if(type==="json"){try{out[key]=JSON.parse(el.value||"[]")}catch{throw new Error(key+" 不是有效 JSON")}}
  else out[key]=el.value;
 }
 return out;
}
async function boot(){
 try{
  const pub=await json("/api/public");
  const theme=pub.theme||meta.short||"current";
  const manifest=await json("/themes/"+encodeURIComponent(theme)+"/komari-theme.json").catch(()=>null);
  const cfg=manifest&&manifest.configuration;
  const settings=await json("/api/admin/theme/settings").catch(()=>pub.theme_settings||{});
  if(!cfg){app.innerHTML='<p>当前主题未声明可配置项。</p><h2>高级 JSON</h2><textarea id="raw">'+html(JSON.stringify(settings,null,2))+'</textarea>'+saveBlock();attachSave(true);return}
  const type=String(cfg.type||"managed").toLowerCase();
  if(type==="redirect"){app.innerHTML='<p>主题配置使用跳转页面：</p><p><a href="'+html(cfg.data||"#")+'">'+html(cfg.data||"打开")+'</a></p>';return}
  if(type==="raw"){app.innerHTML='<iframe sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" style="width:100%;height:70vh;border:1px solid #ddd;border-radius:8px" srcdoc="'+html(cfg.data||"")+'"></iframe>';return}
  const fields=Array.isArray(cfg.data)?cfg.data:[];
  app.innerHTML=fields.map((f)=>renderField(f,settings)).join("")+saveBlock();attachSave(false);
 }catch(e){app.innerHTML='<p class="error">'+html(e.message||e)+'</p>'}
}
function saveBlock(){return '<div class="field"><label>ADMIN_TOKEN</label><input id="admin-token" type="password" autocomplete="current-password"></div><button id="save">保存主题配置</button><p id="msg" class="muted"></p>'}
function attachSave(raw){
 const button=document.getElementById("save");
 if(!button)return;
 button.onclick=async()=>{
  const msg=document.getElementById("msg");
  try{
   const body=raw?JSON.parse(document.getElementById("raw").value||"{}"):collect();
   await json("/api/admin/theme/settings",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+document.getElementById("admin-token").value},body:JSON.stringify(body)});
   msg.className="ok";msg.textContent="已保存";
  }catch(e){msg.className="error";msg.textContent=e.message||e}
 };
}
boot();
</script>
</body>
</html>`
}
