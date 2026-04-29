import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:7575',
    },
  },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
})
