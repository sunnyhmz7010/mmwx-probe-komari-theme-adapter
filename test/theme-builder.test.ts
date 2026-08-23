import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { buildTheme, detectBuildPlan } from '../src/theme/builder.js'

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'komari-theme-test-'))
}

async function packageFixture(files: Record<string, string>): Promise<string> {
  const repoDir = await fixture()
  for (const [relative, content] of Object.entries(files)) {
    const filePath = path.join(repoDir, relative)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
  return repoDir
}

async function fakeNpmFixture(options: { writeOutputOnBuild: boolean }): Promise<{ binDir: string; restorePath: () => void }> {
  const binDir = await fixture()
  const scriptPath = path.join(binDir, 'fake-npm.cjs')
  const commandPath = path.join(binDir, 'npm.cmd')
  const script = `
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const cwd = process.cwd()

if (args[0] === 'ci') {
  process.exit(0)
}

if (args[0] === 'run' && args[1] === 'build') {
  if (${options.writeOutputOnBuild ? 'true' : 'false'}) {
    fs.mkdirSync(path.join(cwd, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(cwd, 'dist', 'index.html'), '<main>theme</main>')
  }
  process.stderr.write('type-check failed\\n')
  process.exit(1)
}

process.stderr.write(\`unexpected args: \${args.join(' ')}\\n\`)
process.exit(2)
`
  await writeFile(scriptPath, script)
  await writeFile(commandPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`)
  const originalPath = process.env.PATH ?? ''
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`
  return {
    binDir,
    restorePath() {
      process.env.PATH = originalPath
    },
  }
}

async function fakeBunFixture(options: { failInstall: boolean }): Promise<{ binDir: string; restorePath: () => void }> {
  const binDir = await fixture()
  const scriptPath = path.join(binDir, 'fake-bun.cjs')
  const commandPath = path.join(binDir, 'bun.cmd')
  const script = `
const args = process.argv.slice(2)

if (args[0] === 'install') {
  if (${options.failInstall ? 'true' : 'false'}) {
    process.stderr.write('bun install failed\\n')
    process.exit(1)
  }
  process.exit(0)
}

if (args[0] === 'run' && args[1] === 'build') {
  process.stderr.write('unexpected bun build\\n')
  process.exit(2)
}

process.stderr.write(\`unexpected args: \${args.join(' ')}\\n\`)
process.exit(2)
`
  await writeFile(scriptPath, script)
  await writeFile(commandPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`)
  const originalPath = process.env.PATH ?? ''
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`
  return {
    binDir,
    restorePath() {
      process.env.PATH = originalPath
    },
  }
}

test('uses the repository root when it already contains index.html', async () => {
  const repoDir = await packageFixture({ 'index.html': '<!doctype html>' })

  try {
    const plan = await detectBuildPlan(repoDir)
    assert.equal(plan.packageManager, 'none')
    assert.deepEqual(plan.outputCandidates, ['.'])
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('builds a package theme when the repository root also contains source index.html', async () => {
  const repoDir = await packageFixture({
    'index.html': '<!doctype html><script type="module" src="/src/main.tsx"></script>',
    'package.json': JSON.stringify({ scripts: { build: 'build' } }),
    'package-lock.json': '{}',
  })

  try {
    const plan = await detectBuildPlan(repoDir)
    assert.equal(plan.packageManager, 'npm')
    assert.deepEqual(plan.outputCandidates, ['dist', 'build', 'out', 'public', '.'])
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('prefers packageManager over lockfiles when the theme declares one', async () => {
  const repoDir = await packageFixture({
    'package.json': JSON.stringify({
      packageManager: 'bun@1.3.14',
      scripts: { build: 'build' },
    }),
    'package-lock.json': '{}',
  })

  try {
    const plan = await detectBuildPlan(repoDir)
    assert.equal(plan.packageManager, 'bun')
    assert.deepEqual(plan.outputCandidates, ['dist', 'build', 'out', 'public', '.'])
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('builds package themes without a lockfile using npm install', async () => {
  const repoDir = await packageFixture({
    'index.html': '<!doctype html>',
    'package.json': JSON.stringify({ scripts: { build: 'build' } }),
  })

  try {
    const plan = await detectBuildPlan(repoDir)
    assert.equal(plan.packageManager, 'npm')
    assert.deepEqual(plan.installArgs, ['install'])
    assert.deepEqual(plan.buildArgs, ['run', 'build'])
    assert.deepEqual(plan.outputCandidates, ['dist', 'build', 'out', 'public', '.'])
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('selects pnpm, bun, then npm by lockfile priority', async () => {
  const cases = [
    ['pnpm', 'pnpm-lock.yaml'],
    ['bun', 'bun.lockb'],
    ['bun', 'bun.lock'],
    ['npm', 'package-lock.json'],
  ] as const

  for (const [packageManager, lockfile] of cases) {
    const repoDir = await packageFixture({
      'package.json': JSON.stringify({ scripts: { build: 'build' } }),
      [lockfile]: '',
    })

    try {
      const plan = await detectBuildPlan(repoDir)
      assert.equal(plan.packageManager, packageManager)
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  }

  const priorityDir = await packageFixture({
    'package.json': JSON.stringify({ scripts: { build: 'build' } }),
    'pnpm-lock.yaml': '',
    'bun.lock': '',
    'package-lock.json': '{}',
  })
  try {
    assert.equal((await detectBuildPlan(priorityDir)).packageManager, 'pnpm')
  } finally {
    await rm(priorityDir, { recursive: true, force: true })
  }
})

test('rejects a package without a declared build script', async () => {
  const repoDir = await packageFixture({
    'package.json': JSON.stringify({ scripts: { test: 'test' } }),
    'package-lock.json': '{}',
  })

  try {
    await assert.rejects(() => detectBuildPlan(repoDir), /build script/i)
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('copies only an allowed output directory with index.html', async () => {
  const repoDir = await packageFixture({
    'package.json': JSON.stringify({ scripts: { build: 'build' } }),
    'package-lock.json': '{}',
    'dist/index.html': '<main>theme</main>',
  })
  const outputDir = await fixture()
  const logs: string[] = []
  const logger = {
    info(message: string) { logs.push(`info:${message}`) },
    warn(message: string) { logs.push(`warn:${message}`) },
    error(message: string) { logs.push(`error:${message}`) },
  }

  try {
    const plan = await detectBuildPlan(repoDir)
    assert.deepEqual(plan.outputCandidates, ['dist', 'build', 'out', 'public', '.'])
    assert.equal(await buildTheme({ ...plan, packageManager: 'none' }, repoDir, outputDir, logger), outputDir)
    assert.equal(await readFile(path.join(outputDir, 'index.html'), 'utf8'), '<main>theme</main>')
    assert.deepEqual(logs, [
      'info:主题构建开始',
      'info:主题构建跳过依赖安装和构建命令',
      'info:主题构建产物已确定',
      'info:主题构建完成',
    ])
  } finally {
    await rm(repoDir, { recursive: true, force: true })
    await rm(outputDir, { recursive: true, force: true })
  }
})

test('keeps a generated output directory when the build command exits non-zero', async () => {
  const repoDir = await packageFixture({
    'package.json': JSON.stringify({ scripts: { build: 'build' } }),
    'package-lock.json': '{}',
    'index.html': '<script type="module" src="/src/main.ts"></script>',
  })
  const outputDir = await fixture()
  const fakeNpm = await fakeNpmFixture({ writeOutputOnBuild: true })
  const logs: string[] = []
  const logger = {
    info(message: string) { logs.push(`info:${message}`) },
    warn(message: string) { logs.push(`warn:${message}`) },
    error(message: string) { logs.push(`error:${message}`) },
  }

  try {
    const plan = await detectBuildPlan(repoDir)
    const result = await buildTheme({ ...plan, packageManager: 'npm' }, repoDir, outputDir, logger)
    assert.equal(result, outputDir)
    assert.equal(await readFile(path.join(outputDir, 'index.html'), 'utf8'), '<main>theme</main>')
    assert.ok(logs.some((line) => line.startsWith('warn:主题构建命令失败，但检测到本次生成的产物，继续启动')))
  } finally {
    fakeNpm.restorePath()
    await rm(repoDir, { recursive: true, force: true })
    await rm(outputDir, { recursive: true, force: true })
    await rm(fakeNpm.binDir, { recursive: true, force: true })
  }
})

test('falls back to npm when bun install fails', async () => {
  const repoDir = await packageFixture({
    'package.json': JSON.stringify({
      packageManager: 'bun@1.3.14',
      scripts: { build: 'build' },
    }),
    'package-lock.json': '{}',
    'index.html': '<script type="module" src="/src/main.ts"></script>',
  })
  const outputDir = await fixture()
  const fakeBun = await fakeBunFixture({ failInstall: true })
  const fakeNpm = await fakeNpmFixture({ writeOutputOnBuild: true })
  const logs: string[] = []
  const logger = {
    info(message: string) { logs.push(`info:${message}`) },
    warn(message: string) { logs.push(`warn:${message}`) },
    error(message: string) { logs.push(`error:${message}`) },
  }

  try {
    const plan = await detectBuildPlan(repoDir)
    const result = await buildTheme(plan, repoDir, outputDir, logger)
    assert.equal(result, outputDir)
    assert.equal(await readFile(path.join(outputDir, 'index.html'), 'utf8'), '<main>theme</main>')
    assert.ok(logs.some((line) => line.startsWith('warn:主题依赖安装失败，回退到 npm')))
  } finally {
    fakeBun.restorePath()
    fakeNpm.restorePath()
    await rm(repoDir, { recursive: true, force: true })
    await rm(outputDir, { recursive: true, force: true })
    await rm(fakeBun.binDir, { recursive: true, force: true })
    await rm(fakeNpm.binDir, { recursive: true, force: true })
  }
})

test('rejects a failed build command when no output was generated', async () => {
  const repoDir = await packageFixture({
    'package.json': JSON.stringify({ scripts: { build: 'build' } }),
    'package-lock.json': '{}',
  })
  const outputDir = await fixture()
  const fakeNpm = await fakeNpmFixture({ writeOutputOnBuild: false })

  try {
    const plan = await detectBuildPlan(repoDir)
    await assert.rejects(() => buildTheme({ ...plan, packageManager: 'npm' }, repoDir, outputDir), /failed/i)
  } finally {
    fakeNpm.restorePath()
    await rm(repoDir, { recursive: true, force: true })
    await rm(outputDir, { recursive: true, force: true })
    await rm(fakeNpm.binDir, { recursive: true, force: true })
  }
})

test('rejects stale pre-build output when the build command fails', async () => {
  const repoDir = await packageFixture({
    'package.json': JSON.stringify({ scripts: { build: 'build' } }),
    'package-lock.json': '{}',
    'dist/index.html': '<main>stale</main>',
  })
  const outputDir = await fixture()
  const fakeNpm = await fakeNpmFixture({ writeOutputOnBuild: false })

  try {
    const plan = await detectBuildPlan(repoDir)
    await assert.rejects(() => buildTheme({ ...plan, packageManager: 'npm' }, repoDir, outputDir), /stale residue/i)
  } finally {
    fakeNpm.restorePath()
    await rm(repoDir, { recursive: true, force: true })
    await rm(outputDir, { recursive: true, force: true })
    await rm(fakeNpm.binDir, { recursive: true, force: true })
  }
})

test('rejects output symlink escapes and missing index.html', async () => {
  const outsideDir = await fixture()
  const repoDir = await packageFixture({
    'package.json': JSON.stringify({ scripts: { build: 'build' } }),
    'package-lock.json': '{}',
  })
  const outputDir = await fixture()

  try {
    await writeFile(path.join(outsideDir, 'index.html'), 'outside')
    await symlink(outsideDir, path.join(repoDir, 'dist'), 'junction')
    const plan = await detectBuildPlan(repoDir)
    await assert.rejects(() => buildTheme({ ...plan, packageManager: 'none' }, repoDir, outputDir), /symlink|containment/i)

    await rm(path.join(repoDir, 'dist'), { recursive: true, force: true })
    await mkdir(path.join(repoDir, 'build'))
    await assert.rejects(() => buildTheme({ ...plan, packageManager: 'none' }, repoDir, outputDir), /index\.html/i)
  } finally {
    await rm(outsideDir, { recursive: true, force: true })
    await rm(repoDir, { recursive: true, force: true })
    await rm(outputDir, { recursive: true, force: true })
  }
})

test('rejects nested symlink escapes under an in-repository output symlink', async () => {
  const outsideDir = await fixture()
  const repoDir = await packageFixture({
    'package.json': JSON.stringify({ scripts: { build: 'build' } }),
    'package-lock.json': '{}',
  })
  const outputDir = await fixture()

  try {
    await writeFile(path.join(outsideDir, 'leaked.txt'), 'outside')
    await mkdir(path.join(repoDir, 'actual-dist', 'assets'), { recursive: true })
    await writeFile(path.join(repoDir, 'actual-dist', 'index.html'), '<main>theme</main>')
    await symlink(outsideDir, path.join(repoDir, 'actual-dist', 'assets', 'escape'), 'junction')
    await symlink(path.join(repoDir, 'actual-dist'), path.join(repoDir, 'dist'), 'junction')

    const plan = await detectBuildPlan(repoDir)
    await assert.rejects(() => buildTheme({ ...plan, packageManager: 'none' }, repoDir, outputDir), /symlink|containment/i)
  } finally {
    await rm(outsideDir, { recursive: true, force: true })
    await rm(repoDir, { recursive: true, force: true })
    await rm(outputDir, { recursive: true, force: true })
  }
})
