import { existsSync as fsExistsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, realpath, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { noopLogger, type Logger } from '../log.js'
import type { BuildPlan, PackageManager } from './types.js'

const OUTPUT_CANDIDATES = ['dist', 'build', 'out', 'public', '.'] as const
const SECRET_ENV = /(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|AUTH|API[_-]?KEY|COOKIE|CERT|SIGNING)/i

interface SpawnResult {
  stdout: string
  stderr: string
}

function spawnFile(file: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }, logger: Logger, phase: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : file
    const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', file, ...args] : [...args]
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      for (const line of chunk.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
        logger.info(`${phase}: ${line}`)
      }
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      for (const line of chunk.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
        logger.info(`${phase}: ${line}`)
      }
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(`${file} ${args.join(' ')} failed${signal ? ` (${signal})` : ''}: ${stderr.trim()}`))
    })
  })
}

function buildEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CI: 'true' }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SECRET_ENV.test(key)) {
      env[key] = value
    }
  }
  env.CI = 'true'
  return env
}

function packageManagerFromField(packageJson: Record<string, unknown>): Exclude<PackageManager, 'none'> | undefined {
  const raw = typeof packageJson.packageManager === 'string' ? packageJson.packageManager.trim() : ''
  if (!raw) return undefined
  const name = raw.split('@', 1)[0]
  if (name === 'pnpm' || name === 'bun' || name === 'npm') return name
  return undefined
}

function packageManagerFromLockfiles(repoDir: string): Exclude<PackageManager, 'none'> {
  if (existsSync(repoDir, 'pnpm-lock.yaml')) return 'pnpm'
  if (existsSync(repoDir, 'bun.lockb') || existsSync(repoDir, 'bun.lock')) return 'bun'
  if (existsSync(repoDir, 'package-lock.json')) return 'npm'
  return 'npm'
}

function hasSupportedLockfile(repoDir: string): boolean {
  return existsSync(repoDir, 'pnpm-lock.yaml')
    || existsSync(repoDir, 'bun.lockb')
    || existsSync(repoDir, 'bun.lock')
    || existsSync(repoDir, 'package-lock.json')
}

function existsSync(repoDir: string, relative: string): boolean {
  return fsExistsSync(path.join(repoDir, relative))
}

function commandFor(manager: Exclude<PackageManager, 'none'>): { installArgs: string[]; buildArgs: string[] } {
  if (manager === 'pnpm') return { installArgs: ['install', '--frozen-lockfile'], buildArgs: ['run', 'build'] }
  if (manager === 'bun') return { installArgs: ['install', '--frozen-lockfile'], buildArgs: ['run', 'build'] }
  return { installArgs: ['ci'], buildArgs: ['run', 'build'] }
}

function npmFallbackCommand(repoDir: string): { installArgs: string[]; buildArgs: string[] } {
  if (existsSync(repoDir, 'package-lock.json')) return { installArgs: ['ci'], buildArgs: ['run', 'build'] }
  return { installArgs: ['install'], buildArgs: ['run', 'build'] }
}

