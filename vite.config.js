import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { buildWecomSettlementMapsFromEnv } from './scripts/wecomSettlementServerCore.mjs'

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
 * @param {string} origin 原力 Metabase 根地址，无末尾 /，如 http://yl-metabase.vrviu.com:3000
 */
function yuanliMetabaseFetchProxy(origin) {
  const prefix = '/api/metabase-yl'
  const base = String(origin || '').trim().replace(/\/+$/, '') || 'http://yl-metabase.vrviu.com:3000'
  let upstreamHost = 'yl-metabase.vrviu.com:3000'
  try {
    upstreamHost = new URL(base).host
  } catch {
    /* keep default */
  }

  return async function middleware(req, res, next) {
    if (!req.url?.startsWith(prefix)) {
      return next()
    }

    const pathWithQuery = req.url.slice(prefix.length) || '/'
    const targetUrl = `${base}${pathWithQuery}`

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
      headers.set('host', upstreamHost)
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

/** 开发环境：企微凭证只在此中间件使用，不暴露给浏览器 */
function wecomSettlementMapMiddleware(env) {
  let loggedMissingWecomCreds = false
  return async function middleware(req, res, next) {
    const p = req.url?.split('?')[0] || ''
    if (req.method !== 'GET' || p !== '/api/wecom/settlement-map') {
      return next()
    }
    try {
      const { paas, yuanli } = await buildWecomSettlementMapsFromEnv(env)
      const body = JSON.stringify({ paas, yuanli, fetchedAt: new Date().toISOString() })
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(body)
    } catch (err) {
      const msg = String(err?.message || err)
      const missingCreds = msg.includes('缺少 WECOM_CORP_ID') || msg.includes('WECOM_CORP_SECRET')
      if (missingCreds) {
        if (!loggedMissingWecomCreds) {
          loggedMissingWecomCreds = true
          console.warn(
            '[vite wecom settlement]',
            msg,
            '（本条仅提示一次：请在 .env 配置 WECOM_CORP_ID / WECOM_CORP_SECRET 等，或设 VITE_WECOM_SETTLEMENT_MAP_DISABLED=1 并重启 dev）',
          )
        }
      } else {
        console.warn('[vite wecom settlement]', msg)
      }
      res.statusCode = 503
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: msg }))
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  const yuanliMetabaseOrigin =
    String(env.YUANLI_METABASE_ORIGIN || '').trim() || 'http://yl-metabase.vrviu.com:3000'

  return {
    plugins: [
      {
        name: 'yuanli-metabase-fetch-proxy',
        configureServer(server) {
          server.middlewares.use(yuanliMetabaseFetchProxy(yuanliMetabaseOrigin))
          server.middlewares.use(wecomSettlementMapMiddleware(env))
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
  }
})
