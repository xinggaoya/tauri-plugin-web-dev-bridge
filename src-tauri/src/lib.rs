//! `tauri-plugin-web-dev-bridge`
//!
//! 让**普通浏览器**（不是 Tauri WebView）也能驱动一个**正在运行的** Tauri v2 应用，
//! 并且拿到的是**真实数据**——真实数据库、真实内核 gRPC 查询、真实事件流——
//! 而不是任何形式的前端 mock。
//!
//! ## 工作原理
//!
//! Tauri v2 的前端与后端之间只有一条通路：`window.__TAURI_INTERNALS__.invoke()`。
//! 在桌面端，这条通路最终落到 WebView 的 `ipc://` 自定义协议上，普通浏览器无法访问。
//!
//! 本插件在应用进程内开一个只监听 `127.0.0.1` 的 HTTP 服务，把浏览器的请求**还原成
//! 一条真正的 Tauri IPC 消息**，再通过 [`tauri::webview::Webview::on_message`] 投喂给
//! 应用自身的命令处理器：
//!
//! ```text
//! 浏览器  ──HTTP POST /invoke──▶  桥（127.0.0.1:port）
//!                                    │  合成 InvokeRequest
//!                                    ▼
//!                                 运行中的 Tauri App
//!                                    │  真实命令处理器 / 真实 gRPC / 真实 SQLite
//!                                    ▼
//! 浏览器  ◀──JSON 响应──────────  桥
//!
//! 浏览器  ◀──SSE /events────────  桥 ◀──Rust Listener◀──app.emit(...)
//! ```
//!
//! 因为走的是应用**自己的**命令处理器，浏览器里的每一次点击都等价于在桌面窗口里点击：
//! 切换节点会真的切换内核、写入配置会真的落库。
//!
//! ## 用法
//!
//! ```rust,ignore
//! tauri::Builder::default()
//!     .plugin(tauri_plugin_web_dev_bridge::Builder::new().build())
//!     .setup(|app| {
//!         // 桥需要 App<Wry> 才能取到 invoke_key（Tauri 仅在桌面运行时公开该 API），
//!         // 因此启动动作放在应用自己的 setup 钩子里——此时窗口/webview 已创建完毕。
//!         tauri_plugin_web_dev_bridge::start(app)?;
//!         Ok(())
//!     })
//!     .run(tauri::generate_context!())
//!     .expect("error while running tauri application");
//! ```
//!
//! 前端侧只需在挂载前安装一次 shim：
//!
//! ```ts
//! import { installWebDevBridge } from 'tauri-plugin-web-dev-bridge'
//! installWebDevBridge()
//! ```
//!
//! 在 Tauri 环境下 `installWebDevBridge()` 是**空操作**，不会影响桌面端行为。

mod dispatch;
mod events;
mod server;

use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value as JsonValue;
use tauri::plugin::Plugin;
use tauri::{App, AppHandle, Manager, Wry};

/// 描述文件名（写入系统临时目录）。
///
/// 浏览器侧需要知道桥监听在哪个端口。Rust 侧把 `{ port, pid, url }` 写进
/// `<temp_dir>/tauri-web-dev-bridge.json`，前端通过同源的 vite 中间件读取该文件，
/// 从而**零配置**发现端口（端口可以是系统随机分配的）。
pub const DESCRIPTOR_FILE_NAME: &str = "tauri-web-dev-bridge.json";

/// 默认监听端口。端口被占用时会自动退化为系统随机端口。
pub const DEFAULT_PORT: u16 = 6222;

/// 默认的单次 IPC 调用超时。
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// 桥的运行配置。
#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub(crate) port: u16,
    pub(crate) enabled: bool,
    pub(crate) allow_origin: String,
    pub(crate) descriptor_path: Option<PathBuf>,
    pub(crate) webview_label: String,
    pub(crate) timeout: Duration,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            port: DEFAULT_PORT,
            enabled: cfg!(debug_assertions),
            allow_origin: "*".to_string(),
            descriptor_path: None,
            webview_label: "main".to_string(),
            timeout: DEFAULT_TIMEOUT,
        }
    }
}

/// 由插件注册、供 [`start`] 读取的应用状态。
pub struct BridgeState {
    pub(crate) config: BridgeConfig,
    pub(crate) app: AppHandle<Wry>,
}

/// `tauri-plugin-web-dev-bridge` 的构建器。
#[derive(Debug, Clone, Default)]
pub struct Builder {
    config: BridgeConfig,
}

