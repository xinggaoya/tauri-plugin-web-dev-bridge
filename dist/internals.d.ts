import type { BridgeTransport } from './transport';
import type { BridgeEvent, TauriInternals } from './types';
/** 事件插件的内部对象（`window.__TAURI_EVENT_PLUGIN_INTERNALS__`）。 */
export interface EventPluginInternals {
    unregisterListener(event: string, eventId: number): void;
}
/** shim 的整体产物。 */
export interface TauriInternalsBundle {
    /** 注入 `window.__TAURI_INTERNALS__`。 */
    internals: TauriInternals;
    /** 注入 `window.__TAURI_EVENT_PLUGIN_INTERNALS__`。 */
    eventPluginInternals: EventPluginInternals;
    /** 把桥推送的事件分发给已注册的回调。 */
    dispatchEvent(event: BridgeEvent): void;
}
/** 创建 internals 所需的参数。 */
export interface CreateInternalsOptions {
    /** 与桥通信的传输层。 */
    transport: BridgeTransport;
    /** 承载 IPC 的窗口标签。 */
    windowLabel: string;
}
/**
 * 构造一份 `window.__TAURI_INTERNALS__` 的浏览器实现。
 *
 * 官方 `@tauri-apps/api` 的所有能力最终都收敛到这一个对象上
 * （`invoke` / `transformCallback` / `runCallback` / `convertFileSrc`），
 * 因此只要把它替换掉，**业务代码一行都不用改**就能在普通浏览器里跑起来。
 *
 * 事件插件命令（`plugin:event|listen` / `plugin:event|unlisten`）在这里**本地处理**：
 * 官方实现会把回调注册进真实 WebView 的 JS 侧，浏览器里没有那个上下文；
 * 这里改为在浏览器内维护回调表，事件负载则经 SSE 通道送达。
 */
export declare function createTauriInternals(options: CreateInternalsOptions): TauriInternalsBundle;
//# sourceMappingURL=internals.d.ts.map