const EVENT_LISTEN_CMD = 'plugin:event|listen';
const EVENT_UNLISTEN_CMD = 'plugin:event|unlisten';
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
export function createTauriInternals(options) {
    const { transport, windowLabel } = options;
    const callbacks = new Map();
    /** 事件名 → (eventId → 回调 id)。 */
    const eventListeners = new Map();
    let callbackId = 1;
    const transformCallback = (callback, once = false) => {
        const id = callbackId++;
        if (once) {
            callbacks.set(id, (payload) => {
                callbacks.delete(id);
                callback(payload);
            });
        }
        else {
            callbacks.set(id, callback);
        }
        return id;
    };
    const unregisterCallback = (id) => {
        callbacks.delete(id);
    };
    const runCallback = (id, data) => {
        const callback = callbacks.get(id);
        if (callback) {
            callback(data);
            return;
        }
        console.warn(`[web-dev-bridge] 找不到回调 id ${id}，该回调可能已被注销。`);
    };
    const registerEventListener = (event, eventId, handlerId) => {
        const bucket = eventListeners.get(event) ?? new Map();
        bucket.set(eventId, handlerId);
        eventListeners.set(event, bucket);
    };
    const unregisterEventListener = (event, eventId) => {
        const bucket = eventListeners.get(event);
        if (!bucket)
            return;
        bucket.delete(eventId);
        if (bucket.size === 0)
            eventListeners.delete(event);
    };
    const invoke = async (cmd, args = {}, _options) => {
        if (cmd === EVENT_LISTEN_CMD) {
            const event = String(args.event ?? '');
            const handlerId = Number(args.handler);
            const eventId = await transport.invoke(EVENT_LISTEN_CMD, { event });
            registerEventListener(event, eventId, handlerId);
            return eventId;
        }
        if (cmd === EVENT_UNLISTEN_CMD) {
            const event = String(args.event ?? '');
            const eventId = Number(args.eventId);
            unregisterEventListener(event, eventId);
            await transport.invoke(EVENT_UNLISTEN_CMD, { event, eventId });
            return null;
        }
        return transport.invoke(cmd, args);
    };
    const internals = {
        invoke,
        transformCallback,
        unregisterCallback,
        runCallback,
        // 浏览器无法加载 Tauri 的 asset:// 协议，原样返回路径。
        convertFileSrc: (filePath) => filePath,
        metadata: {
            currentWindow: {
                label: windowLabel,
            },
        },
        callbacks,
    };
    const eventPluginInternals = {
        unregisterListener: unregisterEventListener,
    };
    const dispatchEvent = (event) => {
        const bucket = eventListeners.get(event.event);
        if (!bucket || bucket.size === 0)
            return;
        for (const [eventId, handlerId] of Array.from(bucket.entries())) {
            runCallback(handlerId, { event: event.event, id: eventId, payload: event.payload });
        }
    };
    return { internals, eventPluginInternals, dispatchEvent };
}
//# sourceMappingURL=internals.js.map