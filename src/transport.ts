import { getClientId } from './discovery'
import type { BridgeDescriptor, BridgeEvent, InvokeEnvelope } from './types'

/** 事件流通道。 */
export type EventStreamListener = (event: BridgeEvent) => void

/** 一次事件拉取的结果。 */
export interface EventPollResult {
  /** 新的游标（下次带上即可）。 */
  cursor: number
  /** 本次拉到的件。 */
  events: BridgeEvent[]
}

/** 默认的事件轮询间隔（毫秒）。 */
export const DEFAULT_EVENT_POLL_INTERVAL_MS = 1000

/**
 * 与桥通信的传输层。
 *
 * - 命令调用走 `POST /invoke`（同步、易用 curl 调试）；
 * - 事件流走 `GET /events`（SSE，单向推送 + 自动重连）。
 */
export class BridgeTransport {
  constructor(
    private readonly resolveDescriptor: () => Promise<BridgeDescriptor | null>,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private get fetch(): typeof fetch {
    if (this.fetchImpl) return this.fetchImpl
    if (typeof fetch === 'function') return fetch.bind(globalThis)
    throw new Error('[web-dev-bridge] 当前环境没有 fetch')
  }

  /**
   * 调用一个后端命令。
   *
   * 失败时以**原始错误负载** reject——与 Tauri 官方 `invoke` 的语义一致，
   * 这样业务代码里的 `catch (e)` 无需区分两种错误来源。
   */
  async invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const descriptor = await this.resolveDescriptor()
    if (!descriptor) {
      throw new Error(
        '[web-dev-bridge] 未找到调试桥：请确认桌面应用已启动（`pnpm tauri dev`），' +
          '且已注册 webDevBridgeVitePlugin()。',
      )
    }

    const response = await this.fetch(`${descriptor.url}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ cmd, args, clientId: getClientId() }),
    })

    if (!response.ok) {
      throw new Error(`[web-dev-bridge] 命令 ${cmd} 失败：HTTP ${response.status}`)
    }

    const envelope = (await response.json()) as InvokeEnvelope<T>
    if (!envelope.ok) {
      throw envelope.error
    }
    return envelope.data as T
  }

  /**
   * 拉取自 `since` 之后的事件。
   *
   * 用**短轮询**而非 SSE / WebSocket：长连接会让浏览器自动化工具的
   * *networkidle* 判定永远无法达成（`agent-browser open` 之类的命令会一直挂起），
   * 而轮询在两次请求之间留出了空闲窗口。
   */
  async pollEvents(since: number): Promise<EventPollResult> {
    const descriptor = await this.resolveDescriptor()
    if (!descriptor) {
      throw new Error('[web-dev-bridge] 未找到调试桥，无法拉取事件。')
    }

    const url = `${descriptor.url}/events?client=${encodeURIComponent(getClientId())}&since=${since}`
    const response = await this.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`[web-dev-bridge] 拉取事件失败：HTTP ${response.status}`)
    }

    const body = (await response.json()) as { cursor?: number; events?: BridgeEvent[] }
    return {
      cursor: typeof body.cursor === 'number' ? body.cursor : since,
      events: Array.isArray(body.events) ? body.events : [],
    }
  }

  /**
   * 启动事件轮询，返回一个停止函数。
   *
   * 用 `setTimeout` 串联而非 `setInterval`，避免上一次请求未完成时叠加上一次。
   */
  startEventPolling(
    listener: EventStreamListener,
    intervalMs: number = DEFAULT_EVENT_POLL_INTERVAL_MS,
  ): () => void {
    let cursor = 0
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (stopped) return
      try {
        const result = await this.pollEvents(cursor)
        cursor = result.cursor
        for (const event of result.events) {
          listener(event)
        }
      } catch {
        // 桥暂不可用时静默重试；下一次轮询会自动恢复。
      }
      if (!stopped) {
        timer = setTimeout(() => void tick(), intervalMs)
      }
    }

    void tick()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}
