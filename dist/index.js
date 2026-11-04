import { discoverBridge, getClientId, waitForBridge } from './discovery';
import { createTauriInternals } from './internals';
import { BridgeTransport } from './transport';
export { getClientId } from './discovery';
/** 是否运行在 Tauri 环境里。 */
export function isTauriRuntime() {
    const scope = globalThis;
    return Boolean(scope.isTauri || scope.__TAURI_INTERNALS__);
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
export function installWebDevBridge(options = {}) {
    const scope = globalThis;
    if (isTauriRuntime()) {
        return {
            installed: false,
            clientId: getClientId(),
            ready: async () => null,
            dispose: () => undefined,
        };
    }
    const clientId = getClientId();
    let cached = null;
    let pending = null;
    const resolveDescriptor = async () => {
        if (cached)
            return cached;
        if (!pending) {
            pending = waitForBridge({
                baseUrl: options.baseUrl,
                port: options.port,
                discoveryRoute: options.discoveryRoute,
                fallbackPort: options.fallbackPort,
                timeoutMs: options.timeoutMs,
                fetchImpl: options.fetchImpl,
            }).then((descriptor) => {
                cached = descriptor;
                if (!descriptor) {
                    // 失败时清空进行中的 Promise，允许后续调用重试。
                    pending = null;
                }
                return descriptor;
            });
        }
        return pending;
    };
    const transport = new BridgeTransport(resolveDescriptor, options.fetchImpl);
    const bundle = createTauriInternals({
        transport,
        windowLabel: options.windowLabel ?? 'main',
    });
    scope.__TAURI_INTERNALS__ = bundle.internals;
    scope.__TAURI_EVENT_PLUGIN_INTERNALS__ = bundle.eventPluginInternals;
    let closeEventStream = null;
    if (options.events !== false) {
        closeEventStream = transport.startEventPolling((event) => bundle.dispatchEvent(event), options.eventPollIntervalMs);
    }
    const handle = {
        installed: true,
        clientId,
        ready: async () => {
            const descriptor = await resolveDescriptor();
            if (!descriptor && options.baseUrl) {
                return {
                    port: options.port ?? 0,
                    pid: 0,
                    url: options.baseUrl,
                };
            }
            return descriptor;
        },
        dispose: () => {
            closeEventStream?.();
            closeEventStream = null;
            delete scope.__TAURI_INTERNALS__;
            delete scope.__TAURI_EVENT_PLUGIN_INTERNALS__;
        },
    };
    scope.__TAURI_DEV_BRIDGE__ =
        handle;
    return handle;
}
export { discoverBridge, waitForBridge };
//# sourceMappingURL=index.js.map