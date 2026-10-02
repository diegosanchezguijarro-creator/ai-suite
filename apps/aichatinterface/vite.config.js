import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// NOTE: this machine's Application Control policy blocks Rollup's native .node
// binary, so package.json maps `rollup` -> `npm:@rollup/wasm-node` via overrides.
// Remove that override on machines where the native build loads normally.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          markdown: [
            'react-markdown',
            'remark-gfm',
            'rehype-highlight',
            'highlight.js',
          ],
        },
      },
    },
  },
})