/**
 * 桥的常量。Rust 侧与前端必须保持一致。
 */
/**
 * 描述文件名（位于系统临时目录）。
 *
 * Rust 侧启动后写入 `{ port, pid, url }`，浏览器侧经 vite 中间件读取，
 * 从而在 Rust 侧使用随机端口时也能**零配置**发现桥。
 */
export declare const BRIDGE_DESCRIPTOR_FILE = "tauri-web-dev-bridge.json";
/**
 * 兜底探测端口。
 *
 * Rust 侧默认优先尝试绑定此端口；端口被占用时自动退化为系统随机端口，
 * 此时只能通过描述文件发现。
 */
export declare const DEFAULT_BRIDGE_PORT = 6222;
/** 同源发现路由（由 `webDevBridgeVitePlugin()` 提供）。 */
export declare const DISCOVERY_ROUTE = "/__tauri_dev_bridge__/info";
/** 客户端标识在 sessionStorage 中的键。 */
export declare const CLIENT_ID_STORAGE_KEY = "__tauri_web_dev_bridge_client_id__";
//# sourceMappingURL=constants.d.ts.map