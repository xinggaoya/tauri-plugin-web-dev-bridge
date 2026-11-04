//! 只监听 `127.0.0.1` 的极简 HTTP 服务。
//!
//! 路由：
//! - `GET  /health` → 桥的基本信息（端口、pid）
//! - `POST /invoke` → `{ cmd, args, clientId }` → 真实命令执行结果
//! - `GET  /events?client=<id>` → SSE 事件流
//!
//! 之所以自己手写 HTTP 而不引入 web 框架：这个服务只在本机 dev 场景使用，
//! 协议面极小（三个路由 + CORS 预检），少一个依赖就少一份升级与审计负担。

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use tokio::time::{self, Duration};

use crate::dispatch::{self, BridgeContext};
use crate::{BridgeConfig, DESCRIPTOR_FILE_NAME};

/// 请求体上限，防止浏览器把超大 payload 塞进本机服务。
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

/// 请求头上限。
const MAX_HEADER_BYTES: usize = 64 * 1024;

/// SSE 心跳间隔，避免中间代理把空闲连接掐掉。
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

/// SSE 辅助通道的轮询间隔。
const SSE_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// `/invoke` 的请求体。
#[derive(Debug, Deserialize)]
struct InvokePayload {
    /// 要执行的 Tauri 命令名。
    cmd: String,
    /// 命令参数。
    #[serde(default)]
    args: Value,
    /// 客户端标识（浏览器标签页）。事件订阅按它隔离。
    #[serde(default)]
    client_id: Option<String>,
}

/// 描述文件内容。浏览器侧（经 vite 中间件）读取它以发现端口。
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Descriptor {
    pub(crate) port: u16,
    pub(crate) pid: u32,
    pub(crate) url: String,
}

/// 解析后的 HTTP 请求。
struct HttpRequest {
    method: String,
    path: String,
    query: String,
    body: Vec<u8>,
}

/// 启动桥服务。持续运行，直到进程退出。
pub(crate) async fn run(config: BridgeConfig, context: BridgeContext) -> Result<(), String> {
    let listener = bind_listener(config.port).await?;
    let local = listener
        .local_addr()
        .map_err(|error| format!("读取本地地址失败: {error}"))?;

    write_descriptor(&config, local.port())?;

    tracing::info!(
        "[web-dev-bridge] 已启动 → http://{local}（POST /invoke、GET /events、GET /health）"
    );

    loop {
        let (stream, _peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(error) => {
                tracing::warn!("[web-dev-bridge] 接受连接失败: {error}");
                time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };

        let config = config.clone();
        let context = context.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_connection(stream, config, context).await {
                tracing::debug!("[web-dev-bridge] 连接处理结束: {error}");
            }
        });
    }
}

/// 绑定监听套接字。
///
/// 优先使用配置的端口；端口被占用时退化为系统随机端口，
/// 此时前端只能通过描述文件发现（描述文件里写的是实际端口）。
async fn bind_listener(port: u16) -> Result<TcpListener, String> {
    let preferred = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    match TcpListener::bind(preferred).await {
        Ok(listener) => Ok(listener),
        Err(error) if port != 0 => {
            tracing::warn!("[web-dev-bridge] 端口 {port} 不可用（{error}），改用随机端口");
            TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
                .await
                .map_err(|error| format!("绑定随机端口失败: {error}"))
        }
        Err(error) => Err(format!("绑定 {preferred} 失败: {error}")),
    }
}

