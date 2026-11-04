//! 把浏览器发来的 `{ cmd, args }` 还原成一条**真正的** Tauri IPC 消息，
//! 投喂给运行中应用自己的命令处理器。
//!
//! 关键点在于 [`tauri::webview::Webview::on_message`] 是公开 API，且
//! [`tauri::App::invoke_key`] 也是公开的——Tauri 官方注释里明确写了后者就是
//! "构造 `InvokeRequest` 时必须引用的 key"。因此可以在应用进程内部合成一条
//! 与 WebView 完全等价的 IPC 消息，让它走**同一套**命令分发、ACL 与错误处理。

use std::time::Duration;

use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Manager, Wry};
use url::Url;

use crate::events::EventRegistry;

/// 事件插件的 listen 命令。浏览器侧的 shim 会把事件订阅转发到这里，
/// 由桥代为在 Rust 侧注册监听，再经 SSE 推回浏览器。
const EVENT_LISTEN_CMD: &str = "plugin:event|listen";
/// 事件插件的 unlisten 命令。
const EVENT_UNLISTEN_CMD: &str = "plugin:event|unlisten";

/// 桥的运行时上下文。可克隆（内部全部是 `Arc` / 克隆句柄）。
#[derive(Clone)]
pub(crate) struct BridgeContext {
    /// 应用句柄，用于取 webview、注册事件监听。
    pub(crate) app: AppHandle<Wry>,
    /// 合成 IPC 消息必须携带的 invoke key。
    pub(crate) invoke_key: String,
    /// 承载 IPC 的 webview 标签。
    pub(crate) webview_label: String,
    /// 单次调用超时。
    pub(crate) timeout: Duration,
    /// 事件注册表。
    pub(crate) events: EventRegistry,
}

/// 事件名白名单校验。
///
/// [`tauri::Listener::listen`] 在事件名非法时**直接 panic**。
/// 事件名来自浏览器（不可信输入），必须先校验，否则一个畸形请求就能带崩应用。
fn is_valid_event_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '/' | ':' | '_'))
}

/// 执行一次来自浏览器的调用。
///
/// 返回 `Ok(value)` 表示命令成功，`Err(value)` 表示命令失败（与 Tauri IPC 的
/// 成功/失败语义一一对应）。
pub(crate) async fn invoke(
    context: &BridgeContext,
    cmd: &str,
    args: Value,
    client_id: &str,
) -> Result<Value, Value> {
    match cmd {
        EVENT_LISTEN_CMD => {
            let name = args
                .get("event")
                .and_then(Value::as_str)
                .ok_or_else(|| Value::String("缺少 event 字段".to_string()))?;
            if !is_valid_event_name(name) {
                return Err(Value::String(format!("非法事件名: {name}")));
            }
            Ok(Value::from(context.events.listen(client_id, name)))
        }
        EVENT_UNLISTEN_CMD => {
            if let Some(event_id) = args.get("eventId").and_then(Value::as_u64) {
                context.events.unlisten(client_id, event_id as u32);
            }
            Ok(Value::Null)
        }
        _ => dispatch_ipc(context, cmd, args).await,
    }
}

/// 合成一条 IPC 消息并投喂给应用自身的命令处理器。
async fn dispatch_ipc(context: &BridgeContext, cmd: &str, args: Value) -> Result<Value, Value> {
    let webview = context
        .app
        .get_webview_window(&context.webview_label)
        .map(|window| window.as_ref().clone())
        .ok_or_else(|| {
            Value::String(format!(
                "webview `{}` 不可用：应用可能尚未创建窗口",
                context.webview_label
            ))
        })?;

    // 必须使用 webview 自身的 URL：Tauri 会用它判断请求是否为"本地来源"，
    // 而本地来源是自定义命令通过 ACL 检查的前提条件。
    let url = webview
        .url()
        .unwrap_or_else(|_| Url::parse("tauri://localhost").expect("常量 URL 必然可解析"));

    let (sender, receiver) = tokio::sync::oneshot::channel();
    let request = InvokeRequest {
        cmd: cmd.to_string(),
        callback: CallbackFn(1),
        error: CallbackFn(2),
        url,
        body: InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: context.invoke_key.clone(),
    };

    webview.on_message(
        request,
        Box::new(move |_webview, _cmd, response, _callback, _error| {
            let _ = sender.send(response);
        }),
    );

    match tokio::time::timeout(context.timeout, receiver).await {
        Ok(Ok(InvokeResponse::Ok(body))) => Ok(response_body_to_value(body)),
        Ok(Ok(InvokeResponse::Err(error))) => Err(error.0),
        Ok(Err(_)) => Err(Value::String("IPC 响应通道已关闭".to_string())),
        Err(_) => Err(Value::String(format!("命令 `{cmd}` 执行超时"))),
    }
}

/// IPC 响应体 → JSON 值。
fn response_body_to_value(body: InvokeResponseBody) -> Value {
    match body {
        InvokeResponseBody::Json(text) => serde_json::from_str(&text).unwrap_or(Value::Null),
        InvokeResponseBody::Raw(bytes) => {
            Value::String(String::from_utf8_lossy(&bytes).to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_valid_event_name, response_body_to_value};
    use tauri::ipc::InvokeResponseBody;

    #[test]
    fn accepts_tauri_style_event_names() {
        assert!(is_valid_event_name("traffic-data"));
        assert!(is_valid_event_name("kernel_status_changed"));
        assert!(is_valid_event_name("ns:event/path"));
    }

    #[test]
    fn rejects_event_names_that_would_panic_tauri() {
        // `tauri::Listener::listen` 对非法事件名直接 panic，必须提前拦下。
        assert!(!is_valid_event_name(""));
        assert!(!is_valid_event_name("bad name"));
        assert!(!is_valid_event_name("bad;name"));
        assert!(!is_valid_event_name("中文"));
    }

    #[test]
    fn parses_json_response_body() {
        let body = InvokeResponseBody::Json("{\"ok\":true}".to_string());
        assert_eq!(
            response_body_to_value(body),
            serde_json::json!({ "ok": true })
        );
    }

    #[test]
    fn falls_back_to_null_for_invalid_json_body() {
        let body = InvokeResponseBody::Json("not json".to_string());
        assert!(response_body_to_value(body).is_null());
    }
}
