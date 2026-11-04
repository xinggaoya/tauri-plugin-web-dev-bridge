import { describe, expect, it, vi } from 'vitest'
import { createTauriInternals } from '../internals'
import type { BridgeTransport } from '../transport'

/** 构造一个只关心命令名与参数的假传输层。 */
function createTransport(handlers: Record<string, unknown> = {}) {
  const invoke = vi.fn(async (cmd: string, _args: Record<string, unknown> = {}) => {
    if (cmd in handlers) return handlers[cmd]
    if (cmd === 'plugin:event|listen') return 42
    return null
  })
  return { transport: { invoke } as unknown as BridgeTransport, invoke }
}

describe('createTauriInternals', () => {
  it('为回调分配稳定 id 并能正确触发', () => {
    const { transport } = createTransport()
    const { internals } = createTauriInternals({ transport, windowLabel: 'main' })

    const handler = vi.fn()
    const id = internals.transformCallback(handler)

    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)

    internals.runCallback(id, { up: 1, down: 2 })
    expect(handler).toHaveBeenCalledWith({ up: 1, down: 2 })
  })

  it('once 回调只触发一次', () => {
    const { transport } = createTransport()
    const { internals } = createTauriInternals({ transport, windowLabel: 'main' })

    const handler = vi.fn()
    const id = internals.transformCallback(handler, true)

    internals.runCallback(id, 'first')
    internals.runCallback(id, 'second')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('first')
  })

  it('注销后不再触发回调', () => {
    const { transport } = createTransport()
    const { internals } = createTauriInternals({ transport, windowLabel: 'main' })

    const handler = vi.fn()
    const id = internals.transformCallback(handler)

    internals.unregisterCallback(id)
    internals.runCallback(id, 'ignored')

    expect(handler).not.toHaveBeenCalled()
  })

  it('把事件分发给已注册的回调，并带上 eventId', async () => {
    const { transport } = createTransport()
    const { internals, dispatchEvent } = createTauriInternals({ transport, windowLabel: 'main' })

    const handler = vi.fn()
    const handlerId = internals.transformCallback(handler)

    const eventId = await internals.invoke('plugin:event|listen', {
      event: 'traffic-data',
      handler: handlerId,
    })
    expect(eventId).toBe(42)

    dispatchEvent({ event: 'traffic-data', payload: { up: 10 } })

    expect(handler).toHaveBeenCalledWith({
      event: 'traffic-data',
      id: 42,
      payload: { up: 10 },
    })
  })

  it('退订后不再收到事件', async () => {
    const { transport } = createTransport()
    const { internals, dispatchEvent } = createTauriInternals({ transport, windowLabel: 'main' })

    const handler = vi.fn()
    const handlerId = internals.transformCallback(handler)
    await internals.invoke('plugin:event|listen', { event: 'log-data', handler: handlerId })

    await internals.invoke('plugin:event|unlisten', { event: 'log-data', eventId: 42 })
    dispatchEvent({ event: 'log-data', payload: 'nope' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('未注册的事件不会抛错', () => {
    const { transport } = createTransport()
    const { dispatchEvent } = createTauriInternals({ transport, windowLabel: 'main' })

    expect(() => dispatchEvent({ event: 'nobody-listens', payload: null })).not.toThrow()
  })

  it('普通命令原样转发给传输层', async () => {
    const { transport, invoke } = createTransport({ db_get_app_config: { apiPort: 9090 } })
    const { internals } = createTauriInternals({ transport, windowLabel: 'main' })

    const result = await internals.invoke('db_get_app_config', {})

    expect(result).toEqual({ apiPort: 9090 })
    expect(invoke).toHaveBeenCalledWith('db_get_app_config', {})
  })

  it('暴露当前窗口标签，供 Window.getCurrent() 使用', () => {
    const { transport } = createTransport()
    const { internals } = createTauriInternals({ transport, windowLabel: 'main' })

    expect(internals.metadata.currentWindow.label).toBe('main')
  })
})
