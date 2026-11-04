import { CLIENT_ID_STORAGE_KEY, DEFAULT_BRIDGE_PORT, DISCOVERY_ROUTE } from './constants'
import type { BridgeDescriptor, ClientId } from './types'

/** 端口发现的可调参数。 */
export interface DiscoveryOptions {
  /** 显式指定桥的基地址（例如 `http://127.0.0.1:6222`）。 */
  baseUrl?: string
  /** 显式指定桥的端口。 */
  port?: number
  /** 同源发现路由，默认 `/__tauri_dev_bridge__/info`。 */
  discoveryRoute?: string
  /** 兜底探测的端口，默认 6222。 */
  fallbackPort?: number
  /** 注入的 fetch 实现（测试用）。 */
  fetchImpl?: typeof fetch
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl) return fetchImpl
  if (typeof fetch === 'function') return fetch.bind(globalThis)
  throw new Error('[web-dev-bridge] 当前环境没有 fetch')
}

function isDescriptor(value: unknown): value is BridgeDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BridgeDescriptor).port === 'number' &&
    Number.isFinite((value as BridgeDescriptor).port) &&
    (value as BridgeDescriptor).port > 0
  )
}

/** 由端口拼出基地址。 */
export function buildBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

/**
 * 读取浏览器侧客户端标识。
 *
 * 事件订阅在 Rust 侧按客户端隔离，因此每个标签页（含自动化测试的多个上下文）
 * 必须有稳定且互不相同的标识。放在 sessionStorage：同一标签页刷新后保持不变
 * （Rust 侧的监听器不用重建），不同标签页互不相同。
 */
export function getClientId(): ClientId {
  try {
    const stored = globalThis.sessionStorage?.getItem(CLIENT_ID_STORAGE_KEY)
    if (stored) return stored
  } catch {
    // 隐私模式下 sessionStorage 可能不可用，退化为内存内标识。
  }

  const generated = `client-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  try {
    globalThis.sessionStorage?.setItem(CLIENT_ID_STORAGE_KEY, generated)
  } catch {
    // 忽略写入失败。
  }
  return generated
}

/** 探测指定端口是否为桥。 */
async function probePort(port: number, fetchImpl: typeof fetch): Promise<BridgeDescriptor | null> {
  try {
    const response = await fetchImpl(`${buildBaseUrl(port)}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const body = (await response.json()) as Partial<BridgeDescriptor> | null
    return {
      port,
      pid: typeof body?.pid === 'number' ? body.pid : 0,
      url: buildBaseUrl(port),
    }
  } catch {
    return null
  }
}

/**
 * 发现桥。
 *
 * 顺序：
 * 1. 显式 `baseUrl` / `port`；
 * 2. 同源发现路由（由 vite 中间件提供，读 Rust 侧写的描述文件）；
 * 3. 兜底探测默认端口。
 *
 * 三条路都失败时返回 `null`——通常意味着桌面应用还没启动。
 */
export async function discoverBridge(
  options: DiscoveryOptions = {},
): Promise<BridgeDescriptor | null> {
  if (options.baseUrl) {
    return {
      port: options.port ?? parsePortFromUrl(options.baseUrl) ?? 0,
      pid: 0,
      url: options.baseUrl,
    }
  }

  const fetchImpl = resolveFetch(options.fetchImpl)

  if (options.port) {
    const probed = await probePort(options.port, fetchImpl)
    if (probed) return probed
  }

  const route = options.discoveryRoute ?? DISCOVERY_ROUTE
  try {
    const response = await fetchImpl(route, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (response.ok) {
      const body = (await response.json()) as unknown
      if (isDescriptor(body)) {
        // 描述文件可能是上一次运行留下的陈旧数据，因此再探活一次。
        const probed = await probePort(body.port, fetchImpl)
        if (probed) return { ...probed, pid: body.pid || probed.pid }
      }
    }
  } catch {
    // 未注册 vite 中间件时会走到这里，继续走兜底探测。
  }

  const fallbackPort = options.fallbackPort ?? DEFAULT_BRIDGE_PORT
  return probePort(fallbackPort, fetchImpl)
}

/**
 * 轮询等待桥就绪。
 *
 * 桌面应用的启动通常晚于 vite dev server（页面先能打开），因此前端首次调用
 * 后端命令时桥可能还没起来——这里做有限次退避重试。
 */
export async function waitForBridge(
  options: DiscoveryOptions & { timeoutMs?: number; intervalMs?: number } = {},
): Promise<BridgeDescriptor | null> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const intervalMs = options.intervalMs ?? 300
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const descriptor = await discoverBridge(options)
    if (descriptor) return descriptor
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** 从 URL 里解析端口。 */
function parsePortFromUrl(url: string): number | null {
  try {
    const parsed = new URL(url)
    const port = Number.parseInt(parsed.port, 10)
    return Number.isFinite(port) ? port : null
  } catch {
    return null
  }
}
