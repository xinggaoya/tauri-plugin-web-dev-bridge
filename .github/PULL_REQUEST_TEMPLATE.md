## 变更内容

<!-- 用一两句话说明这次改了什么、为什么改。 -->

## 类型

- [ ] 修复（fix）
- [ ] 功能（feat）
- [ ] 文档（docs）
- [ ] 重构（refactor）
- [ ] 杂项（chore）

## 验证清单

- [ ] `cargo fmt --all -- --check` 通过
- [ ] `cargo clippy --all-targets -- -D warnings` 通过
- [ ] `cargo test` 通过
- [ ] `pnpm exec tsc -p tsconfig.json --noEmit` 通过
- [ ] `pnpm test` 通过
- [ ] `pnpm exec prettier --check "**/*.{ts,json}"` 通过
- [ ] 在真实 Tauri 应用里验证过（`pnpm tauri dev` + 浏览器打开 dev server）

## 兼容性

- [ ] 不破坏现有 API
- [ ] 若破坏性变更，已在 `CHANGELOG.md` 的 `[未发布]` 段记录并说明迁移方式

## 备注

<!-- 截图、日志、参考资料链接等。 -->
