import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** 原力 Metabase 根地址（仅本机开发转发用，不要在浏览器直连以避免 CORS） */
const YUANLI_METABASE_ORIGIN = 'http://yl-metabase.vrviu.com:3000'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * 用 Node fetch 转发 /api/metabase-yl，替代 http-proxy。
 * 个别环境下 http-proxy 转发原力 Metabase 会偶现 HTTP 200 且 Content-Length: 0（body 丢失）。
 */
function yuanliMetabaseFetchProxy() {
  const prefix = '/api/metabase-yl'

  return async function middleware(req, res, next) {
    if (!req.url?.startsWith(prefix)) {
      return next()
    }

    const pathWithQuery = req.url.slice(prefix.length) || '/'
    const targetUrl = `${YUANLI_METABASE_ORIGIN}${pathWithQuery}`

    try {
      const method = req.method || 'GET'
      const headers = new Headers()

      for (const [key, val] of Object.entries(req.headers)) {
        if (val == null) continue
        const lk = key.toLowerCase()
        if (HOP_BY_HOP.has(lk) || lk === 'host') continue
        if (Array.isArray(val)) {
          for (const v of val) headers.append(key, v)
        } else {
          headers.set(key, val)
        }
      }
      headers.set('host', 'yl-metabase.vrviu.com:3000')
      headers.set('accept-encoding', 'identity')

      let body
      if (method !== 'GET' && method !== 'HEAD') {
        body = await readRequestBody(req)
      }

      const upstream = await fetch(targetUrl, {
        method,
        headers,
        body: body && body.length > 0 ? body : undefined,
      })

      const outBuf = Buffer.from(await upstream.arrayBuffer())

      res.statusCode = upstream.status
      upstream.headers.forEach((value, key) => {
        const lk = key.toLowerCase()
        if (HOP_BY_HOP.has(lk)) return
        if (lk === 'content-length') return
        try {
          res.setHeader(key, value)
        } catch {
          /* ignore invalid header names */
        }
      })
      res.setHeader('content-length', String(outBuf.length))
      res.end(outBuf)
    } catch (err) {
      console.error('[vite yuanli proxy]', err)
      if (!res.headersSent) {
        res.statusCode = 502
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ message: String(err?.message || err) }))
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'yuanli-metabase-fetch-proxy',
      configureServer(server) {
        server.middlewares.use(yuanliMetabaseFetchProxy())
      },
    },
    react(),
  ],
  server: {
    // 开发时用代理访问 Metabase，避免浏览器跨域（CORS）
    proxy: {
      '/api/metabase': {
        target: 'https://metabase.vrviu.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/metabase/, ''),
      },
      // 原力：由插件 yuanli-metabase-fetch-proxy（Node fetch）转发，勿在此处配置 http-proxy
    },
  },
})
