# Changelog

本文件记录 `tauri-plugin-web-dev-bridge` 的所有重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

暂无。

## [0.1.0] - 2026-11-04

首个版本。

### 新增

- **Rust 侧**：`Builder` / `Plugin` / `start(app)`，在应用进程内开一个只监听 `127.0.0.1`
  的 HTTP 调试桥。
  - `POST /invoke`：把浏览器的 `{ cmd, args }` 还原成一条**真正的** Tauri IPC 消息
    （`InvokeRequest` + `invoke_key`），投喂给应用**自身**的命令处理器——
    因此浏览器里看到的是真实数据库、真实内核查询、真实事件流，而不是任何形式的前端 mock。
  - `GET /events`：短轮询事件接口（带游标），按客户端隔离。
  - `GET /events/stream`：SSE 辅助通道，供命令行调试使用。
  - `GET /health`：健康检查。
  - 描述文件（`<temp>/tauri-web-dev-bridge.json`）记录实际监听端口，供前端零配置发现。
- **前端侧**：`installWebDevBridge()` 安装 `window.__TAURI_INTERNALS__` 的浏览器实现，
  让 `@tauri-apps/api` 原样工作；Tauri 环境下是**空操作**。
- **Vite 侧**：`webDevBridgeVitePlugin()` 以同源 JSON 暴露描述文件，
  解决「Rust 监听随机端口时前端如何发现」的问题。

### 设计说明

- 事件通道采用**短轮询**而非 SSE / WebSocket：长连接会让浏览器自动化工具的
  *networkidle* 判定永远无法达成（实测 `agent-browser open` 挂起 > 300s），
  短轮询后降至约 1.1s。
- 事件按**客户端（标签页）**隔离，多标签页与自动化多上下文互不干扰。

[未发布]: https://github.com/xinggaoya/tauri-plugin-web-dev-bridge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xinggaoya/tauri-plugin-web-dev-bridge/releases/tag/v0.1.0
