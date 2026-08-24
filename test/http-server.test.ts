import assert from 'node:assert/strict'
import { test } from 'node:test'

import { adminThemeSettingsHtml } from '../src/http/server.js'
import type { LoadedTheme } from '../src/theme/types.js'

function theme(repoUrl: string): LoadedTheme {
  return {
    directory: '/tmp/theme',
    indexPath: '/tmp/theme/index.html',
    short: 'test-theme',
    manifest: { short: 'test-theme' },
    source: { repoUrl, ref: 'main' },
  }
}

test('admin keeps token card and appends frontend theme management notice for supported themes', () => {
  const html = adminThemeSettingsHtml(theme('https://github.com/stqfdyr/komari-theme-Lumina'))

  assert.match(html, /ADMIN_TOKEN/)
  assert.match(html, />验证</)
  assert.match(html, /验证成功，登录态已建立/)
  assert.match(html, /当前主题未声明可配置项/)
  assert.match(html, /版本：<b>v\d+\.\d+\.\d+<\/b>/)
  assert.match(html, /"frontendThemeManagement":true/)
  assert.match(html, /\/\?view=theme-manage/)
})

test('admin keeps the original no-configuration notice for unrelated themes', () => {
  const html = adminThemeSettingsHtml(theme('https://github.com/stqfdyr/komari-theme-adhesive-note'))

  assert.match(html, /ADMIN_TOKEN/)
  assert.match(html, /当前主题未声明可配置项/)
  assert.match(html, /"frontendThemeManagement":false/)
})

test('admin keeps configuration saving inside the theme card and exposes logout controls', () => {
  const html = adminThemeSettingsHtml(theme('https://github.com/example/komari-theme-managed'))

  assert.match(html, /\/api\/admin\/auth\/logout/)
  assert.match(html, />退出登录</)
  assert.match(html, /保存主题配置/)
  assert.doesNotMatch(html, /function saveCard\(/)
  assert.match(html, /<div class="fields">'.*<div class="actions"><button class="btn" id="save"/s)
  assert.match(html, /setTimeout\(\(\)=>\{element\.textContent="";element\.className="msg"\},3000\)/)
})
