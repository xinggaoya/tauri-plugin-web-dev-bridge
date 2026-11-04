import { describe, expect, it, vi } from 'vitest'
import { discoverBridge, getClientId } from '../discovery'

/** 构造一个按 URL 分流的假 fetch。 */
function createFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = Object.keys(routes).find((route) => url.includes(route))
    if (key === undefined) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => routes[key],
    } as unknown as Response
  }) as unknown as typeof fetch
}

describe('discoverBridge', () => {
  it('优先使用同源发现路由，并探活确认端口可用', async () => {
    const fetchImpl = createFetch({
      '/__tauri_dev_bridge__/info': { port: 7000, pid: 42, url: 'http://127.0.0.1:7000' },
      '/health': { ok: true, pid: 42 },
    })

    const descriptor = await discoverBridge({ fetchImpl })

    expect(descriptor?.port).toBe(7000)
    expect(descriptor?.pid).toBe(42)
  })

  it('描述文件是陈旧数据时回退到默认端口探测', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/__tauri_dev_bridge__/info')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ port: 7000, pid: 1, url: 'http://127.0.0.1:7000' }),
        } as unknown as Response
      }
      if (url.includes(':6222/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, pid: 7 }),
        } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch

    const descriptor = await discoverBridge({ fetchImpl })

    expect(descriptor?.port).toBe(6222)
    expect(descriptor?.pid).toBe(7)
  })

  it('显式给出 baseUrl 时不做任何探测', async () => {
    const fetchImpl = createFetch({})

    const descriptor = await discoverBridge({ baseUrl: 'http://127.0.0.1:1234', fetchImpl })

    expect(descriptor?.url).toBe('http://127.0.0.1:1234')
  })

  it('桥不可用时返回 null', async () => {
    const fetchImpl = createFetch({})

    const descriptor = await discoverBridge({ fetchImpl })

    expect(descriptor).toBeNull()
  })
})

describe('getClientId', () => {
  it('同一会话内返回稳定标识', () => {
    const first = getClientId()
    const second = getClientId()
    expect(first).toBe(second)
    expect(first.length).toBeGreaterThan(0)
  })
})
