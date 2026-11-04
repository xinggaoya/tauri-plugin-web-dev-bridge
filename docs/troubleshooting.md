# 故障排查

## 浏览器控制台报「未找到调试桥」

**现象**

```
[web-dev-bridge] 未找到调试桥：请确认桌面应用已启动（`pnpm tauri dev`），且已注册 webDevBridgeVitePlugin()。
```

**原因**

桥活在**应用进程**里。桌面应用没启动时，桥自然不存在。

**处理**

1. 先跑 `pnpm tauri dev`，等桌面窗口出现；
2. 刷新浏览器页面；
3. 若应用已启动仍报错，检查 `vite.config.ts` 里是否注册了 `webDevBridgeVitePlugin()`
   （没有它，前端只能靠兜底探测 `6222`，而 Rust 侧可能用了随机端口）。

用下面的命令确认桥是否活着：

```bash
curl http://127.0.0.1:6222/health
# {"ok":true,"pid":12345,"webview":"main"}
```

---

## 「webview `main` 不可用」

**原因**

桥在应用 `setup` 钩子里启动，正常情况下 webview 已经创建。
若报这个错，通常是：

- 应用用了自定义窗口标签（需要 `Builder::webview_label("你的标签")`）；
- 或者请求发生得过早（在应用完成初始化前）。

---

## 事件收不到

按顺序排查：

1. **应用真的在 `emit` 吗？** 内核未运行时不会有流量 / 连接类事件——
   桥是真实转发，不会凭空造数据。先在桌面窗口里确认对应功能有输出。
2. **事件名对得上吗？** 桥按**事件名**注册监听，名字必须与后端 `emit` 的完全一致。
3. **客户端隔离生效吗？** 事件按标签页隔离，浏览器收不到说明该标签页没有订阅这个事件。

```bash
# 手动订阅一个事件，再拉一次
curl -X POST http://127.0.0.1:6222/invoke \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"plugin:event|listen","args":{"event":"kernel-status-changed"},"clientId":"debug"}'

curl "http://127.0.0.1:6222/events?client=debug&since=0"
```

---

## 跨域错误

桥默认 `Access-Control-Allow-Origin: *`，且**只监听 `127.0.0.1`**。

- 若页面来自 `http://localhost:6221`，正常情况不会跨域；
- 若你的环境里还有其他本地用户可访问本机，请收紧来源：

```rust
tauri_plugin_web_dev_bridge::Builder::new()
    .allow_origin("http://localhost:6221")
    .build()
```

---

## 端口冲突

Rust 侧优先监听 `6222`；被占用时**自动退化为系统随机端口**，
并把实际端口写进 `<temp>/tauri-web-dev-bridge.json`。

如果前端找不到桥，通常是 vite 中间件没生效。确认：

```bash
curl http://localhost:6221/__tauri_dev_bridge__/info
# {"port":6222,"pid":12345,"url":"http://127.0.0.1:6222"}
```

返回 `{"port":null,...}` 说明桌面应用还没写描述文件（应用未启动）。

---

## 自动化工具的 `open` 命令挂起

如果你用的是 SSE / WebSocket 版的旧实现，*networkidle* 判定可能永远无法达成。
当前版本的事件通道是**短轮询**，正常情况下 `open` 会在 1~2 秒内返回。

若仍然挂起，检查浏览器控制台是否有未捕获的异常——**未捕获异常会让页面一直处于加载态**。

---

## 想看桥上的原始流量

桥本身是普通 HTTP 服务，可以直接抓包：

```bash
# 另开一个终端，持续打印所有调用
curl -N http://127.0.0.1:6222/health
```

应用侧日志里也有桥的输出（`tracing`）：

```
[web-dev-bridge] 已启动 → http://127.0.0.1:6222（POST /invoke、GET /events、GET /health）
```

---

## 安装时 `git@github.com: Permission denied (publickey)`

依赖写成了 `github:owner/repo#ref`，pnpm 会把它归一化成 SSH 地址并写进 lock 文件，
于是 CI（以及任何没有 SSH key 的环境）拉取失败。

改成 `git+https://` 写法即可 —— pnpm 会转而使用 codeload 的 HTTPS tarball：

```bash
npm i "git+https://github.com/xinggaoya/tauri-plugin-web-dev-bridge.git#v0.1.0"
```

改完后需要重新生成 lock 文件（`rm -rf node_modules && pnpm install`），
确认 lock 里记的是 `https://codeload.github.com/...` 而不是 `git+ssh://...`。

---

## 还是不行？

请开 issue，并附上：

- `curl http://127.0.0.1:6222/health` 的输出；
- 浏览器控制台的完整输出（`agent-browser console` 或 DevTools）；
- 你的 `Cargo.toml` 依赖片段与 `setup` 钩子代码；
- 操作系统与 Tauri 版本。
