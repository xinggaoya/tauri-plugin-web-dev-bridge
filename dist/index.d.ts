import { discoverBridge, waitForBridge } from './discovery';
import type { BridgeDescriptor } from './types';
export type { BridgeDescriptor, BridgeEvent, ClientId, InvokeOptions, TauriInternals, } from './types';
export { getClientId } from './discovery';
/** 安装参数。 */
export interface InstallWebDevBridgeOptions {
    /** 显式指定桥的基地址。 */
    baseUrl?: string;
    /** 显式指定桥的端口。 */
    port?: number;
    /** 承载 IPC 的窗口标签，默认 `main`。 */
    windowLabel?: string;
    /** 是否订阅事件流，默认 `true`。 */
    events?: boolean;
    /** 事件轮询间隔（毫秒），默认 1000。 */
    eventPollIntervalMs?: number;
    /** 同源发现路由，默认 `/__tauri_dev_bridge__/info`。 */
    discoveryRoute?: string;
    /** 兜底探测端口，默认 6222。 */
    fallbackPort?: number;
    /** 等待桥就绪的最长时间（毫秒），默认 15000。 */
    timeoutMs?: number;
    /** 注入的 fetch 实现（测试用）。 */
    fetchImpl?: typeof fetch;
}
/** 安装结果句柄。 */
export interface WebDevBridgeHandle {
    /** 是否真的安装了 shim。在 Tauri 环境下为 `false`（未做任何改动）。 */
    readonly installed: boolean;
    /** 当前浏览器标签页的客户端标识。 */
    readonly clientId: string;
    /** 等待桥就绪，返回桥的描述信息。 */
    ready(): Promise<BridgeDescriptor | null>;
    /** 拆除 shim（主要用于测试）。 */
    dispose(): void;
}
/** 是否运行在 Tauri 环境里。 */
export declare function isTauriRuntime(): boolean;
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
export declare function installWebDevBridge(options?: InstallWebDevBridgeOptions): WebDevBridgeHandle;
export { discoverBridge, waitForBridge };
//# sourceMappingURL=index.d.ts.map