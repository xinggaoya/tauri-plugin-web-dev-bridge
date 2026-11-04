/**
 * 浏览器调试桥的公共类型。
 *
 * 这一层刻意不依赖 `@tauri-apps/api`——浏览器侧运行的是**替代**品，
 * 而不是官方 API 的再包装。
 */
/** 桥的描述信息。由 Rust 侧写入临时目录的描述文件，vite 中间件转发给浏览器。 */
export interface BridgeDescriptor {
    /** 桥监听的端口。 */
    port: number;
    /** 宿主应用进程号。 */
    pid: number;
    /** 桥的基地址，形如 `http://127.0.0.1:6222`。 */
    url: string;
}
/** 浏览器侧的客户端标识：用于把事件订阅按标签页隔离。 */
export type ClientId = string;
/** Tauri IPC 的回调签名。 */
export type TauriCallback = (payload: unknown) => void;
/** `/invoke` 的响应信封。 */
export interface InvokeEnvelope<T = unknown> {
    /** 命令是否执行成功。 */
    ok: boolean;
    /** 成功时的返回值。 */
    data?: T;
    /** 失败时的错误负载（与 Tauri IPC 的 reject 值同构）。 */
    error?: unknown;
}
/** 桥推送的事件。 */
export interface BridgeEvent {
    /** 事件名。 */
    event: string;
    /** 事件负载。 */
    payload: unknown;
}
/** `window.__TAURI_INTERNALS__.invoke` 的第三个参数。 */
export interface InvokeOptions {
    headers?: Record<string, string>;
}
/** `window.__TAURI_INTERNALS__` 的最小实现面。 */
export interface TauriInternals {
    invoke(cmd: string, args?: Record<string, unknown>, options?: InvokeOptions): Promise<unknown>;
    transformCallback(callback: TauriCallback, once?: boolean): number;
    unregisterCallback(id: number): void;
    runCallback(id: number, data?: unknown): void;
    convertFileSrc(filePath: string, protocol?: string): string;
    metadata: {
        currentWindow: {
            label: string;
        };
    };
    callbacks: Map<number, TauriCallback>;
}
//# sourceMappingURL=types.d.ts.map