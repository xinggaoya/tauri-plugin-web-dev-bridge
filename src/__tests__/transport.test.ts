import { describe, expect, it, vi } from 'vitest'
import { BridgeTransport } from '../transport'
import type { BridgeDescriptor } from '../types'

const DESCRIPTOR: BridgeDescriptor = {
  port: 6222,
  pid: 1,
  url: 'http://127.0.0.1:6222',
}

/** 构造一个只返回固定 JSON 的假 fetch。 */
function createFetch(payload: unknown, calls: string[] = []) {
  return vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as unknown as Response
  }) as unknown as typeof fetch
}

describe('BridgeTransport.pollEvents', () => {
  it('解析游标与事件列表', async () => {
    const calls: string[] = []
    const fetchImpl = createFetch(
      {
        cursor: 7,
        events: [{ event: 'traffic-data', payload: { up: 1 } }],
      },
      calls,
    )
    const transport = new BridgeTransport(async () => DESCRIPTOR, fetchImpl)

    const result = await transport.pollEvents(3)

    expect(result.cursor).toBe(7)
    expect(result.events).toEqual([{ event: 'traffic-data', payload: { up: 1 } }])
    expect(calls[0]).toContain('/events?client=')
    expect(calls[0]).toContain('since=3')
  })

  it('桥不可用时抛出明确错误', async () => {
    const transport = new BridgeTransport(async () => null, createFetch({}))

    await expect(transport.pollEvents(0)).rejects.toThrow(/未找到调试桥/)
  })
})

describe('BridgeTransport.startEventPolling', () => {
  it('轮询并投递事件，直到停止', async () => {
    vi.useFakeTimers()
    try {
      let tick = 0
      const fetchImpl = vi.fn(async () => {
        tick += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cursor: tick,
            events: [{ event: 'log-data', payload: `line-${tick}` }],
          }),
        } as unknown as Response
      }) as unknown as typeof fetch

      const transport = new BridgeTransport(async () => DESCRIPTOR, fetchImpl)
      const received: string[] = []
      const stop = transport.startEventPolling(
        (event) => received.push(String(event.payload)),
        1000,
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(received).toEqual(['line-1'])

      await vi.advanceTimersByTimeAsync(1000)
      expect(received).toEqual(['line-1', 'line-2'])

      stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(received).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
