import type { BridgeDescriptor, ClientId } from './types';
/** 端口发现的可调参数。 */
export interface DiscoveryOptions {
    /** 显式指定桥的基地址（例如 `http://127.0.0.1:6222`）。 */
    baseUrl?: string;
    /** 显式指定桥的端口。 */
    port?: number;
    /** 同源发现路由，默认 `/__tauri_dev_bridge__/info`。 */
    discoveryRoute?: string;
    /** 兜底探测的端口，默认 6222。 */
    fallbackPort?: number;
    /** 注入的 fetch 实现（测试用）。 */
    fetchImpl?: typeof fetch;
}
/** 由端口拼出基地址。 */
export declare function buildBaseUrl(port: number): string;
/**
 * 读取浏览器侧客户端标识。
 *
 * 事件订阅在 Rust 侧按客户端隔离，因此每个标签页（含自动化测试的多个上下文）
 * 必须有稳定且互不相同的标识。放在 sessionStorage：同一标签页刷新后保持不变
 * （Rust 侧的监听器不用重建），不同标签页互不相同。
 */
export declare function getClientId(): ClientId;
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
export declare function discoverBridge(options?: DiscoveryOptions): Promise<BridgeDescriptor | null>;
/**
 * 轮询等待桥就绪。
 *
 * 桌面应用的启动通常晚于 vite dev server（页面先能打开），因此前端首次调用
 * 后端命令时桥可能还没起来——这里做有限次退避重试。
 */
export declare function waitForBridge(options?: DiscoveryOptions & {
    timeoutMs?: number;
    intervalMs?: number;
}): Promise<BridgeDescriptor | null>;
//# sourceMappingURL=discovery.d.ts.map