import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { readThemeMetadata } from '../src/theme/loader.js'

async function tempRepo(files: Record<string, string>): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), 'komari-theme-meta-'))
  for (const [relative, content] of Object.entries(files)) {
    await writeFile(path.join(repoDir, relative), content)
  }
  return repoDir
}

test('reads Komari theme settings defaults from komari-theme.json', async () => {
  const repoDir = await tempRepo({
    'komari-theme.json': JSON.stringify({
      short: 'Glassmorphism',
      configuration: {
        data: [
          { key: 'layout', type: 'select', options: [{ label: 'Paper', value: 'paper' }, { label: 'Glass', value: 'glass' }] },
          { key: 'show_banner', type: 'switch' },
          { key: 'accent', default: 'blue' },
        ],
      },
    }),
  })

  try {
    await assert.doesNotReject(() => readThemeMetadata(repoDir))
    await assert.deepEqual(await readThemeMetadata(repoDir), {
      short: 'Glassmorphism',
      themeSettings: {
        layout: 'paper',
        show_banner: false,
        accent: 'blue',
      },
    })
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})
