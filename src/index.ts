import { discoverBridge, getClientId, waitForBridge } from './discovery'
import { createTauriInternals } from './internals'
import { BridgeTransport } from './transport'
import type { BridgeDescriptor } from './types'

export type {
  BridgeDescriptor,
  BridgeEvent,
  ClientId,
  InvokeOptions,
  TauriInternals,
} from './types'
export { getClientId } from './discovery'
// 注意：**不要**在这里 re-export `./vite`。该模块依赖 node:fs / node:os / node:path，
// 浏览器端无法加载；一旦被入口文件静态引入，整个 main.ts 模块图会在求值阶段报错，
// 表现为白屏。vite 插件请从 `tauri-plugin-web-dev-bridge/vite` 子路径引入。

/** 安装参数。 */
export interface InstallWebDevBridgeOptions {
  /** 显式指定桥的基地址。 */
  baseUrl?: string
  /** 显式指定桥的端口。 */
  port?: number
  /** 承载 IPC 的窗口标签，默认 `main`。 */
  windowLabel?: string
  /** 是否订阅事件流，默认 `true`。 */
  events?: boolean
  /** 事件轮询间隔（毫秒），默认 1000。 */
  eventPollIntervalMs?: number
  /** 同源发现路由，默认 `/__tauri_dev_bridge__/info`。 */
  discoveryRoute?: string
  /** 兜底探测端口，默认 6222。 */
  fallbackPort?: number
  /** 等待桥就绪的最长时间（毫秒），默认 15000。 */
  timeoutMs?: number
  /** 注入的 fetch 实现（测试用）。 */
  fetchImpl?: typeof fetch
}

/** 安装结果句柄。 */
export interface WebDevBridgeHandle {
  /** 是否真的安装了 shim。在 Tauri 环境下为 `false`（未做任何改动）。 */
  readonly installed: boolean
  /** 当前浏览器标签页的客户端标识。 */
  readonly clientId: string
  /** 等待桥就绪，返回桥的描述信息。 */
  ready(): Promise<BridgeDescriptor | null>
  /** 拆除 shim（主要用于测试）。 */
  dispose(): void
}

interface TauriGlobal {
  __TAURI_INTERNALS__?: unknown
  __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown
  isTauri?: boolean
}

/** 是否运行在 Tauri 环境里。 */
export function isTauriRuntime(): boolean {
  const scope = globalThis as TauriGlobal
  return Boolean(scope.isTauri || scope.__TAURI_INTERNALS__)
}

/**
 * 安装浏览器侧 shim。
 *
 * 在 Tauri 环境里这是**空操作**——真实环境已经有官方 `__TAURI_INTERNALS__`，
 * 覆盖它会破坏桌面端行为。
 *
 * 在普通浏览器里，它会接管 `window.__TAURI_INTERNALS__`，
 * 把 `@tauri-apps/api` 发出的每一次 `invoke` 转发给本地调试桥，
 * 从而让页面拿到**真实后端**的数据与事件。
 *
 * ```ts
 * import { installWebDevBridge } from 'tauri-plugin-web-dev-bridge'
 *
 * installWebDevBridge()
 * ```
 */
export function installWebDevBridge(options: InstallWebDevBridgeOptions = {}): WebDevBridgeHandle {
  const scope = globalThis as TauriGlobal

  if (isTauriRuntime()) {
    return {
      installed: false,
      clientId: getClientId(),
      ready: async () => null,
      dispose: () => undefined,
    }
  }

  const clientId = getClientId()
  let cached: BridgeDescriptor | null = null
  let pending: Promise<BridgeDescriptor | null> | null = null

  const resolveDescriptor = async (): Promise<BridgeDescriptor | null> => {
    if (cached) return cached
    if (!pending) {
      pending = waitForBridge({
        baseUrl: options.baseUrl,
        port: options.port,
        discoveryRoute: options.discoveryRoute,
        fallbackPort: options.fallbackPort,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      }).then((descriptor) => {
        cached = descriptor
        if (!descriptor) {
          // 失败时清空进行中的 Promise，允许后续调用重试。
          pending = null
        }
        return descriptor
      })
    }
    return pending
  }

  const transport = new BridgeTransport(resolveDescriptor, options.fetchImpl)
  const bundle = createTauriInternals({
    transport,
    windowLabel: options.windowLabel ?? 'main',
  })

  scope.__TAURI_INTERNALS__ = bundle.internals
  scope.__TAURI_EVENT_PLUGIN_INTERNALS__ = bundle.eventPluginInternals

  let closeEventStream: (() => void) | null = null
  if (options.events !== false) {
    closeEventStream = transport.startEventPolling(
      (event) => bundle.dispatchEvent(event),
      options.eventPollIntervalMs,
    )
  }

  const handle: WebDevBridgeHandle = {
    installed: true,
    clientId,
    ready: async () => {
      const descriptor = await resolveDescriptor()
      if (!descriptor && options.baseUrl) {
        return {
          port: options.port ?? 0,
          pid: 0,
          url: options.baseUrl,
        }
      }
      return descriptor
    },
    dispose: () => {
      closeEventStream?.()
      closeEventStream = null
      delete scope.__TAURI_INTERNALS__
      delete scope.__TAURI_EVENT_PLUGIN_INTERNALS__
    },
  }

  // 暴露给调试工具 / 自动化测试：可以直接查询桥状态与客户端标识。
  ;(scope as TauriGlobal & { __TAURI_DEV_BRIDGE__?: WebDevBridgeHandle }).__TAURI_DEV_BRIDGE__ =
    handle

  return handle
}

export { discoverBridge, waitForBridge }
