# 安全策略

## 支持版本

| 版本 | 支持 |
| --- | --- |
| 0.1.x | ✅ |

本插件遵循 [semver](https://semver.org/lang/zh-CN/)。

## 报告漏洞

请通过 GitHub 的 [Security Advisory](https://github.com/xinggaoya/tauri-plugin-web-dev-bridge/security/advisories/new)
私下报告，**不要**开公开 issue。

请在报告中尽量包含：

- 受影响版本；
- 复现步骤或最小复现代码；
- 影响面评估。

我会在 72 小时内确认收到，并在修复后发布 advisory。

## 安全边界

本插件是**开发期调试工具**，请注意：

- 默认只在 debug 构建（`cfg!(debug_assertions)`）下启用，release 构建自动跳过；
- HTTP 服务**只监听 `127.0.0.1`**，不对外网暴露；
- 它持有应用的**完整后端调用能力**（等价于应用本身），因此**不要**在存有敏感数据的
  生产环境开启；
- `Access-Control-Allow-Origin` 默认为 `*`，因为服务仅本机可达；
  若你的环境存在其他本地用户，请通过 `Builder::allow_origin()` 收紧来源。