/// 写描述文件，供浏览器侧发现端口。
fn write_descriptor(config: &BridgeConfig, port: u16) -> Result<(), String> {
    let path = descriptor_path(config);
    let descriptor = Descriptor {
        port,
        pid: std::process::id(),
        url: format!("http://127.0.0.1:{port}"),
    };
    let content = serde_json::to_vec_pretty(&descriptor)
        .map_err(|error| format!("序列化描述文件失败: {error}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("创建描述文件目录失败: {error}"))?;
    }
    std::fs::write(&path, content).map_err(|error| format!("写入描述文件失败: {error}"))?;
    tracing::info!("[web-dev-bridge] 描述文件: {}", path.display());
    Ok(())
}

/// 描述文件路径。
pub(crate) fn descriptor_path(config: &BridgeConfig) -> PathBuf {
    config
        .descriptor_path
        .clone()
        .unwrap_or_else(|| std::env::temp_dir().join(DESCRIPTOR_FILE_NAME))
}

/// 处理单个连接。
async fn handle_connection(
    mut stream: TcpStream,
    config: BridgeConfig,
    context: BridgeContext,
) -> Result<(), String> {
    let request = match read_request(&mut stream).await? {
        Some(request) => request,
        None => return Ok(()),
    };

    if request.method == "OPTIONS" {
        return write_preflight(&mut stream, &config).await;
    }

    let path = request
        .path
        .split('?')
        .next()
        .unwrap_or_default()
        .to_string();

    match (request.method.as_str(), path.as_str()) {
        ("GET", "/health") => {
            let body = json!({
                "ok": true,
                "pid": std::process::id(),
                "webview": context.webview_label,
            });
            write_json(&mut stream, 200, &body, &config).await
        }
        ("GET", "/events") => {
            let client_id =
                query_param(&request.query, "client").unwrap_or_else(|| "default".to_string());
            let since = query_param(&request.query, "since")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            let (events, cursor) = context.events.poll(&client_id, since);
            let body = json!({
                "ok": true,
                "cursor": cursor,
                "events": events,
            });
            write_json(&mut stream, 200, &body, &config).await
        }
        ("GET", "/events/stream") => {
            let client_id =
                query_param(&request.query, "client").unwrap_or_else(|| "default".to_string());
            stream_events(stream, config, context, client_id).await
        }
        ("POST", "/invoke") => {
            let payload: InvokePayload = match serde_json::from_slice(&request.body) {
                Ok(payload) => payload,
                Err(error) => {
                    let body =
                        json!({ "ok": false, "error": format!("请求体不是合法 JSON: {error}") });
                    return write_json(&mut stream, 400, &body, &config).await;
                }
            };
            let client_id = payload.client_id.unwrap_or_else(|| "default".to_string());
            let result = dispatch::invoke(&context, &payload.cmd, payload.args, &client_id).await;
            let body = match result {
                Ok(value) => json!({ "ok": true, "data": value }),
                Err(error) => json!({ "ok": false, "error": error }),
            };
            write_json(&mut stream, 200, &body, &config).await
        }
        _ => {
            let body = json!({ "ok": false, "error": format!("未知路由: {}", request.path) });
            write_json(&mut stream, 404, &body, &config).await
        }
    }
}

/// 读取并解析一个 HTTP 请求。
async fn read_request(stream: &mut TcpStream) -> Result<Option<HttpRequest>, String> {
    let mut buffer: Vec<u8> = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];

    let header_end = loop {
        if let Some(position) = find_subslice(&buffer, b"\r\n\r\n") {
            break position;
        }
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| format!("读取请求失败: {error}"))?;
        if read == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("请求头过大".to_string());
        }
    };

    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_ascii_uppercase();
    let target = parts.next().unwrap_or_default().to_string();
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path.to_string(), query.to_string()),
        None => (target, String::new()),
    };

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length: usize = headers
        .get("content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err("请求体过大".to_string());
    }

    let mut body = buffer[header_end + 4..].to_vec();
    while body.len() < content_length {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| format!("读取请求体失败: {error}"))?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(Some(HttpRequest {
        method,
        path,
        query,
        body,
    }))
}

/// 从查询串里取参数。
fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        if name == key {
            Some(percent_decode(value))
        } else {
            None
        }
    })
}

/// 极简百分号解码（只处理 `%XX`，其余原样保留）。
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(byte) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 在字节串中查找子串位置。
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// 写一个完整的 HTTP 响应。
async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
    config: &BridgeConfig,
) -> Result<(), String> {
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {length}\r\n\
         Access-Control-Allow-Origin: {origin}\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Connection: close\r\n\r\n",
        reason = status_reason(status),
        length = body.len(),
        origin = config.allow_origin,
    );
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|error| format!("写响应头失败: {error}"))?;
    stream
        .write_all(body.as_bytes())
        .await
        .map_err(|error| format!("写响应体失败: {error}"))?;
    stream
        .flush()
        .await
        .map_err(|error| format!("刷新响应失败: {error}"))
}

