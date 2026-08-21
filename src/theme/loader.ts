import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import type { AppConfig } from '../config.js'
import { acquireTheme } from './repository.js'
import { buildTheme, detectBuildPlan } from './builder.js'
import type { LoadedTheme, ThemeSource } from './types.js'

export async function loadTheme(config: AppConfig): Promise<LoadedTheme> {
  const source: ThemeSource = { repoUrl: config.themeRepo, ref: config.themeRef }
  const themesDir = path.resolve(config.dataDir, 'themes')
  const currentDir = path.join(themesDir, 'current')
  await mkdir(themesDir, { recursive: true })
  const workspace = await mkdtemp(path.join(themesDir, '.theme-'))
  const repoDir = path.join(workspace, 'repo')
  const outputDir = path.join(workspace, 'output')

  try {
    await acquireTheme(source, repoDir)
    const plan = await detectBuildPlan(repoDir)
    await buildTheme(plan, repoDir, outputDir)

    const previousDir = `${currentDir}.previous-${Date.now()}`
    await rm(previousDir, { recursive: true, force: true })
    try {
      await rename(currentDir, previousDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(outputDir, currentDir)
    await rm(previousDir, { recursive: true, force: true })
    return {
      directory: currentDir,
      indexPath: path.join(currentDir, 'index.html'),
      source,
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}
