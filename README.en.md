<div align="center">

# tauri-plugin-web-dev-bridge

**Let a plain browser drive a running Tauri v2 app — with real data.**

[中文](./README.md) · [Troubleshooting](./docs/troubleshooting.md)

[![CI](https://github.com/xinggaoya/tauri-plugin-web-dev-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/xinggaoya/tauri-plugin-web-dev-bridge/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/tauri-plugin-web-dev-bridge.svg)](https://crates.io/crates/tauri-plugin-web-dev-bridge)
[![npm](https://img.shields.io/npm/v/tauri-plugin-web-dev-bridge.svg)](https://www.npmjs.com/package/tauri-plugin-web-dev-bridge)
[![License](https://img.shields.io/crates/l/tauri-plugin-web-dev-bridge.svg)](./LICENSE)

</div>

## The problem

A Tauri frontend can only reach the backend through `window.__TAURI_INTERNALS__.invoke()`.
On desktop that path ends at the WebView's `ipc://` custom protocol — **a plain browser cannot reach it**.

So when you open the frontend in a browser to debug a UI issue:

```
TypeError: Cannot read properties of undefined (reading 'transformCallback')
TypeError: Cannot read properties of undefined (reading 'invoke')
```

The page renders blank and every backend call fails.

## The fix

This plugin runs a **local debug bridge** inside the app process, so a plain browser can drive the
**running** application — and it gets **real data** (real database, real kernel queries, real events),
not a front-end mock.

```text
browser ──HTTP POST /invoke──▶ bridge (127.0.0.1:port)
                                  │  synthesizes InvokeRequest (with invoke_key)
                                  ▼
                              running Tauri app
                                  │  real command handlers / real gRPC / real SQLite
                                  ▼
browser ◀──JSON response──────── bridge

browser ◀──short poll /events─── bridge ◀──Rust Listener◀──app.emit(...)
```

Because the bridge dispatches into the app's **own** command handlers, every click in the browser is
equivalent to clicking in the desktop window: switching a node really switches the kernel, saving
config really persists it.

## How it is possible

Tauri v2 exposes two APIs publicly:

| API | Purpose |
| --- | --- |
| [`tauri::webview::Webview::on_message`] | public method; lets you hand-craft an IPC request |
| [`tauri::App::invoke_key`] | public method; the key an `InvokeRequest` must carry |

The bridge builds an `InvokeRequest` that is **exactly equivalent** to the WebView's, so it goes
through the same command dispatch, ACL checks and error handling.

## Features

- **Real data** — not a mock. Real database, real kernel gRPC queries, real event stream.
- **Zero app changes** — only `window.__TAURI_INTERNALS__` is replaced; `@tauri-apps/api` works as-is.
- **No-op in Tauri** — `installWebDevBridge()` does nothing on desktop.
- **Automation friendly** — events use **short polling** instead of a long-lived connection, so
  *networkidle* detection works (`agent-browser open` went from hanging >300s to ~1.1s).
- **Per-tab isolation** — each browser context gets its own listeners and event queue.
- **curl-friendly** — the bridge's HTTP API is a first-class interface.
- **dev-only** — skipped in release builds; the HTTP server only listens on `127.0.0.1`.

## Install

### Rust

```toml
[dependencies]
tauri-plugin-web-dev-bridge = "0.1"
```

### Frontend

```bash
npm install tauri-plugin-web-dev-bridge
```

## Usage

### 1. Register the plugin and start it from your `setup` hook

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_web_dev_bridge::Builder::new().build())
    .setup(|app| {
        // The bridge needs `App<Wry>` for `invoke_key`, which Tauri only exposes on the
        // desktop runtime — and at this point the window/webview already exists.
        tauri_plugin_web_dev_bridge::start(app)?;
        Ok(())
    })
    .run(tauri::generate_context!())
```

### 2. Install the shim before mounting

```ts
import { installWebDevBridge } from 'tauri-plugin-web-dev-bridge'

installWebDevBridge() // no-op inside Tauri
```

### 3. Let the dev server discover the bridge port

The Rust side prefers port `6222` and falls back to a random port when it is taken. It records the
actual port in `<temp dir>/tauri-web-dev-bridge.json`; the Vite plugin exposes that file as
same-origin JSON so the frontend can find the bridge with zero configuration:

```ts
import { webDevBridgeVitePlugin } from 'tauri-plugin-web-dev-bridge/vite'

export default defineConfig({
  plugins: [vue(), webDevBridgeVitePlugin()],
})
```

### 4. Run it

```bash
pnpm tauri dev
```

Then open the Vite dev server URL (e.g. `http://localhost:6221`) in a **regular browser**.

## HTTP API

```bash
curl http://127.0.0.1:6222/health
curl -X POST http://127.0.0.1:6222/invoke \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"db_get_app_config","args":{}}'
curl "http://127.0.0.1:6222/events?client=my-client&since=0"
curl -N "http://127.0.0.1:6222/events/stream?client=my-client"
```

## Troubleshooting

See [docs/troubleshooting.md](./docs/troubleshooting.md).

## License

[MIT](./LICENSE)

[`tauri::webview::Webview::on_message`]: https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html#method.on_message
[`tauri::App::invoke_key`]: https://docs.rs/tauri/latest/tauri/struct.App.html#method.invoke_key
