/** 最小化的 vite dev server 形态（避免把 vite 变成硬依赖）。 */
interface ViteDevServerLike {
    middlewares: {
        use(route: string, handler: (req: unknown, res: ViteResponseLike, next: (error?: unknown) => void) => void): void;
    };
}
/** 最小化的 vite 响应对象形态。 */
interface ViteResponseLike {
    setHeader(name: string, value: string): void;
    statusCode?: number;
    end(chunk?: string): void;
}
/** 最小化的 vite 插件形态。 */
export interface VitePluginLike {
    name: string;
    apply?: 'serve' | 'build';
    configureServer(server: ViteDevServerLike): void;
}
/** 插件参数。 */
export interface WebDevBridgeVitePluginOptions {
    /** 描述文件路径，默认 `<系统临时目录>/tauri-web-dev-bridge.json`。 */
    descriptorPath?: string;
    /** 发现路由，默认 `/__tauri_dev_bridge__/info`。 */
    route?: string;
}
/**
 * 读取 Rust 侧写下的描述文件。
 *
 * 描述文件在应用启动时写入，包含实际监听端口（可能是系统随机分配的）。
 */
export declare function readBridgeDescriptor(descriptorPath?: string): {
    port: number;
    pid: number;
    url: string;
} | null;
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
export declare function webDevBridgeVitePlugin(options?: WebDevBridgeVitePluginOptions): VitePluginLike;
export {};
//# sourceMappingURL=vite.d.ts.map