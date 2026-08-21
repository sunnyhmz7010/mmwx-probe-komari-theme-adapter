import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseGitHubRepo, resolveThemeRef } from '../src/theme/repository.js'

test('parses the supported GitHub repository URL forms', () => {
  assert.deepEqual(parseGitHubRepo('https://github.com/acme/komari-theme'), {
    owner: 'acme',
    name: 'komari-theme',
  })
  assert.deepEqual(parseGitHubRepo('https://github.com/acme/komari-theme.git'), {
    owner: 'acme',
    name: 'komari-theme',
  })
})

test('rejects repository URLs outside the exact GitHub HTTPS shape', () => {
  for (const value of [
    '',
    'https://github.com/acme',
    'https://github.com//komari-theme',
    'https://github.com/acme/',
    'http://github.com/acme/komari-theme',
    'https://gitlab.com/acme/komari-theme',
    'https://github.com/acme/komari-theme?ref=main',
    'https://github.com/acme/komari-theme#readme',
    './acme/komari-theme',
    'C:\\acme\\komari-theme',
  ]) {
    assert.throws(() => parseGitHubRepo(value), /THEME_REPO/)
  }
})

test('preserves a safe theme ref exactly and rejects shell metacharacters', () => {
  const ref = 'refs/heads/release-candidate_1.2'

  assert.equal(resolveThemeRef(ref), ref)
  for (const value of ['', ' main', 'main ', 'main;rm', 'main&&echo', 'main`id`', 'main$HOME', '--upload-pack=x']) {
    assert.throws(() => resolveThemeRef(value), /THEME_REF/)
  }
})
