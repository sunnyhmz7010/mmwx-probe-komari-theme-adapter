import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import type { AppConfig } from '../config.js'
import { createLogger, type Logger } from '../log.js'
import { acquireTheme } from './repository.js'
import { buildTheme, detectBuildPlan } from './builder.js'
import type { LoadedTheme, ThemeSource } from './types.js'

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
    const plan = await detectBuildPlan(repoDir)
    logger.info('主题构建计划已确定', {
      packageManager: plan.packageManager,
      installCommand: plan.installArgs.join(' ') || 'none',
      buildCommand: plan.buildArgs.join(' ') || 'none',
      outputCandidates: plan.outputCandidates.join(','),
    })
    await buildTheme(plan, repoDir, outputDir, logger)

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
