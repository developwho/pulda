import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = `http://127.0.0.1:${process.env.PULDA_DEV_API_PORT || '3001'}`

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { input: { app: 'index.html', mock: 'mock.html' } },
  },
  server: {
    proxy: {
      '/api': { target: apiTarget, ws: true },
      '/healthz': apiTarget,
    },
  },
})
