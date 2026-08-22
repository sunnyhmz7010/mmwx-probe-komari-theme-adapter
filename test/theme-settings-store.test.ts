import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { FileThemeSettingsStore, parseThemeSettingsJson } from '../src/theme/settings-store.js'

test('theme settings store reads and writes a JSON object', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'theme-settings-store-'))
  const filePath = path.join(dir, 'theme-settings.json')
  const store = new FileThemeSettingsStore(filePath)

  try {
    assert.deepEqual(await store.read(), {})
    await store.write({ showNotice: true, defaultViewMode: 'card' })
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), {
      showNotice: true,
      defaultViewMode: 'card',
    })
    assert.deepEqual(await store.read(), {
      showNotice: true,
      defaultViewMode: 'card',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('theme settings store rejects malformed or non-object JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'theme-settings-store-'))
  const filePath = path.join(dir, 'theme-settings.json')
  const store = new FileThemeSettingsStore(filePath)

  try {
    await writeFile(filePath, '[]')
    await assert.rejects(() => store.read(), /theme settings.*object/i)
    assert.throws(() => parseThemeSettingsJson('[]', 'THEME_SETTINGS_JSON'), /THEME_SETTINGS_JSON.*object/)
    assert.throws(() => parseThemeSettingsJson('{bad', 'THEME_SETTINGS_JSON'), /valid JSON/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
