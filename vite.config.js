import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 开发时用代理访问 Metabase，避免浏览器跨域（CORS）
    proxy: {
      '/api/metabase': {
        target: 'https://metabase.vrviu.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/metabase/, ''),
      },
    },
  },
})
