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

  try {
    const plan = await detectBuildPlan(repoDir)
    assert.deepEqual(plan.outputCandidates, ['dist', 'build', 'out', 'public', '.'])
    assert.equal(await buildTheme({ ...plan, packageManager: 'none' }, repoDir, outputDir), outputDir)
    assert.equal(await readFile(path.join(outputDir, 'index.html'), 'utf8'), '<main>theme</main>')
  } finally {
    await rm(repoDir, { recursive: true, force: true })
    await rm(outputDir, { recursive: true, force: true })
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
