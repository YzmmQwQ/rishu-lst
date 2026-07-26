import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import path from 'path'
import { readFileSync } from 'fs'

const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext', // 原生支持 top-level await，避免 vite-plugin-top-level-await 与 manualChunks 冲突
    rollupOptions: {
      output: {
        // Vite 8 / Rollup 4：manualChunks 使用函数形式（类型安全，等价于原对象映射）
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router')) return 'vendor-react'
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('scheduler/')) {
              return 'vendor-react'
            }
            if (id.includes('socket.io-client')) return 'vendor-socket'
            if (id.includes('/motion/')) return 'vendor-motion'
            if (
              id.includes('/radix-ui/') ||
              id.includes('/sonner/') ||
              id.includes('/vaul/') ||
              id.includes('/class-variance-authority/')
            ) {
              return 'vendor-ui'
            }
            if (id.includes('/@pixi/')) return 'vendor-pixi'
          }
        },
      },
    },
  },
})