impl Builder {
    /// 创建默认配置的构建器。
    ///
    /// 默认行为：
    /// - 仅在 debug 构建（`cfg!(debug_assertions)`）下启用，release 构建自动跳过；
    /// - 监听 `127.0.0.1` 的随机端口；
    /// - 允许任意来源（服务仅本机可达的 dev 工具）；
    /// - 目标 webview 为 `main`。
    pub fn new() -> Self {
        Self::default()
    }

    /// 指定监听端口。`0` 表示由操作系统分配。
    pub fn port(mut self, port: u16) -> Self {
        self.config.port = port;
        self
    }

    /// 显式开关。默认在 release 构建下为关闭。
    pub fn enabled(mut self, enabled: bool) -> Self {
        self.config.enabled = enabled;
        self
    }

    /// 设置允许的跨域来源（`Access-Control-Allow-Origin`）。
    pub fn allow_origin(mut self, origin: impl Into<String>) -> Self {
        self.config.allow_origin = origin.into();
        self
    }

    /// 指定描述文件写入路径。默认写入系统临时目录。
    pub fn descriptor_path(mut self, path: PathBuf) -> Self {
        self.config.descriptor_path = Some(path);
        self
    }

    /// 指定用于承载 IPC 的 webview 标签。默认 `main`。
    pub fn webview_label(mut self, label: impl Into<String>) -> Self {
        self.config.webview_label = label.into();
        self
    }

    /// 设置单次 IPC 调用超时。
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.config.timeout = timeout;
        self
    }

    /// 生成插件实例。
    pub fn build(self) -> WebDevBridge {
        WebDevBridge {
            config: self.config,
        }
    }
}

/// 插件实例。
#[derive(Debug, Clone)]
pub struct WebDevBridge {
    config: BridgeConfig,
}

impl WebDevBridge {
    /// 当前配置。
    pub fn config(&self) -> &BridgeConfig {
        &self.config
    }
}

impl Plugin<Wry> for WebDevBridge {
    fn name(&self) -> &'static str {
        "web-dev-bridge"
    }

    /// 插件初始化阶段只登记配置与 AppHandle。
    ///
    /// 此时窗口/webview **尚未创建**（Tauri 先 `initialize_plugins`，再建窗口），
    /// 因此真正的启动推迟到应用自己的 `setup` 钩子——见 [`start`]。
    fn initialize(
        &mut self,
        app: &AppHandle<Wry>,
        _config: JsonValue,
    ) -> Result<(), Box<dyn std::error::Error>> {
        app.manage(BridgeState {
            config: self.config.clone(),
            app: app.clone(),
        });
        Ok(())
    }
}

/// 启动浏览器调试桥。
///
/// 需要在应用的 `setup` 钩子里调用：
///
/// ```rust,ignore
/// # fn main() {
/// tauri::Builder::default()
///     .plugin(tauri_plugin_web_dev_bridge::Builder::new().build())
///     .setup(|app| {
///         tauri_plugin_web_dev_bridge::start(app)?;
///         Ok(())
///     })
///     .run(tauri::generate_context!())
///     .expect("error while running tauri application");
/// # }
/// ```
///
/// 之所以放在这里而不是插件的 `initialize` 钩子里：
/// - `App<Wry>::invoke_key()` 是构造 IPC 消息的必备参数，而 Tauri 只在**桌面运行时**
///   的 `App` 上公开它（`AppHandle` 上没有）；
/// - 应用 `setup` 钩子执行时窗口与 webview 已创建完毕。
pub fn start(app: &mut App<Wry>) -> Result<(), Box<dyn std::error::Error>> {
    let (config, handle) = match app.try_state::<BridgeState>() {
        Some(state) => (state.config.clone(), state.app.clone()),
        None => {
            tracing::warn!(
                "[web-dev-bridge] 未检测到插件实例，使用默认配置启动（请确认已通过 .plugin(...) 注册）"
            );
            (BridgeConfig::default(), app.handle().clone())
        }
    };

    if !config.enabled {
        tracing::info!("[web-dev-bridge] 已禁用：浏览器无法直连真实后端");
        return Ok(());
    }

    let context = dispatch::BridgeContext {
        app: handle,
        // invoke_key 在 App 创建时生成一次并终身不变；
        // 合成 IPC 消息必须带上它，否则会被 Webview::on_message 直接丢弃。
        invoke_key: app.invoke_key().to_string(),
        webview_label: config.webview_label.clone(),
        timeout: config.timeout,
        events: events::EventRegistry::new(app.handle().clone()),
    };

    tauri::async_runtime::spawn(async move {
        if let Err(error) = server::run(config, context).await {
            tracing::error!("[web-dev-bridge] 启动失败: {error}");
        }
    });

    Ok(())
}
