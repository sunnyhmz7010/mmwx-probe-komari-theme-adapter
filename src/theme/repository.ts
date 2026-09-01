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

export function parseGitHubRepo(value: string): { owner: string; name: string; host: string } {
  if (!value || /\s/.test(value)) {
    throw new Error('THEME_REPO must be an HTTPS repository URL')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('THEME_REPO must be an HTTPS repository URL')
  }

  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('THEME_REPO must be an HTTPS repository URL')
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    throw new Error('THEME_REPO must be an HTTPS repository URL')
  }

  const clean = pathname.replace(/\.git$/, '').replace(/\/+$/, '')

  const standardMatch = clean.match(/^\/([^/]+)\/([^/]+)$/)
  if (standardMatch && standardMatch[1] !== '..' && standardMatch[2] !== '..') {
    return { owner: standardMatch[1], name: standardMatch[2], host: url.hostname }
  }

  const segments = clean.split('/').filter(Boolean)
  if (segments.length >= 2) {
    const owner = segments[segments.length - 2]
    const name = segments[segments.length - 1]
    if (owner !== '..' && name !== '..' && name.length > 0) {
      return { owner, name, host: url.hostname }
    }
  }

  throw new Error('THEME_REPO must be an HTTPS repository URL')
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

export async function acquireTheme(source: ThemeSource, targetDir: string, logger: Logger = noopLogger): Promise<string> {
  const repo = parseGitHubRepo(source.repoUrl)
  const ref = resolveThemeRef(source.ref)
  const repoUrl = `https://${repo.host}/${repo.owner}/${repo.name}.git`
  const resolvedTarget = path.resolve(targetDir)

  await mkdir(path.dirname(resolvedTarget), { recursive: true })
  logger.info('主题仓库克隆开始', { repository: source.repoUrl, ref: source.ref })
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