/// 写 CORS 预检响应。
///
/// 必须带 `Access-Control-Max-Age`：否则浏览器会把预检结果当作不可缓存，
/// 导致**每一次** IPC 调用都先发一次 OPTIONS（实测 55 次 invoke → 55 次预检）。
async fn write_preflight(stream: &mut TcpStream, config: &BridgeConfig) -> Result<(), String> {
    let head = format!(
        "HTTP/1.1 204 No Content\r\n\
         Access-Control-Allow-Origin: {origin}\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Access-Control-Max-Age: 86400\r\n\
         Content-Length: 0\r\n\
         Connection: close\r\n\r\n",
        origin = config.allow_origin,
    );
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|error| format!("写预检响应失败: {error}"))?;
    stream
        .flush()
        .await
        .map_err(|error| format!("刷新预检响应失败: {error}"))
}

/// 写一个 JSON 响应。
async fn write_json(
    stream: &mut TcpStream,
    status: u16,
    payload: &Value,
    config: &BridgeConfig,
) -> Result<(), String> {
    let body = serde_json::to_string(payload).unwrap_or_else(|_| "{\"ok\":false}".to_string());
    write_response(
        stream,
        status,
        "application/json; charset=utf-8",
        &body,
        config,
    )
    .await
}

/// HTTP 状态码 → 原因短语。
fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Unknown",
    }
}

/// 维持一条 SSE 连接，把应用事件实时推给浏览器。
///
/// 这是**辅助**通道，主要给 `curl -N` 这类命令行调试用；
/// 浏览器侧走的是短轮询（`GET /events`），否则长连接会让自动化工具的
/// *networkidle* 判定永远无法达成。
///
/// 事件统一走默认的 `message` 通道（不在 SSE 层声明 `event:` 字段），
/// 事件名放在 JSON 负载里——这样前端只需挂一个 `onmessage` 即可接收全部事件。
async fn stream_events(
    mut stream: TcpStream,
    config: BridgeConfig,
    context: BridgeContext,
    client_id: String,
) -> Result<(), String> {
    let head = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: text/event-stream; charset=utf-8\r\n\
         Cache-Control: no-cache, no-transform\r\n\
         Connection: keep-alive\r\n\
         Transfer-Encoding: chunked\r\n\
         Access-Control-Allow-Origin: {origin}\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\r\n",
        origin = config.allow_origin,
    );
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|error| format!("写 SSE 响应头失败: {error}"))?;
    stream
        .flush()
        .await
        .map_err(|error| format!("刷新 SSE 响应头失败: {error}"))?;

    let mut cursor = 0u64;
    let mut heartbeat = time::interval(HEARTBEAT_INTERVAL);

    loop {
        tokio::select! {
            _ = time::sleep(SSE_POLL_INTERVAL) => {
                let (events, next_cursor) = context.events.poll(&client_id, cursor);
                cursor = next_cursor;
                for event in events {
                    let data = format!(
                        "data: {{\"event\":\"{name}\",\"payload\":{payload}}}\n\n",
                        name = event.event,
                        payload = event.payload
                    );
                    write_chunk(&mut stream, data.as_bytes()).await?;
                }
            }
            _ = heartbeat.tick() => {
                // 注释帧：EventSource 会忽略，但能保持连接活跃。
                write_chunk(&mut stream, b": ping\n\n").await?;
            }
        }
    }
}

/// 以 chunked 编码写一块数据。
async fn write_chunk(stream: &mut TcpStream, data: &[u8]) -> Result<(), String> {
    if data.is_empty() {
        return Ok(());
    }
    let header = format!("{:x}\r\n", data.len());
    stream
        .write_all(header.as_bytes())
        .await
        .map_err(|error| format!("写 chunk 头失败: {error}"))?;
    stream
        .write_all(data)
        .await
        .map_err(|error| format!("写 chunk 失败: {error}"))?;
    stream
        .write_all(b"\r\n")
        .await
        .map_err(|error| format!("写 chunk 结尾失败: {error}"))?;
    stream
        .flush()
        .await
        .map_err(|error| format!("刷新 chunk 失败: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{find_subslice, percent_decode, query_param};

    #[test]
    fn extracts_query_parameters() {
        assert_eq!(query_param("client=abc", "client").as_deref(), Some("abc"));
        assert_eq!(
            query_param("a=1&client=abc&b=2", "client").as_deref(),
            Some("abc")
        );
        assert_eq!(query_param("a=1", "client"), None);
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("abc"), "abc");
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn finds_subslice_position() {
        assert_eq!(find_subslice(b"hello\r\n\r\nworld", b"\r\n\r\n"), Some(5));
        assert_eq!(find_subslice(b"hello", b"\r\n\r\n"), None);
        assert_eq!(find_subslice(b"ab", b""), None);
    }
}
