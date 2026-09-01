import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import type { ProbePayload, ProbeServer } from '../src/mmwx/types.js'
import { ProbeHistoryBuffer } from '../src/mmwx/history-buffer.js'
import { FileHistoryBufferStore } from '../src/mmwx/history-store.js'

// T0 相对当前时间取值并对齐到整秒：缓冲只保留有限时间窗且时间戳按秒截断，
// 写死日期或带毫秒尾数都会让断言与实际存储值不一致。
const T0 = Math.floor(Date.now() / 1000) * 1000 - 120_000

function frame(atMs: number, overrides: Partial<ProbeServer> = {}): { payload: ProbePayload; at: Date } {
  return {
    payload: {
      servers: [{
        name: 'Tokyo',
        online: true,
        cpu: 12.5,
        memory: 2048,
        mem_total: 4096,
        ping: [{ name: 'Google', value: 25, loss: 0 }],
        ...overrides,
      }],
    },
    at: new Date(atMs),
  }
}

test('flushes and restores the history buffer through the file store', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'history-store-'))
  after(() => rmSync(directory, { recursive: true, force: true }))
  const store = new FileHistoryBufferStore(path.join(directory, 'history-buffer.json'))

  // 文件不存在时静默恢复为空缓冲。
  const fresh = new ProbeHistoryBuffer()
  await store.restore(fresh)
  assert.equal(fresh.snapshotLoad(0).length, 0)

  const buffer = new ProbeHistoryBuffer()
  const first = frame(T0)
  buffer.ingest(first.payload, first.at)
  // 两帧相隔超过 1 分钟：恢复时热层点降级为分钟粒度冷层后不会互相覆盖。
  const second = frame(T0 + 90_000, { cpu: 30 })
  buffer.ingest(second.payload, second.at)
  await store.flush(buffer)

  const restored = new ProbeHistoryBuffer()
  await store.restore(restored)
  assert.deepEqual(restored.snapshotLoad(0).map((point) => [point.t, point.cpu]), [[T0, 12.5], [T0 + 90_000, 30]])
  assert.equal(restored.snapshotPing(0).get('Google')?.length, 2)
})

test('restore rejects corrupted snapshots instead of keeping partial data', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'history-store-'))
  after(() => rmSync(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'history-buffer.json')
  const store = new FileHistoryBufferStore(filePath)

  writeFileSync(filePath, '{broken json', 'utf8')
  await assert.rejects(() => store.restore(new ProbeHistoryBuffer()))
})
