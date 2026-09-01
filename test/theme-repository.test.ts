import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCloneUrl, isCommitRef, parseGitHubRepo, resolveThemeRef } from '../src/theme/repository.js'

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

test('builds the clone URL with and without a git proxy prefix', () => {
  assert.equal(buildCloneUrl({ owner: 'acme', name: 'komari-theme' }), 'https://github.com/acme/komari-theme.git')
  assert.equal(
    buildCloneUrl({ owner: 'acme', name: 'komari-theme' }, 'https://gh-proxy.com'),
    'https://gh-proxy.com/https://github.com/acme/komari-theme.git',
  )
  assert.equal(
    buildCloneUrl({ owner: 'acme', name: 'komari-theme' }, 'https://gh-proxy.com/'),
    'https://gh-proxy.com/https://github.com/acme/komari-theme.git',
  )
  assert.throws(() => buildCloneUrl({ owner: 'acme', name: 'komari-theme' }, 'http://gh-proxy.com'), /THEME_GIT_PROXY/)
  assert.throws(() => buildCloneUrl({ owner: 'acme', name: 'komari-theme' }, 'https://gh-proxy.com/x y'), /THEME_GIT_PROXY/)
})

test('preserves a safe theme ref exactly and rejects shell metacharacters', () => {
  const ref = 'refs/heads/release-candidate_1.2'

  assert.equal(resolveThemeRef(ref), ref)
  for (const value of ['', ' main', 'main ', 'main;rm', 'main&&echo', 'main`id`', 'main$HOME', '--upload-pack=x']) {
    assert.throws(() => resolveThemeRef(value), /THEME_REF/)
  }
})

test('recognizes short and full commit-like refs', () => {
  assert.equal(isCommitRef('abc1234'), true)
  assert.equal(isCommitRef('0123456789abcdef0123456789abcdef01234567'), true)
  assert.equal(isCommitRef('abc123'), false)
  assert.equal(isCommitRef('0123456789abcdef0123456789abcdef012345678'), false)
  assert.equal(isCommitRef('release-1'), false)
})
