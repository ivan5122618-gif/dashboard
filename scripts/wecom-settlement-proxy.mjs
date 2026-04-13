#!/usr/bin/env node
/**
 * 生产/预览：本地起一个小服务，把企微凭证留在服务端，浏览器只请求本服务的映射 JSON。
 *
 * 用法（建议在 dashboard 目录）：
 *   node scripts/wecom-settlement-proxy.mjs
 * 默认端口 8787；可用环境变量 PORT 覆盖。
 * 依赖同目录 wecomSettlementServerCore.mjs，企微参数见 .env.example。
 */

import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWecomSettlementMapsFromEnv } from './wecomSettlementServerCore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadDotEnv() {
  const p = resolve(root, '.env')
  if (!existsSync(p)) return
  const text = readFileSync(p, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadDotEnv()

const PORT = Number(process.env.PORT) || 8787

async function handleSettlementMap(res) {
  try {
    const { paas, yuanli } = await buildWecomSettlementMapsFromEnv(process.env)
    const body = JSON.stringify({
      paas,
      yuanli,
      fetchedAt: new Date().toISOString(),
    })
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (e) {
    const msg = String(e?.message || e)
    console.error('[wecom-settlement-proxy]', msg)
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: msg }))
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/'
  if (req.method === 'GET' && (url === '/api/wecom/settlement-map' || url.startsWith('/api/wecom/settlement-map?'))) {
    await handleSettlementMap(res)
    return
  }
  if (req.method === 'GET' && url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(PORT, () => {
  console.log(`[wecom-settlement-proxy] http://127.0.0.1:${PORT}/api/wecom/settlement-map`)
})
