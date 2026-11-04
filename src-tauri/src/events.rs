//! 事件注册表：把应用 `emit` 出来的事件转发给浏览器。
//!
//! 浏览器的 `listen()` 会被 shim 转成 `plugin:event|listen` 调用，桥在这里用
//! [`tauri::Listener`] 在 **Rust 侧**注册真实监听；事件触发时进入该客户端的**队列**。
//!
//! ## 为什么按客户端隔离
//!
//! 每个浏览器标签页（含自动化测试里的多个上下文）是一个独立的 *client*，
//! 各自持有一组 Rust 监听器与一条事件队列。
//! 如果所有客户端共用一条队列，一个事件会被推送 N 次（N = 监听者数量），
//! 浏览器侧就会收到重复事件。
//!
//! ## 为什么用「队列 + 游标」而不是长连接
//!
//! 浏览器自动化工具（Playwright / CDP 生态）普遍用 *networkidle* 判定页面就绪，
//! 而 **SSE / WebSocket 这类长连接会让 networkidle 永远无法达成**——
//! `agent-browser open` 之类的命令会一直挂起。
//!
//! 因此事件通道采用**短轮询**：客户端带游标来取，取完立即返回，
//! 两次轮询之间存在空闲窗口，networkidle 可以正常达成。

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Event, Listener, Wry};

/// 单个客户端的事件队列容量。超出时丢弃最旧的。
const QUEUE_CAPACITY: usize = 1024;

/// 一条待转发的事件。
#[derive(Debug, Clone, Serialize)]
pub(crate) struct BridgeEvent {
    /// 队列中的序号（客户端用游标来去重）。
    pub(crate) seq: u64,
    /// 事件名。
    pub(crate) event: String,
    /// 事件负载（已是 JSON 值，浏览器侧直接拿到对象而非字符串）。
    pub(crate) payload: serde_json::Value,
}

/// 单个客户端的订阅状态。
struct ClientEvents {
    /// 待投递的事件队列。
    queue: VecDeque<BridgeEvent>,
    /// 已分配的最大序号。
    cursor: u64,
    /// 事件名 → Rust 侧监听 id。
    listeners: HashMap<String, u32>,
}

/// 事件注册表。
#[derive(Clone)]
pub(crate) struct EventRegistry {
    app: AppHandle<Wry>,
    clients: Arc<Mutex<HashMap<String, ClientEvents>>>,
}

impl EventRegistry {
    /// 创建注册表。
    pub(crate) fn new(app: AppHandle<Wry>) -> Self {
        Self {
            app,
            clients: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 取出某个客户端自 `since` 之后的事件，并把游标推进到当前末尾。
    ///
    /// 返回 `(事件列表, 新游标)`。
    pub(crate) fn poll(&self, client_id: &str, since: u64) -> (Vec<BridgeEvent>, u64) {
        let mut clients = self.clients.lock().expect("客户端表锁中毒");
        let client = clients
            .entry(client_id.to_string())
            .or_insert_with(|| ClientEvents {
                queue: VecDeque::new(),
                cursor: 0,
                listeners: HashMap::new(),
            });

        let events: Vec<BridgeEvent> = client
            .queue
            .iter()
            .filter(|event| event.seq > since)
            .cloned()
            .collect();

        // 清理已投递的事件，避免队列无限增长。
        while let Some(front) = client.queue.front() {
            if front.seq > since {
                break;
            }
            client.queue.pop_front();
        }

        (events, client.cursor)
    }

    /// 为某个客户端注册一个事件监听，返回 `eventId`。
    ///
    /// 同一客户端重复监听同一事件名时复用同一个 Rust 监听器，
    /// 并为每次订阅单独返回一个 `eventId`（浏览器侧用它做精确退订）。
    ///
    /// 调用方必须先校验事件名合法性——[`tauri::Listener::listen`] 在非法事件名上会 panic。
    pub(crate) fn listen(&self, client_id: &str, name: &str) -> u32 {
        let mut clients = self.clients.lock().expect("客户端表锁中毒");
        let client = clients
            .entry(client_id.to_string())
            .or_insert_with(|| ClientEvents {
                queue: VecDeque::new(),
                cursor: 0,
                listeners: HashMap::new(),
            });

        if let Some(existing) = client.listeners.get(name) {
            return *existing;
        }

        let event_name = name.to_string();
        let clients_for_listener = Arc::clone(&self.clients);
        let owner = client_id.to_string();
        let event_id = self.app.listen(name, move |event: Event| {
            let payload = serde_json::from_str::<serde_json::Value>(event.payload())
                .unwrap_or(serde_json::Value::Null);
            let mut clients = clients_for_listener.lock().expect("客户端表锁中毒");
            let Some(client) = clients.get_mut(&owner) else {
                return;
            };
            client.cursor += 1;
            let seq = client.cursor;
            client.queue.push_back(BridgeEvent {
                seq,
                event: event_name.clone(),
                payload,
            });
            while client.queue.len() > QUEUE_CAPACITY {
                client.queue.pop_front();
            }
        });

        client.listeners.insert(name.to_string(), event_id);
        event_id
    }

    /// 取消某个客户端的监听。
    pub(crate) fn unlisten(&self, client_id: &str, event_id: u32) {
        let mut clients = self.clients.lock().expect("客户端表锁中毒");
        let Some(client) = clients.get_mut(client_id) else {
            return;
        };

        let target = client
            .listeners
            .iter()
            .find(|(_, id)| **id == event_id)
            .map(|(name, _)| name.clone());

        let Some(name) = target else {
            return;
        };
        client.listeners.remove(&name);
        drop(clients);
        self.app.unlisten(event_id);
    }
}
