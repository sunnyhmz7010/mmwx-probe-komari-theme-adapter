import assert from 'node:assert/strict'
import { test } from 'node:test'

test('startup modules are present and expose the start lifecycle', async () => {
  const main = await import('../src/main.js')
  assert.equal(typeof main.start, 'function')
})
