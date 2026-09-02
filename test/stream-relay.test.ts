import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { WebSocket as WsWebSocket } from 'ws'

import type { ProbeOrigin, WebSocketFactory } from '../src/mmwx/stream-relay.js'
import type { ProbePayload } from '../src/mmwx/types.js'
import { ProbeHistoryBuffer } from '../src/mmwx/history-buffer.js'
import { ProbeStreamRelay } from '../src/mmwx/stream-relay.js'

// 受控假连接：模拟 ws 的 readyState 约定（0=CONNECTING, 1=OPEN, 3=CLOSED）。
class FakeSocket extends EventEmitter {
  public readyState = 0
  public closeCalls = 0

  public open(): void {
    this.readyState = 1
    this.emit('open')
  }

  public message(payload: ProbePayload): void {
    this.emit('message', Buffer.from(JSON.stringify(payload)))
  }

  public drop(): void {
    this.readyState = 3
    this.emit('close')
  }

  public close(): void {
    this.closeCalls += 1
    this.readyState = 3
    this.emit('close')
  }

  public send(): void {
    // 上游连接不会 send；下游客户端由用例按需记录。
  }
}

function probePayload(): ProbePayload {
  return {
    servers: [{
      name: 'Tokyo',
      online: true,
      cpu: 12.5,
      memory: 2048,
      ping: [
        { name: 'Google', value: 25, loss: 0 },
        { name: 'Cloudflare', latency: 3.5, loss_pct: 100 },
      ],
    }],
  }
}

function createOrigin(): ProbeOrigin & { fetchProbeCalls: number } {
  const origin = {
    fetchProbeCalls: 0,
    fetchProbe: async () => {
      origin.fetchProbeCalls += 1
      return probePayload()
    },
    fetchSeries: async () => {
      throw new Error('series is not used in relay tests')
    },
    streamUrl: () => 'ws://upstream.test/api/public/probe-ws',
    probeHeaders: () => ({ 'X-MMwx-Probe-Token': 'token' }),
  }
  return origin
}

function createRelayHarness() {
  const origin = createOrigin()
  const history = new ProbeHistoryBuffer()
  const sockets: FakeSocket[] = []
  const factory: WebSocketFactory = (() => {
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket as unknown as WsWebSocket
  }) as WebSocketFactory
  const relay = new ProbeStreamRelay(origin, history, factory)
  return { origin, history, sockets, relay }
}

test('常驻采样：start() 无访客也立即连接上游，重复调用幂等', () => {
  const { sockets, relay } = createRelayHarness()
  relay.start()
  relay.start()
  assert.equal(sockets.length, 1)
  relay.close()
})

test('常驻采样：上游断开后无条件重连，重连成功后退避计数重置', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const { sockets, relay } = createRelayHarness()
  relay.start()
  assert.equal(sockets.length, 1)

  // 首次断线：1s 后重连。
  sockets[0].drop()
  t.mock.timers.tick(999)
  assert.equal(sockets.length, 1)
  t.mock.timers.tick(1)
  assert.equal(sockets.length, 2)

  // 重连成功后退避计数清零，再次断线仍在 1s 后重连。
  sockets[1].open()
  sockets[1].drop()
  t.mock.timers.tick(1000)
  assert.equal(sockets.length, 3)
  relay.close()
})

test('帧分发：WS 帧写入历史缓冲，fetchProbe 在帧龄窗口内复用缓存帧', async () => {
  const { origin, history, sockets, relay } = createRelayHarness()
  relay.start()
  sockets[0].open()
  sockets[0].message(probePayload())
  sockets[0].message(probePayload())

  const load = history.snapshotLoad(0)
  assert.equal(load.length, 1, '同一秒的重复帧去重为一条样本')
  assert.equal(load[0].cpu, 12.5)

  const payload = await relay.fetchProbe()
  assert.equal(payload, await relay.fetchProbe())
  assert.equal(origin.fetchProbeCalls, 0, '缓存帧未过期时不应回源')
  relay.close()
})

test('看门狗：帧龄超阈值用 HTTP 快照兜底，正常帧龄不回源', async (t) => {
  // 显式指定 mock 时间起点，避免 Date mock 从 epoch 0 起步导致帧龄判断失真。
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000_000_000 })
  const { origin, sockets, relay } = createRelayHarness()
  relay.start()
  assert.equal(sockets.length, 1)

  // 上游一直未 open（模拟连接挂起）：启动 10s 后首个看门狗 tick 回源兜底。
  t.mock.timers.tick(10_000)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(origin.fetchProbeCalls, 1)

  // 兜底帧让 latestAt 前进 10s，20s 时刻帧龄 10s，不回源。
  t.mock.timers.tick(10_000)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(origin.fetchProbeCalls, 1)

  // 30s 时刻帧龄 20s 超阈值，再次回源。
  t.mock.timers.tick(10_000)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(origin.fetchProbeCalls, 2)
  relay.close()
})

test('停机清理：close() 取消待执行的重连与看门狗', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const { origin, sockets, relay } = createRelayHarness()
  relay.start()
  sockets[0].drop()
  relay.close()
  assert.equal(sockets[0].closeCalls, 0, 'close() 前上游已被置空，不重复关闭')

  t.mock.timers.tick(60_000)
  assert.equal(sockets.length, 1, '重连定时器已取消')
  assert.equal(origin.fetchProbeCalls, 0, '看门狗已停止')
})

test('下游广播：新访客收到最近帧，后续帧广播给所有访客', () => {
  const { sockets, relay } = createRelayHarness()
  relay.start()
  sockets[0].open()

  const seenByFirst: string[] = []
  const seenBySecond: string[] = []
  const first = { readyState: 1, close() {}, send: (data: string) => seenByFirst.push(data) } as unknown as WsWebSocket
  const second = { readyState: 1, close() {}, send: (data: string) => seenBySecond.push(data) } as unknown as WsWebSocket

  sockets[0].message(probePayload())
  relay.subscribe(first)
  assert.equal(seenByFirst.length, 1, '订阅时补发最近一帧')

  sockets[0].message(probePayload())
  assert.equal(seenByFirst.length, 2)
  relay.subscribe(second)
  assert.equal(seenBySecond.length, 1)

  relay.unsubscribe(first)
  sockets[0].message(probePayload())
  assert.equal(seenByFirst.length, 2, '退订后不再收到广播')
  assert.equal(seenBySecond.length, 2)
  relay.close()
})
