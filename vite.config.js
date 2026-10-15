import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5197, strictPort: true, watch: { ignored: ['**/.android-sdk/**', '**/.gradle-cache/**', '**/.electron-cache/**', '**/.electron-builder-cache/**', '**/.desktop-stage/**', '**/android/**', '**/.qa/**', '**/artifacts/**'] } },
  preview: { port: 4197, strictPort: true },
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
