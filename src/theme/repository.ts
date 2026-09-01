import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { noopLogger, type Logger } from '../log.js'
import type { ThemeSource } from './types.js'

interface SpawnResult {
  stdout: string
  stderr: string
}

function spawnFile(file: string, args: readonly string[], cwd?: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(`git ${args[0] ?? 'command'} failed${signal ? ` (${signal})` : ''}: ${stderr.trim()}`))
    })
  })
}

export function parseGitHubRepo(value: string): { owner: string; name: string } {
  if (!value || /\s/.test(value)) {
    throw new Error('THEME_REPO must be a GitHub HTTPS repository URL')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('THEME_REPO must be a GitHub HTTPS repository URL')
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('THEME_REPO must be a GitHub HTTPS repository URL')
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    throw new Error('THEME_REPO must be a GitHub HTTPS repository URL')
  }
  const match = pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (!match || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..' || match[2].length === 0) {
    throw new Error('THEME_REPO must be a GitHub HTTPS repository URL')
  }
  return { owner: match[1], name: match[2] }
}

export function resolveThemeRef(value: string): string {
  if (!value || /[\s;&|`$<>\u0000]/.test(value) || value.startsWith('-')) {
    throw new Error('THEME_REF contains invalid characters')
  }
  return value
}

export function isCommitRef(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref)
}

// 克隆地址：未配置代理时直连 GitHub；配置代理时把完整 GitHub 地址拼到代理前缀后
// （gh-proxy 等镜像要求形如 https://gh-proxy.com/https://github.com/owner/repo.git）
export function buildCloneUrl(repo: { owner: string; name: string }, gitProxy?: string): string {
  const target = `https://github.com/${repo.owner}/${repo.name}.git`
  if (!gitProxy) {
    return target
  }
  const proxy = gitProxy.replace(/\/+$/, '')
  if (!/^https:\/\//.test(proxy) || /\s/.test(proxy)) {
    throw new Error('THEME_GIT_PROXY must be an HTTPS proxy base URL')
  }
  return `${proxy}/${target}`
}

export async function acquireTheme(source: ThemeSource, targetDir: string, logger: Logger = noopLogger): Promise<string> {
  const repo = parseGitHubRepo(source.repoUrl)
  const ref = resolveThemeRef(source.ref)
  const repoUrl = buildCloneUrl(repo, source.gitProxy)
  const resolvedTarget = path.resolve(targetDir)

  await mkdir(path.dirname(resolvedTarget), { recursive: true })
  logger.info('主题仓库克隆开始', { repository: source.repoUrl, cloneUrl: repoUrl, ref: source.ref })
  if (isCommitRef(ref)) {
    await spawnFile('git', ['clone', '--depth', '1', repoUrl, resolvedTarget])
    logger.info('主题 commit 获取开始', { ref })
    await spawnFile('git', ['fetch', '--depth', '1', 'origin', ref], resolvedTarget)
    await spawnFile('git', ['checkout', '--detach', ref], resolvedTarget)
  } else {
    await spawnFile('git', ['clone', '--depth', '1', '--branch', ref, repoUrl, resolvedTarget])
  }
  logger.info('主题仓库克隆完成', { path: resolvedTarget })
  return resolvedTarget
}
