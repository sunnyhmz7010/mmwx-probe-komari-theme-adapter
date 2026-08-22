import { mkdtemp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import type { AppConfig } from '../config.js'
import { createLogger, type Logger } from '../log.js'
import { acquireTheme } from './repository.js'
import { buildTheme, detectBuildPlan } from './builder.js'
import type { LoadedTheme, ThemeSource } from './types.js'

interface ThemeManifest {
  short?: unknown
  configuration?: unknown
}

interface ThemeConfigurationItem {
  key?: unknown
  type?: unknown
  default?: unknown
  options?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function defaultThemeSettingValue(item: ThemeConfigurationItem): unknown {
  const type = stringOrUndefined(item.type)?.toLowerCase()
  if (type === 'switch' || type === 'boolean') return false
  if (type === 'number' || type === 'integer' || type === 'slider') return 0
  if (type === 'select' || type === 'radio') {
    const options = item.options
    if (Array.isArray(options) && options.length > 0) {
      const first = options[0]
      if (isRecord(first)) {
        const value = first.value ?? first.key ?? first.label ?? first.name
        if (value !== undefined) return value
      }
      return first
    }
    return ''
  }
  return ''
}

async function readThemeDocumentTitle(indexPath: string): Promise<string | undefined> {
  try {
    const html = await readFile(indexPath, 'utf8')
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (!match) return undefined
    const title = match[1].trim()
    return title || undefined
  } catch {
    return undefined
  }
}

function manifestThemeSettings(manifest: ThemeManifest | null): Record<string, unknown> | null {
  if (!manifest) return null
  const configuration = isRecord(manifest.configuration) ? manifest.configuration : undefined
  const rawData = configuration?.data
  if (!Array.isArray(rawData)) {
    if (isRecord(rawData)) return rawData
    return null
  }

  const settings: Record<string, unknown> = {}
  for (const item of rawData) {
    if (!isRecord(item)) continue
    const key = stringOrUndefined(item.key)
    if (!key) continue
    if (Object.prototype.hasOwnProperty.call(item, 'default') && item.default !== undefined) {
      settings[key] = item.default
      continue
    }
    settings[key] = defaultThemeSettingValue(item)
  }
  return settings
}

async function readThemeManifest(repoDir: string): Promise<ThemeManifest | null> {
  const manifestPath = path.join(repoDir, 'komari-theme.json')
  try {
    const raw = await readFile(manifestPath, 'utf8')
    return JSON.parse(raw) as ThemeManifest
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Theme komari-theme.json is not valid JSON')
    return null
  }
}

export async function readThemeMetadata(repoDir: string): Promise<{ short?: string; themeSettings: Record<string, unknown> | null }> {
  const manifest = await readThemeManifest(repoDir)
  return {
    short: stringOrUndefined(manifest?.short),
    themeSettings: manifestThemeSettings(manifest),
  }
}

export async function loadTheme(config: AppConfig, logger: Logger = createLogger([config.probeToken])): Promise<LoadedTheme> {
  const source: ThemeSource = { repoUrl: config.themeRepo, ref: config.themeRef }
  const themesDir = path.resolve(config.dataDir, 'themes')
  const currentDir = path.join(themesDir, 'current')
  await mkdir(themesDir, { recursive: true })
  const workspace = await mkdtemp(path.join(themesDir, '.theme-'))
  const repoDir = path.join(workspace, 'repo')
  const outputDir = path.join(workspace, 'output')

  try {
    logger.info('主题加载开始', { repository: source.repoUrl, ref: source.ref, dataDir: config.dataDir })
    await acquireTheme(source, repoDir, logger)
    const metadata = await readThemeMetadata(repoDir)
    const plan = await detectBuildPlan(repoDir)
    logger.info('主题构建计划已确定', {
      packageManager: plan.packageManager,
      installCommand: plan.installArgs.join(' ') || 'none',
      buildCommand: plan.buildArgs.join(' ') || 'none',
      outputCandidates: plan.outputCandidates.join(','),
    })
    await buildTheme(plan, repoDir, outputDir, logger)
    const title = await readThemeDocumentTitle(path.join(outputDir, 'index.html'))

    const previousDir = `${currentDir}.previous-${Date.now()}`
    await rm(previousDir, { recursive: true, force: true })
    try {
      await rename(currentDir, previousDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(outputDir, currentDir)
    await rm(previousDir, { recursive: true, force: true })
    logger.info('主题加载完成', { directory: currentDir, indexPath: path.join(currentDir, 'index.html') })
    return {
      directory: currentDir,
      indexPath: path.join(currentDir, 'index.html'),
      title,
      short: metadata.short,
      themeSettings: metadata.themeSettings,
      source,
    }
  } catch (error: unknown) {
    logger.error('主题加载失败', {
      reason: error instanceof Error ? error.message : 'unknown error',
      repository: source.repoUrl,
      ref: source.ref,
    })
    throw error
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}