export async function detectBuildPlan(repoDir: string): Promise<BuildPlan> {
  const resolvedRepo = path.resolve(repoDir)
  const hasRootIndex = existsSync(resolvedRepo, 'index.html')

  let packageJson: Record<string, unknown>
  try {
    packageJson = JSON.parse(await readFile(path.join(resolvedRepo, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Theme package.json is not valid JSON')
    if (hasRootIndex) {
      return { packageManager: 'none', installArgs: [], buildArgs: [], outputCandidates: ['.'] }
    }
    throw new Error('Theme repository must contain index.html or package.json')
  }

  const scripts = packageJson.scripts
  if (!scripts || typeof scripts !== 'object' || typeof (scripts as Record<string, unknown>).build !== 'string' || !(scripts as Record<string, unknown>).build) {
    if (hasRootIndex) {
      return { packageManager: 'none', installArgs: [], buildArgs: [], outputCandidates: ['.'] }
    }
    throw new Error('Theme package.json must declare a build script')
  }
  const declaredPackageManager = packageManagerFromField(packageJson)
  const packageManager = declaredPackageManager ?? packageManagerFromLockfiles(resolvedRepo)
  const commands = hasSupportedLockfile(resolvedRepo) ? commandFor(packageManager) : { installArgs: ['install'], buildArgs: ['run', 'build'] }
  return { packageManager, ...commands, outputCandidates: [...OUTPUT_CANDIDATES] }
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function verifyTree(root: string, repoRoot: string): Promise<void> {
  const entry = await lstat(root)
  let scanRoot = root
  if (entry.isSymbolicLink()) {
    const target = await realpath(root)
    if (!isWithin(repoRoot, target)) throw new Error(`Theme output symlink escapes repository: ${root}`)
    scanRoot = target
  } else if (!entry.isDirectory()) {
    return
  }
  for (const child of await readdir(scanRoot)) {
    await verifyTree(path.join(scanRoot, child), repoRoot)
  }
}

async function findOutput(repoDir: string, candidates: readonly string[]): Promise<string> {
  const repoRoot = await realpath(repoDir)
  for (const candidate of candidates) {
    const selected = path.resolve(repoDir, candidate)
    let stat
    try {
      stat = await lstat(selected)
    } catch {
      continue
    }
    const resolved = await realpath(selected)
    if (!isWithin(repoRoot, resolved)) throw new Error(`Theme output containment violation: ${selected}`)
    if (!stat.isDirectory() && !stat.isSymbolicLink()) continue
    await verifyTree(selected, repoRoot)
    const indexPath = path.join(selected, 'index.html')
    try {
      const indexStat = await lstat(indexPath)
      const indexRealPath = await realpath(indexPath)
      if (!isWithin(repoRoot, indexRealPath)) throw new Error(`Theme index.html symlink escapes repository: ${indexPath}`)
      if (indexStat.isFile() || indexStat.isSymbolicLink()) return resolved
    } catch (error) {
      if (error instanceof Error && /escapes repository/.test(error.message)) throw error
    }
  }
  throw new Error('Theme output must contain index.html in dist, build, out, public, or the repository root')
}

async function assertFreshlyGenerated(outputDir: string, buildStartedAt: number): Promise<void> {
  const indexPath = path.join(outputDir, 'index.html')
  const indexStat = await lstat(indexPath)
  if (!indexStat.isFile() && !indexStat.isSymbolicLink()) {
    throw new Error('Theme generated output index.html is not a file')
  }
  if (indexStat.mtimeMs < buildStartedAt) {
    throw new Error('Theme output index.html predates the build, likely stale residue')
  }
}

export async function buildTheme(plan: BuildPlan, repoDir: string, outputDir: string, logger: Logger = noopLogger): Promise<string> {
  const resolvedRepo = path.resolve(repoDir)
  const resolvedOutput = path.resolve(outputDir)
  logger.info('主题构建开始', { packageManager: plan.packageManager })
  if (plan.packageManager !== 'none') {
    let executable = process.platform === 'win32' ? `${plan.packageManager}.cmd` : plan.packageManager
    let buildArgs = plan.buildArgs
    const options = { cwd: resolvedRepo, env: buildEnvironment() }
    logger.info('主题依赖安装开始', { command: `${executable} ${plan.installArgs.join(' ')}` })
    try {
      await spawnFile(executable, plan.installArgs, options, logger, '主题依赖安装')
    } catch (error) {
      if (plan.packageManager !== 'bun') throw error
      const fallback = npmFallbackCommand(resolvedRepo)
      executable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      buildArgs = fallback.buildArgs
      logger.warn('主题依赖安装失败，回退到 npm', {
        command: `${executable} ${fallback.installArgs.join(' ')}`,
        reason: error instanceof Error ? error.message : 'unknown error',
      })
      await spawnFile(executable, fallback.installArgs, options, logger, '主题依赖安装')
    }
    logger.info('主题依赖安装完成')
    logger.info('主题构建命令开始', { command: `${executable} ${buildArgs.join(' ')}` })
    const buildStartedAt = Date.now()
    try {
      await spawnFile(executable, buildArgs, options, logger, '主题构建命令')
    } catch (error) {
      const generatedOutputCandidates = plan.outputCandidates.filter((candidate) => candidate !== '.')
      let generatedOutput: string | undefined
      try {
        generatedOutput = await findOutput(resolvedRepo, generatedOutputCandidates)
      } catch {
        throw error
      }
      try {
        await assertFreshlyGenerated(generatedOutput, buildStartedAt)
      } catch (staleError) {
        throw new Error(`Theme build failed and the output is stale: ${staleError instanceof Error ? staleError.message : 'unknown error'}`)
      }
      logger.warn('主题构建命令失败，但检测到本次生成的产物，继续启动', {
        output: generatedOutput,
        reason: error instanceof Error ? error.message : 'unknown error',
      })
    }
    logger.info('主题构建命令完成')
  } else {
    logger.info('主题构建跳过依赖安装和构建命令')
  }

  const selected = await findOutput(resolvedRepo, plan.outputCandidates)
  logger.info('主题构建产物已确定', { path: selected })
  await rm(resolvedOutput, { recursive: true, force: true })
  await mkdir(resolvedOutput, { recursive: true })
  await cp(selected, resolvedOutput, { recursive: true, dereference: true })
  logger.info('主题构建完成', { output: resolvedOutput })
  return resolvedOutput
}
