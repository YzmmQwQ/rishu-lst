import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
    },
    rules: {
      // react-hooks 7.1 启用了一组面向 React Compiler 的严格规则。本项目未启用
      // React Compiler（仅手写 useMemo），这些规则会对既有合理模式大量误报：
      //   - set-state-in-effect: effect 内同步 setState（用于同步外部状态，合法）
      //   - refs: render 期间读 ref.current（如 socket 单例 ref，安全）
      //   - incompatible-library: 第三方 hook（useVirtualizer）返回函数无法被 Compiler memo
      //   - preserve-manual-memoization: 手写 useMemo 依赖与 Compiler 推断不一致
      // 降为 warn 保持可见，但不阻塞构建；若将来启用 React Compiler 再重新启用。
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // shadcn/ui 组件文件常同时导出组件与 variants 辅助函数（如 buttonVariants），
      // 属标准模式；react-refresh 该规则在此场景下降级为 warn。
      'react-refresh/only-export-components': 'warn',
    },
  },
])
