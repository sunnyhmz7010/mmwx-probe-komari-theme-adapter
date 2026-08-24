import { readFileSync } from 'node:fs'

export function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    const version = parsed.version?.trim()
    return version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const PACKAGE_VERSION = readPackageVersion()
export const ADAPTER_VERSION = `v${PACKAGE_VERSION}`
