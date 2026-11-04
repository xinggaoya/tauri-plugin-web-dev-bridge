import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_DIR = join(__dirname, '..')

/** 仅供 Node 侧（vite 插件）使用的模块。 */
const NODE_ONLY_MODULES = new Set(['vite.ts'])

/** 浏览器入口允许依赖的文件。 */
const BROWSER_FILES = readdirSync(SRC_DIR)
  .filter((file) => file.endsWith('.ts'))
  .filter((file) => !NODE_ONLY_MODULES.has(file))
  .filter((file) => !file.endsWith('.test.ts'))

describe('浏览器入口的 Node 依赖隔离', () => {
  it('浏览器侧模块不得引入 node: 内置模块', () => {
    const offenders: string[] = []

    for (const file of BROWSER_FILES) {
      const source = readFileSync(join(SRC_DIR, file), 'utf8')
      if (/from\s+['"]node:/.test(source)) {
        offenders.push(file)
      }
    }

    // 曾经的真实事故：index.ts re-export 了依赖 node:fs 的 vite.ts，
    // 导致浏览器里整个模块图在求值阶段抛错、页面白屏且控制台看不到业务日志。
    expect(offenders).toEqual([])
  })

  it('入口不得静态 re-export Node-only 模块', () => {
    const source = readFileSync(join(SRC_DIR, 'index.ts'), 'utf8')
    expect(source).not.toMatch(/export\s*\{[^}]*\}\s*from\s*['"]\.\/vite['"]/)
  })
})
