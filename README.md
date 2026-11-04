<div align="center">

# tauri-plugin-web-dev-bridge

**让普通浏览器直连运行中的 Tauri v2 应用，拿到真实数据。**

[English](./README.en.md) · [文档](./docs) · [问题反馈](https://github.com/xinggaoya/tauri-plugin-web-dev-bridge/issues)

[![CI](https://github.com/xinggaoya/tauri-plugin-web-dev-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/xinggaoya/tauri-plugin-web-dev-bridge/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/tauri-plugin-web-dev-bridge.svg)](https://crates.io/crates/tauri-plugin-web-dev-bridge)
[![npm](https://img.shields.io/npm/v/tauri-plugin-web-dev-bridge.svg)](https://www.npmjs.com/package/tauri-plugin-web-dev-bridge)
[![License](https://img.shields.io/crates/l/tauri-plugin-web-dev-bridge.svg)](./LICENSE)

</div>

## 一句话

把前端页面丢进浏览器调试 Tauri 应用时，页面能打开，但每一个后端调用都会炸。
本插件在应用进程内架起一座**本地调试桥**，让浏览器能驱动**正在运行的**应用——
而且拿到的是**真实数据**（真实数据库、真实内核查询、真实事件流），不是任何形式的前端 mock。

## 它解决什么问题

Tauri 应用的端逻辑只能通过 `window.__TAURI_INTERNALS__.invoke()` 触达后端。
在桌面端，这条通路最终落到 WebView 的 `ipc://` 自定义协议上——**普通浏览器访问不到**。

于是把前端页面丢到浏览器里调试时：

```
TypeError: Cannot read properties of undefined (reading 'transformCallback')
TypeError: Cannot read properties of undefined (reading 'invoke')
```

页面一片空白，开发者只能反复「改代码 → 重新打包桌面端 → 点一下 → 看日志」，
调试一个 UI 问题要付出十分钟的构建等待。

本插件把这条通路**延伸**到普通浏览器：

```text
浏览器  ──HTTP POST /invoke──▶  桥（127.0.0.1:port）
                                   │  合成 InvokeRequest（带 invoke_key）
                                   ▼
                                运行中的 Tauri App
                                   │  真实命令处理器 / 真实 gRPC / 真实 SQLite
                                   ▼
浏览器  ◀──JSON 响应───────────  桥

浏览器  ◀──短轮询 /events─────  桥 ◀──Rust Listener◀──app.emit(...)
```

关键点：走的是应用**自己的**命令处理器，因此浏览器里的每一次点击都等价于在桌面窗口里点击——
切换节点会真的切换内核、写入配置会真的落库。

## 为什么能合成 IPC 消息

Tauri v2 把两个关键 API 做成了公开的：

| API | 作用 |
| --- | --- |
| [`tauri::webview::Webview::on_message`] | 公开方法，可以手工投递一条 IPC 请求 |
| [`tauri::App::invoke_key`] | 公开方法，官方注释写着 *"Gets the invoke key that must be referenced when using `crate::webview::InvokeRequest`"* |

桥据此构造一条与 WebView **完全等价**的 `InvokeRequest`，
让它走**同一套**命令分发、ACL 校验与错误处理逻辑。

## 特性

- **真实数据**：不是 mock，浏览器里看到的就是真实数据库 / 真实内核 gRPC 查询 / 真实事件流。
- **零业务改动**：只替换 `window.__TAURI_INTERNALS__`，`@tauri-apps/api` 原样工作。
- **Tauri 环境无感**：`installWebDevBridge()` 在桌面端是**空操作**，不改动任何全局状态。
- **AI 自动化友好**：事件用**短轮询**而非长连接，自动化工具的 *networkidle* 判定能正常达成
  （实测 `agent-browser open` 从挂起 >300s 降到约 1.1s）。
- **按标签页隔离**：每个浏览器上下文有独立的监听器与事件队列，多标签页互不串扰。
- **可 curl**：桥的 HTTP 接口是一等公民，命令行调试同样顺手。
- **dev-only**：release 构建自动跳过；HTTP 服务只监听 `127.0.0.1`。

## 安装

### Rust

```toml
[dependencies]
tauri-plugin-web-dev-bridge = "0.1"
```

<details>
<summary>从 Git 依赖（想用未发布版本时）</summary>

```toml
[dependencies]
tauri-plugin-web-dev-bridge = { git = "https://github.com/xinggaoya/tauri-plugin-web-dev-bridge", tag = "v0.1.0" }
```

</details>

### 前端

```bash
npm install tauri-plugin-web-dev-bridge
# pnpm add tauri-plugin-web-dev-bridge
```

<details>
<summary>从 Git 依赖（想用未发布版本时）</summary>

```bash
npm i "git+https://github.com/xinggaoya/tauri-plugin-web-dev-bridge.git#v0.1.0"
```

</details>

> **关于产物形态**：npm 包直接提供 **TypeScript 源码**（`main` 指向 `src/index.ts`），
> 由消费方的打包器（vite / esbuild）编译。这样做的好处是**零构建**——
> git 依赖不需要执行 `prepare` 脚本，也就不需要任何 `allowBuilds` 白名单。
> 只需要编译产物（`dist/`）时，可自行执行 `pnpm run build`。

## 用法

### 1. 注册插件并在 `setup` 钩子里启动

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_web_dev_bridge::Builder::new().build())
    .setup(|app| {
        // 桥需要 App<Wry> 才能取到 invoke_key（Tauri 仅在桌面运行时公开该 API），
        // 因此启动动作放在应用自己的 setup 钩子里——此时窗口/webview 已创建完毕。
        tauri_plugin_web_dev_bridge::start(app)?;
        Ok(())
    })
    .run(tauri::generate_context!())
```

> **为什么不在插件的 `initialize` 钩子里启动？**
> 一是 `invoke_key` 只在 `App<Wry>` 上公开（`AppHandle` 上没有）；
> 二是 Tauri 的顺序是「先 `initialize_plugins`，再建窗口，最后跑应用 `setup`」，
> 只有应用 `setup` 执行时 webview 才存在。

### 2. 前端挂载前安装 shim

```ts
// main.ts
import { installWebDevBridge } from 'tauri-plugin-web-dev-bridge'

installWebDevBridge() // 在 Tauri 环境下是空操作

// ... 正常创建并挂载应用
```

### 3. 让 dev server 能发现桥的端口

Rust 侧默认监听 `6222`，端口被占用时自动退化为随机端口。
为了在随机端口下也能零配置发现，Rust 侧会把 `{ port, pid, url }` 写到
`<系统临时目录>/tauri-web-dev-bridge.json`。

vite 插件负责把这个文件以**同源 JSON** 暴露出来（没有跨域问题）：

```ts
// vite.config.ts
import { webDevBridgeVitePlugin } from 'tauri-plugin-web-dev-bridge/vite'

export default defineConfig({
  plugins: [vue(), webDevBridgeVitePlugin()],
})
```

前端会依次尝试：显式 `baseUrl`/`port` → 同源发现路由 → 兜底探测 `6222`。

### 4. 跑起来

```bash
pnpm tauri dev      # 桌面应用 + vite dev server 一起起来
```

然后用**普通浏览器**打开 vite 的地址（默认 `http://localhost:6221`），
页面就能像在桌面窗口里一样工作，且拿到的是真实数据。

## API

### Rust：`Builder`

| 方法 | 默认值 | 说明 |
| --- | --- | --- |
| `port(u16)` | `6222` | 监听端口；`0` 表示由系统分配。被占用时自动退化为随机端口 |
| `enabled(bool)` | `cfg!(debug_assertions)` | release 构建默认关闭 |
| `allow_origin(String)` | `"*"` | `Access-Control-Allow-Origin` |
| `descriptor_path(PathBuf)` | `<temp>/tauri-web-dev-bridge.json` | 描述文件路径 |
| `webview_label(String)` | `"main"` | 承载 IPC 的 webview 标签 |
| `timeout(Duration)` | `30s` | 单次 IPC 调用超时 |

### 前端：`installWebDevBridge(options?)`

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `baseUrl` | – | 显式指定桥的基地址 |
| `port` | – | 显式指定桥的端口 |
| `windowLabel` | `"main"` | `Window.getCurrent()` 返回的标签 |
| `events` | `true` | 是否订阅事件流 |
| `eventPollIntervalMs` | `1000` | 事件轮询间隔（毫秒） |
| `discoveryRoute` | `/__tauri_dev_bridge__/info` | 同源发现路由 |
| `fallbackPort` | `6222` | 兜底探测端口 |
| `timeoutMs` | `15000` | 等待桥就绪的最长时间 |

返回值是一个句柄：

```ts
const handle = installWebDevBridge()
await handle.ready() // 等待桥就绪，返回 { port, pid, url }
handle.dispose()     // 拆除 shim（主要用于测试）
```

在 Tauri 环境下返回的句柄 `installed === false`，**不改动任何全局状态**。

## HTTP 接口

桥的接口本身也是一等公民，可以直接用 `curl` 调试：

```bash
# 健康检查
curl http://127.0.0.1:6222/health

# 调用一个真实后端命令
curl -X POST http://127.0.0.1:6222/invoke \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"db_get_app_config","args":{}}'

# 拉取自游标之后的事件（短轮询，与浏览器侧同款）
curl "http://127.0.0.1:6222/events?client=my-client&since=0"

# 订阅事件流（SSE 辅助通道，主要给命令行调试用）
curl -N "http://127.0.0.1:6222/events/stream?client=my-client"
```

`POST /invoke` 的响应信封：

```json
{ "ok": true, "data": { "...": "..." } }
{ "ok": false, "error": "命令错误信息" }
```

## 事件

浏览器的 `listen()` 会被 shim 转成 `plugin:event|listen` 调用，桥在 **Rust 侧**注册真实监听，
事件进入该客户端的队列，再由前端轮询取回。

事件按**客户端**隔离：每个标签页有自己的监听器集合与事件队列，
因此多个标签页（含自动化测试的多个上下文）不会互相收到重复事件。

前端拿到的事件对象与官方 `listen` 完全一致：

```ts
{ event: 'traffic-data', id: 1234, payload: { ... } }
```

### 为什么是短轮询而不是 SSE / WebSocket

浏览器自动化工具（Playwright / CDP 生态）普遍用 *networkidle* 判定页面就绪，
而 **SSE / WebSocket 这类长连接会让 networkidle 永远无法达成**——
`agent-browser open` 之类的命令会一直挂起（实测 > 300s）。

因此事件通道采用**短轮询**（默认 1s 一次）：客户端带游标来取，取完立即返回，
两次轮询之间留出了空闲窗口，networkidle 可以正常达成。

SSE 通道（`GET /events/stream`）仍然保留，但只作为命令行调试的辅助手段。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 浏览器控制台报 `未找到调试桥` | 桌面应用没启动。先跑 `pnpm tauri dev`，再刷新浏览器 |
| 桥返回 `webview \`main\` 不可用` | 应用窗口尚未创建；桥在应用 `setup` 之后才可用，稍等重试 |
| 事件收不到 | 确认应用在 `emit` 该事件；内核未运行时不会有流量/连接类事件 |
| 端口被占用 | 自动退化为随机端口，此时只能通过描述文件发现（确认 vite 插件已注册） |
| 跨域报错 | 桥只监听 `127.0.0.1`；若页面来自其他源，用 `Builder::allow_origin()` 收紧/放开 |

## 已知边界

- **必须先启动桌面应用**（例如 `pnpm tauri dev`）。桥活在应用进程里。
- 仅桌面端可用（依赖 `App<Wry>::invoke_key`）。
- `plugin:window:*` 这类窗口命令作用于**真实窗口**（桌面窗口会跟着动）——
  这正是「像在桌面窗口里点一样」的预期行为。
- release 构建默认不启用。

## 与其他方案的对比

| 方案 | 数据真实性 | 改动量 | 自动化友好 |
| --- | --- | --- | --- |
| 前端 mock（MSW / json-server） | ❌ 假数据 | 中 | ✅ |
| 本插件 | ✅ 真实 | ✅ 极小 | ✅ |
| 只跑桌面端 + 远程调试（WebDriver） | ✅ 真实 | 大 | ❌ 依赖桌面环境 |

## 路线图

- [ ] 支持 `Builder::allow_origin` 之外的来源白名单
- [ ] 提供可选的 WebSocket 事件通道（长连接场景）
- [ ] 桥的请求/响应录制与回放（用于复现线上问题）
- [ ] 与 `tauri-plugin-devtools` 联动，一键开启浏览器调试

## 参与贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。行为准则见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 许可证

[MIT](./LICENSE)

[`tauri::webview::Webview::on_message`]: https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html#method.on_message
[`tauri::App::invoke_key`]: https://docs.rs/tauri/latest/tauri/struct.App.html#method.invoke_key
