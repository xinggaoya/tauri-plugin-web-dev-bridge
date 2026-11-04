# 贡献指南

感谢你考虑为 `tauri-plugin-web-dev-bridge` 做贡献。

## 开发环境

| 组件 | 版本 |
| --- | --- |
| Rust | 1.77.2+（edition 2021） |
| Node.js | 20+（pnpm 9+） |
| pnpm | `corepack enable` 后自带 |

## 本地开发

```bash
git clone https://github.com/xinggaoya/tauri-plugin-web-dev-bridge.git
cd tauri-plugin-web-dev-bridge

# Rust 侧
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --all -- --check
cd ..

# 前端侧
pnpm install
pnpm test
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec prettier --check "**/*.{ts,json}"
```

## 代码风格

- **Rust**：`cargo fmt` 默认风格；clippy 必须零告警（CI 用 `-D warnings` 卡）。
- **TypeScript**：2 空格、单引号、无分号、行宽 100；由 `prettier` 统一格式化。
- **注释写「为什么」，不写「做了什么」**。尤其是反直觉的设计（例如事件通道为什么用短轮询
  而不是 SSE），请在代码里留下原因，避免后人「优化」回去。

## 提交信息

遵循 Conventional Commits：

```
feat: 支持自定义桥端口
fix: 修复事件名非法时导致应用 panic
docs: 补充跨平台说明
chore: 升级 tauri 依赖
```

## 提交 PR 前

确保以下全部通过：

```bash
pnpm lint && pnpm type-check && pnpm test
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## 兼容性约定

本插件跟随 **Tauri v2** 的 minor 版本：

- `tauri = "2.10"` —— 允许 `2.10.x` ~ `2.x` 的兼容升级；
- 破坏性变更只在 major 版本发布。

## 需要讨论的改动

以下改动请**先开 issue 讨论**，不要直接开 PR：

- 事件通道模型（当前是短轮询，改成 SSE / WebSocket 会影响自动化工具的 networkidle 判定）；
- IPC 合成方式（当前依赖 `Webview::on_message` + `App::invoke_key`）；
- 桥的默认端口与描述文件位置。

## 报告安全问题

请勿用公开 issue 报告安全漏洞，见 [SECURITY.md](./SECURITY.md)。
