import { ADAPTER_VERSION } from './version.js'

export interface AppConfig {
  mmwxOrigin: string
  probeToken: string
  themeRepo: string
  themeRef: string
  themeGitProxy: string
  adminToken?: string
}

export const RUNTIME_DIR = '/data'
export const THEME_SETTINGS_PATH = `${RUNTIME_DIR}/theme-settings.json`
export const HISTORY_BUFFER_PATH = `${RUNTIME_DIR}/history-buffer.json`
export const HTTP_PORT = 8080

export function describeConfig(config: AppConfig): string {
  return [
    `MMWX_ORIGIN=${config.mmwxOrigin}`,
    'PROBE_TOKEN=[REDACTED]',
    `THEME_REPO=${config.themeRepo}`,
    `THEME_REF=${config.themeRef}`,
    `THEME_GIT_PROXY=${config.themeGitProxy || 'disabled'}`,

    `ADMIN_TOKEN=${config.adminToken ? '[REDACTED]' : 'disabled'}`,
    `VERSION=${ADAPTER_VERSION}`,
  ].join(' ')
}

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) {
    throw new ConfigError(`${key} is required`)
  }
  return value
}

function parsePositiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new ConfigError(`${key} must be a positive integer`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ConfigError(`${key} must be a positive integer`)
  }
  return value
}

function parseOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError('MMWX_ORIGIN must be a valid URL')
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new ConfigError('MMWX_ORIGIN must use HTTPS outside localhost and 127.0.0.1')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigError('MMWX_ORIGIN must not contain credentials, query, or fragment')
  }
  return url.toString().replace(/\/+$/, '')
}

function parseThemeRepo(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError('THEME_REPO must be a GitHub HTTPS repository URL')
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash) {
    throw new ConfigError('THEME_REPO must be a GitHub HTTPS repository URL')
  }
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (!match || match[1].includes('.') || match[2].includes('.') || match[1] === '.' || match[2] === '.') {
    throw new ConfigError('THEME_REPO must be a GitHub HTTPS repository URL')
  }
  return `https://github.com/${match[1]}/${match[2]}`
}

// 克隆代理前缀：拼在完整 GitHub 地址前，最终克隆地址形如
// https://gh-proxy.com/https://github.com/owner/repo.git；留空表示直连
function parseThemeGitProxy(value: string): string {
  if (!value) {
    return ''
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError('THEME_GIT_PROXY must be an HTTPS proxy base URL')
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new ConfigError('THEME_GIT_PROXY must use HTTPS outside localhost and 127.0.0.1')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigError('THEME_GIT_PROXY must not contain credentials, query, or fragment')
  }
  return url.toString().replace(/\/+$/, '')
}

function parseThemeRef(value: string): string {
  if (!value || /[\s;&|`$<>]/.test(value)) {
    throw new ConfigError('THEME_REF contains invalid characters')
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const mmwxOrigin = parseOrigin(required(env, 'MMWX_ORIGIN'))
  const probeToken = required(env, 'PROBE_TOKEN')
  const themeRepo = parseThemeRepo(required(env, 'THEME_REPO'))
  const themeRef = parseThemeRef(env.THEME_REF?.trim() || 'main')
  const themeGitProxy = parseThemeGitProxy(env.THEME_GIT_PROXY?.trim() || '')
  return {
    mmwxOrigin,
    probeToken,
    themeRepo,
    themeRef,
    themeGitProxy,
    adminToken: env.ADMIN_TOKEN?.trim() || undefined,
  }
}
