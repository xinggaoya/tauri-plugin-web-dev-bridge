# 架构与设计

本文说明 `tauri-plugin-web-dev-bridge` 的内部结构，以及若干**反直觉**设计背后的原因。
改代码前请先读这里，避免把刻意设计改回去。

## 组件

```
┌──────────────────────── 应用进程 ────────────────────────┐
│                                                          │
│  Tauri App                                               │
│    ├─ 业务命令处理器（generate_handler!）                │
│    ├─ 事件发射（app.emit）                               │
│    └─ Webview "main"                                     │
│         ▲                                                │
│         │ Webview::on_message(InvokeRequest)            │
│         │  ← 与真实 WebView 完全等价的 IPC 消息          │
│         │                                                │
│  ┌─────┴──────────────────────────────────────────┐      │
│  │  web-dev-bridge                               │      │
│  │   ├─ server.rs    HTTP 服务（/invoke /events） │      │
│  │   ├─ dispatch.rs  合成 InvokeRequest 并派发    │      │
│  │   └─ events.rs    事件注册表（按客户端隔离）   │      │
│  └────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────┘
         ▲
         │ HTTP（仅 127.0.0.1）
┌────────┴─────────┐
│  普通浏览器        │
│  __TAURI_INTERNALS__│  ← 被 shim 接管
└───────────────────┘
```

| 模块 | 职责 |
| --- | --- |
| `lib.rs` | `Builder` / `Plugin` / `start(app)`；对外 API |
| `server.rs` | 只监听 `127.0.0.1` 的极简 HTTP 服务；请求解析与响应 |
| `dispatch.rs` | 把 `{cmd, args}` 还原成 `InvokeRequest`，投喂给应用命令处理器 |
| `events.rs` | 事件注册表：Rust 侧监听 + 每客户端队列 + 游标 |
| `src/`（TS） | 浏览器侧 shim、传输层、端口发现、Vite 插件 |

## 关键决策

### 1. 为什么用 `Webview::on_message` 而不是自己实现命令分发

Tauri v2 把 `Webview::on_message` 与 `App::invoke_key` 都做成了公开 API，
并在文档里明确写了后者就是「构造 `InvokeRequest` 时必须引用的 key」。

走 `on_message` 意味着请求会经过应用**真实**的：

- 命令分发（`generate_handler!` 注册的处理器）；
- ACL 校验；
- 参数反序列化与错误转换。

因此**新增业务命令零改动**——插件不需要维护任何命令清单。
代价是必须依赖 `App<Wry>`（`invoke_key` 只在桌面运行时的 `App` 上公开），
所以启动动作必须放在应用自己的 `setup` 钩子里。

### 2. 为什么事件用「短轮询」而不是 SSE / WebSocket

浏览器自动化工具（Playwright / CDP 生态）用 *networkidle* 判定页面就绪。
SSE 与 WebSocket 都是**长连接**，会让 networkidle **永远无法达成**：

```
agent-browser open http://localhost:6221   →  挂起 > 300s
```

改成短轮询（默认 1s 一次，取完立即返回）之后，两次轮询之间存在空闲窗口：

```
agent-browser open http://localhost:6221   →  ~1.1s 完成
```

代价是事件延迟从「即时」变成「最多一个轮询间隔」。
对调试工具来说这个取舍是划算的——**能被自动化工具驱动**比省 1 秒更重要。

SSE 通道（`GET /events/stream`）仍然保留，但只作为命令行调试的辅助手段。

### 3. 为什么事件按「客户端」隔离

Rust 侧的事件监听器是**每个事件名一个**。如果所有浏览器标签页共用一条广播通道，
一个事件会被推送 N 次（N = 监听者数量），每个标签页都会收到重复事件。

因此每个客户端（标签页 / 自动化上下文）拥有：

- 自己的一组 Rust 监听器；
- 自己的事件队列；
- 自己的游标（`clientId` 由前端生成，存在 `sessionStorage`）。

### 4. 为什么用「队列 + 游标」而不是广播通道

队列 + 游标让「长连接推送」与「短轮询拉取」共用同一份状态：
SSE 通道只是把队列按固定间隔排空后写进连接，轮询接口则是立刻排空一次返回。
两者语义一致，不会出现「一条事件被两条通道重复投递」的歧义。

### 5. 端口发现为什么要写描述文件

Rust 侧优先监听 `6222`，但端口被占用时会退化为系统随机端口——
前端无法靠约定端口找到它。

解法是 Rust 侧把 `{ port, pid, url }` 写到 `<temp>/tauri-web-dev-bridge.json`，
Vite 插件以**同源 JSON** 暴露该文件。这样：

- 前端不需要约定端口；
- 同源请求没有跨域问题；
- 不依赖任何固定的探测端口。

前端的发现顺序是：显式 `baseUrl`/`port` → 同源发现路由 → 兜底探测 `6222`。

### 6. 为什么 CORS 预检要带 `Access-Control-Max-Age`

`POST /invoke` 带 `Content-Type: application/json`，属于非简单请求，会触发 CORS 预检。
若预检响应不含 `Access-Control-Max-Age`，浏览器会把预检结果当作**不可缓存**，
于是**每一次** IPC 调用都先发一次 `OPTIONS`（实测 55 次 invoke → 55 次预检）。

加上 `Access-Control-Max-Age: 86400` 后，预检只发生一次。

### 7. 为什么前端入口不能 re-export Vite 插件

`src/vite.ts` 依赖 `node:fs` / `node:os` / `node:path`。
浏览器端无法加载这些模块——Vite 会把它们外部化成
`/@id/__vite-browser-external:node:fs`，在模块**求值阶段**抛错。

一旦浏览器入口静态引用了它，整个 `main.ts` 模块图都会加载失败：
页面白屏，且控制台里**看不到任何业务日志**（错误发生在业务代码执行之前）。

`src/__tests__/browser-safety.test.ts` 会对这条约束做守护。

## 数据流：一次 `invoke` 的完整旅程

1. 浏览器调用 `@tauri-apps/api` 的 `invoke(cmd, args)`；
2. 它落到 `window.__TAURI_INTERNALS__.invoke(cmd, args)` —— 已被 shim 接管；
3. shim 判断是否为事件插件命令：
   - `plugin:event|listen` → 在浏览器内登记回调 → 向桥请求 `eventId`；
   - `plugin:event|unlisten` → 浏览器内摘除回调 → 通知桥；
   - 其他 → 直接转发；
4. 转发走 `POST /invoke`，body 为 `{ cmd, args, clientId }`；
5. 桥的 `dispatch.rs` 合成 `InvokeRequest`（带 `invoke_key` 与 webview 自身的 URL），
   交给 `Webview::on_message`；
6. Tauri 走真实的命令分发，返回 `InvokeResponse`；
7. 桥把它包成 `{ ok, data | error }` 返回；
8. shim 按官方语义 resolve / reject。

## 失败模式

| 失败 | 表现 | 兜底 |
| --- | --- | --- |
| 应用未启动 | 桥不存在 | 前端给出明确提示，而不是一堆 `undefined` 报错 |
| webview 尚未创建 | `webview \`main\` 不可用` | 稍后重试 |
| 事件名非法 | Tauri 的 `listen` 会 **panic** | 桥在注册前校验字符集，拦截畸形输入 |
| 命令超时 | 30s 后返回错误 | 不阻塞应用主线程 |
| 事件队列溢出 | 丢弃最旧的事件 | 队列上限 1024 |
