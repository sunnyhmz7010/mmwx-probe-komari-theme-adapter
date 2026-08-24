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
    adminToken: undefined,
  })
})

test('describes the complete startup configuration without exposing the probe token', () => {
  const config = loadConfig({
    ...validEnv,
    THEME_REF: 'v1.2.3',
    ADMIN_TOKEN: 'admin-secret',
  })

  const summary = describeConfig(config)
  assert.match(summary, /MMWX_ORIGIN=https:\/\/panel\.example\.com/)
  assert.match(summary, /PROBE_TOKEN=\[REDACTED\]/)
  assert.match(summary, /THEME_REPO=https:\/\/github\.com\/example\/theme/)
  assert.match(summary, /THEME_REF=v1\.2\.3/)
  assert.equal(summary.includes('PORT'), false)
  assert.match(summary, /ADMIN_TOKEN=\[REDACTED\]/)
  assert.match(summary, /VERSION=v\d+\.\d+\.\d+/)
  assert.equal(summary.includes('CACHE_TTL'), false)
  assert.equal(summary.includes('THEME_BUILD'), false)
  assert.equal(summary.includes('DATA_DIR'), false)
  assert.equal(summary.includes('THEME_SETTINGS_FILE'), false)
  assert.equal(summary.includes('THEME_SETTINGS_JSON'), false)
  assert.equal(summary.includes(validEnv.PROBE_TOKEN), false)
  assert.equal(summary.includes('admin-secret'), false)
})

test('ignores removed path and build environment variables', () => {
  const config = loadConfig({
    ...validEnv,
    THEME_REF: 'v1.2.3',
    THEME_BUILD: 'npm run build',
    DATA_DIR: './runtime-data',
    THEME_SETTINGS_FILE: './runtime-data/custom-theme-settings.json',
    THEME_SETTINGS_JSON: '{"showNotice":true}',
  })

  assert.equal(config.themeRef, 'v1.2.3')
  assert.equal(config.adminToken, undefined)
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
    () => loadConfig({ ...validEnv, PROBE_TOKEN: token, MMWX_ORIGIN: 'http://panel.example.com' }),
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
