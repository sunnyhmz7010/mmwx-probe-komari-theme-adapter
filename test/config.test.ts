import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeConfig, loadConfig } from '../src/config.js'
import { logError, logInfo } from '../src/log.js'

function isConfigError(error: unknown): error is { message: string; name: string } {
  return error instanceof Error && error.name === 'ConfigError'
}

const validEnv = {
  MMWX_ORIGIN: 'https://panel.example.com',
  PROBE_TOKEN: 'secret-token',
  THEME_REPO: 'https://github.com/example/theme',
}

test('rejects missing MMWX_ORIGIN', () => {
  assert.throws(
    () => loadConfig({ ...validEnv, MMWX_ORIGIN: undefined }),
    (error: unknown) => isConfigError(error) && /MMWX_ORIGIN is required/.test(error.message),
  )
})

test('rejects missing PROBE_TOKEN', () => {
  assert.throws(
    () => loadConfig({ ...validEnv, PROBE_TOKEN: undefined }),
    (error: unknown) => isConfigError(error) && /PROBE_TOKEN is required/.test(error.message),
  )
})

test('rejects a production HTTP MMWX origin without exposing the token', () => {
  assert.throws(
    () => loadConfig({ ...validEnv, MMWX_ORIGIN: 'http://panel.example.com' }),
    (error: unknown) => isConfigError(error)
      && /MMWX_ORIGIN must use HTTPS/.test(error.message)
      && !error.message.includes(validEnv.PROBE_TOKEN),
  )
})

test('allows HTTP only for localhost and loopback origins', () => {
  assert.equal(loadConfig({ ...validEnv, MMWX_ORIGIN: 'http://localhost:3000/' }).mmwxOrigin, 'http://localhost:3000')
  assert.equal(loadConfig({ ...validEnv, MMWX_ORIGIN: 'http://127.0.0.1:3000/' }).mmwxOrigin, 'http://127.0.0.1:3000')
})

test('rejects missing THEME_REPO', () => {
  assert.throws(
    () => loadConfig({ ...validEnv, THEME_REPO: undefined }),
    (error: unknown) => isConfigError(error) && /THEME_REPO is required/.test(error.message),
  )
})

test('loads defaults and normalizes the origin', () => {
  const config = loadConfig({ ...validEnv, MMWX_ORIGIN: 'https://panel.example.com///' })

  assert.deepEqual(config, {
    mmwxOrigin: 'https://panel.example.com',
    probeToken: validEnv.PROBE_TOKEN,
    themeRepo: validEnv.THEME_REPO,
    themeRef: 'main',
    themeBuild: undefined,
    port: 8080,
    cacheTtlMs: 5000,
    dataDir: '/data',
  })
})

test('describes the complete startup configuration without exposing the probe token', () => {
  const config = loadConfig({
    ...validEnv,
    THEME_REF: 'v1.2.3',
    THEME_BUILD: 'npm run build',
    PORT: '9090',
    CACHE_TTL: '12',
    DATA_DIR: './runtime-data',
  })

  const summary = describeConfig(config)
  assert.match(summary, /MMWX_ORIGIN=https:\/\/panel\.example\.com/)
  assert.match(summary, /PROBE_TOKEN=\[REDACTED\]/)
  assert.match(summary, /THEME_REPO=https:\/\/github\.com\/example\/theme/)
  assert.match(summary, /THEME_REF=v1\.2\.3/)
  assert.match(summary, /THEME_BUILD=npm run build/)
  assert.match(summary, /PORT=9090/)
  assert.match(summary, /CACHE_TTL=12s/)
  assert.match(summary, /DATA_DIR=.*runtime-data/)
  assert.equal(summary.includes(validEnv.PROBE_TOKEN), false)
})

test('accepts overrides and resolves DATA_DIR', () => {
  const config = loadConfig({
    ...validEnv,
    THEME_REF: 'v1.2.3',
    THEME_BUILD: 'npm run build',
    PORT: '9090',
    CACHE_TTL: '12',
    DATA_DIR: './runtime-data',
  })

  assert.equal(config.themeRef, 'v1.2.3')
  assert.equal(config.themeBuild, 'npm run build')
  assert.equal(config.port, 9090)
  assert.equal(config.cacheTtlMs, 12000)
  assert.match(config.dataDir, /runtime-data$/)
})

test('rejects malformed integer configuration', () => {
  for (const [key, value] of [['PORT', '8.5'], ['CACHE_TTL', '-1'], ['PORT', 'not-a-number']] as const) {
    assert.throws(
      () => loadConfig({ ...validEnv, [key]: value }),
      (error: unknown) => isConfigError(error) && new RegExp(key).test(error.message),
    )
  }
})

test('rejects malformed repository URLs', () => {
  for (const themeRepo of [
    'http://github.com/example/theme',
    'https://gitlab.com/example/theme',
    'https://github.com/example/theme?ref=main',
    'https://github.com//theme',
  ]) {
    assert.throws(
      () => loadConfig({ ...validEnv, THEME_REPO: themeRepo }),
      (error: unknown) => isConfigError(error) && /THEME_REPO/.test(error.message),
    )
  }
})

test('never includes the token in configuration errors', () => {
  const token = 'do-not-leak-this-token'

  assert.throws(
    () => loadConfig({ ...validEnv, PROBE_TOKEN: token, PORT: 'invalid' }),
    (error: unknown) => isConfigError(error) && !error.message.includes(token),
  )
})

test('redacts explicit secrets from log messages and context', () => {
  const secret = 'explicit-test-secret'
  const outputs: string[] = []
  const originalInfo = console.info
  const originalError = console.error

  console.info = (...args: unknown[]) => outputs.push(args.join(' '))
  console.error = (...args: unknown[]) => outputs.push(args.join(' '))

  try {
    logInfo(`message ${secret}`, { detail: `context ${secret}` }, [secret])
    logError(`message ${secret}`, { detail: `context ${secret}` }, [secret])
  } finally {
    console.info = originalInfo
    console.error = originalError
  }

  assert.equal(outputs.length, 2)
  for (const output of outputs) {
    assert.equal(output.includes(secret), false)
    assert.equal(output.match(/\[REDACTED\]/g)?.length, 2)
  }
})
