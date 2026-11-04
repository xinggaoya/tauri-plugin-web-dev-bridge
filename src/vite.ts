import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BRIDGE_DESCRIPTOR_FILE, DISCOVERY_ROUTE } from './constants.ts'

/** 最小化的 vite dev server 形态（避免把 vite 变成硬依赖）。 */
interface ViteDevServerLike {
  middlewares: {
    use(
      route: string,
      handler: (req: unknown, res: ViteResponseLike, next: (error?: unknown) => void) => void,
    ): void
  }
}

/** 最小化的 vite 响应对象形态。 */
interface ViteResponseLike {
  setHeader(name: string, value: string): void
  statusCode?: number
  end(chunk?: string): void
}

/** 最小化的 vite 插件形态。 */
export interface VitePluginLike {
  name: string
  apply?: 'serve' | 'build'
  configureServer(server: ViteDevServerLike): void
}

/** 插件参数。 */
export interface WebDevBridgeVitePluginOptions {
  /** 描述文件路径，默认 `<系统临时目录>/tauri-web-dev-bridge.json`。 */
  descriptorPath?: string
  /** 发现路由，默认 `/__tauri_dev_bridge__/info`。 */
  route?: string
}

/**
 * 读取 Rust 侧写下的描述文件。
 *
 * 描述文件在应用启动时写入，包含实际监听端口（可能是系统随机分配的）。
 */
export function readBridgeDescriptor(descriptorPath?: string): {
  port: number
  pid: number
  url: string
} | null {
  const path = descriptorPath ?? join(tmpdir(), BRIDGE_DESCRIPTOR_FILE)
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as { port?: number; pid?: number; url?: string }
    if (typeof parsed.port !== 'number' || !Number.isFinite(parsed.port)) return null
    return {
      port: parsed.port,
      pid: typeof parsed.pid === 'number' ? parsed.pid : 0,
      url: typeof parsed.url === 'string' ? parsed.url : `http://127.0.0.1:${parsed.port}`,
    }
  } catch {
    // 应用还没启动，或描述文件不可读。
    return null
  }
}

/**
 * vite 插件：把桥的发现信息挂到 dev server 上。
 *
 * Rust 侧在**随机端口**上监听时，前端无法靠约定端口找到它；
 * 这个中间件读 Rust 写的描述文件并以同源 JSON 暴露出去，
 * 前端因此可以零配置发现桥——既不用约定端口，也没有跨域问题。
 *
 * ```ts
 * import { webDevBridgeVitePlugin } from 'tauri-plugin-web-dev-bridge/vite'
 *
 * export default defineConfig({
 *   plugins: [vue(), webDevBridgeVitePlugin()],
 * })
 * ```
 */
export function webDevBridgeVitePlugin(
  options: WebDevBridgeVitePluginOptions = {},
): VitePluginLike {
  const route = options.route ?? DISCOVERY_ROUTE
  const descriptorPath = options.descriptorPath

  return {
    name: 'tauri-plugin-web-dev-bridge:discovery',
    apply: 'serve',
    configureServer(server: ViteDevServerLike) {
      server.middlewares.use(route, (_req, res) => {
        const descriptor = readBridgeDescriptor(descriptorPath)
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(
          JSON.stringify(
            descriptor ?? {
              port: null,
              pid: null,
              url: null,
              hint: '桌面应用尚未启动：请运行 `pnpm tauri dev` 后刷新页面。',
            },
          ),
        )
      })
    },
  }
}
