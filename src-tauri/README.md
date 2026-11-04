# tauri-plugin-web-dev-bridge（Rust crate）

把运行中的 Tauri v2 应用的**真实 IPC** 暴露给普通浏览器，用于网页调试与浏览器自动化测试。

> 这是该插件的 Rust crate 子目录。完整文档（安装、用法、API、故障排查）请看
> [仓库根 README](https://github.com/xinggaoya/tauri-plugin-web-dev-bridge#readme)。

## 快速上手

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_web_dev_bridge::Builder::new().build())
    .setup(|app| {
        // 需要 App<Wry> 才能取到 invoke_key，故放在应用自己的 setup 钩子里。
        tauri_plugin_web_dev_bridge::start(app)?;
        Ok(())
    })
    .run(tauri::generate_context!())
```

## 许可证

[MIT](../LICENSE)
