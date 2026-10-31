import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5197, strictPort: true, watch: { ignored: ['**/.android-sdk/**', '**/.gradle-cache/**', '**/.electron-cache/**', '**/.electron-builder-cache/**', '**/.desktop-stage/**', '**/android/**', '**/.qa/**', '**/artifacts/**'] } },
  preview: { port: 4197, strictPort: true },
  // E1：数据库 Worker 现在按需动态 import 题库（3.4MB），需要 ES 输出才允许代码分割。
  // 运行时本来就以 { type: 'module' } 创建 Worker，因此这不引入新的兼容要求。
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/katex/')) return 'katex';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) return 'react';
          if (id.includes('/node_modules/react-markdown/') || id.includes('/node_modules/remark-') || id.includes('/node_modules/rehype-')) return 'markdown';
        },
      },
    },
  },
})
