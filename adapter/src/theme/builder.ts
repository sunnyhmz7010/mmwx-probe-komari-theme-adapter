import { existsSync as fsExistsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, realpath, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

import type { BuildPlan, PackageManager } from './types.js'

const OUTPUT_CANDIDATES = ['dist', 'build', 'out', 'public', '.'] as const
const SECRET_ENV = /(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|AUTH|API[_-]?KEY|COOKIE|CERT|SIGNING)/i

interface SpawnResult {
  stdout: string
  stderr: string
}

function spawnFile(file: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
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

function packageManagerFor(repoDir: string, packageJson: Record<string, unknown>): Exclude<PackageManager, 'none'> {
  if (existsSync(repoDir, 'pnpm-lock.yaml')) return 'pnpm'
  if (existsSync(repoDir, 'bun.lockb') || existsSync(repoDir, 'bun.lock')) return 'bun'
  if (existsSync(repoDir, 'package-lock.json')) return 'npm'
  if (!packageJson.scripts || typeof packageJson.scripts !== 'object' || !('build' in packageJson.scripts)) {
    throw new Error('Theme package.json must declare a build script')
  }
  throw new Error('Theme package must include pnpm-lock.yaml, bun.lock, bun.lockb, or package-lock.json')
}

function existsSync(repoDir: string, relative: string): boolean {
  return fsExistsSync(path.join(repoDir, relative))
}

function commandFor(manager: Exclude<PackageManager, 'none'>): { installArgs: string[]; buildArgs: string[] } {
  if (manager === 'pnpm') return { installArgs: ['install', '--frozen-lockfile'], buildArgs: ['run', 'build'] }
  if (manager === 'bun') return { installArgs: ['install', '--frozen-lockfile'], buildArgs: ['run', 'build'] }
  return { installArgs: ['ci'], buildArgs: ['run', 'build'] }
}

export async function detectBuildPlan(repoDir: string): Promise<BuildPlan> {
  const resolvedRepo = path.resolve(repoDir)
  if (existsSync(resolvedRepo, 'index.html')) {
    return { packageManager: 'none', installArgs: [], buildArgs: [], outputCandidates: ['.'] }
  }

  let packageJson: Record<string, unknown>
  try {
    packageJson = JSON.parse(await readFile(path.join(resolvedRepo, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Theme package.json is not valid JSON')
    throw new Error('Theme repository must contain index.html or package.json')
  }

  const scripts = packageJson.scripts
  if (!scripts || typeof scripts !== 'object' || typeof (scripts as Record<string, unknown>).build !== 'string' || !(scripts as Record<string, unknown>).build) {
    throw new Error('Theme package.json must declare a build script')
  }
  const packageManager = packageManagerFor(resolvedRepo, packageJson)
  const commands = commandFor(packageManager)
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

export async function buildTheme(plan: BuildPlan, repoDir: string, outputDir: string): Promise<string> {
  const resolvedRepo = path.resolve(repoDir)
  const resolvedOutput = path.resolve(outputDir)
  if (plan.packageManager !== 'none') {
    const executable = process.platform === 'win32' ? `${plan.packageManager}.cmd` : plan.packageManager
    const options = { cwd: resolvedRepo, env: buildEnvironment() }
    await spawnFile(executable, plan.installArgs, options)
    await spawnFile(executable, plan.buildArgs, options)
  }

  const selected = await findOutput(resolvedRepo, plan.outputCandidates)
  await rm(resolvedOutput, { recursive: true, force: true })
  await mkdir(resolvedOutput, { recursive: true })
  await cp(selected, resolvedOutput, { recursive: true, dereference: true })
  return resolvedOutput
}
