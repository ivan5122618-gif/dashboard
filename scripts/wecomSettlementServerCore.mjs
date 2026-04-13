/**
 * 服务端：拉取企微 access_token + 智能表格记录，生成 PAAS 结算套餐→项目 ID 映射。
 * 供 Vite dev 中间件与 scripts/wecom-settlement-proxy.mjs 共用。
 */

const GET_TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken'
const GET_RECORDS_URL = 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/get_records'

let _tokenCache = { token: '', expiresAt: 0 }

function normalizeId(id) {
  return String(id ?? '').trim()
}

export function flattenWecomCell(val) {
  if (val == null) return ''
  if (typeof val === 'string' || typeof val === 'number') return String(val).trim()
  if (Array.isArray(val)) {
    if (val.length === 0) return ''
    const first = val[0]
    if (first && typeof first === 'object' && 'text' in first) return String(first.text ?? '').trim()
    return flattenWecomCell(first)
  }
  if (typeof val === 'object' && 'text' in val) return String(val.text ?? '').trim()
  if (typeof val === 'object' && 'value' in val) return String(val.value ?? '').trim()
  return String(val).trim()
}

export function splitBizIds(raw) {
  const s = normalizeId(raw)
  if (!s) return []
  return s
    .split(/[,，;；\s|/、]+/)
    .map((x) => normalizeId(x))
    .filter(Boolean)
}

async function fetchAccessToken(corpId, corpSecret) {
  const now = Date.now()
  if (_tokenCache.token && now < _tokenCache.expiresAt - 60000) {
    return _tokenCache.token
  }
  const url = `${GET_TOKEN_URL}?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`
  const res = await fetch(url)
  const data = await res.json()
  if (data.errcode !== 0) {
    throw new Error(`gettoken: ${data.errmsg || data.errcode}`)
  }
  const expiresIn = Number(data.expires_in) || 7200
  const ttlMs = Math.max(120, expiresIn - 120) * 1000
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + ttlMs }
  return data.access_token
}

async function fetchRecordsPage(token, body) {
  const url = `${GET_RECORDS_URL}?access_token=${encodeURIComponent(token)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data.errcode !== 0) {
    throw new Error(`get_records: ${data.errmsg || data.errcode}`)
  }
  return data
}

/**
 * @param {string} token
 * @param {string} docId
 * @param {string} sheetId
 * @param {string[]} fieldTitles 字段标题列表（会去重）
 */
export async function fetchAllSmartSheetRecords(token, docId, sheetId, fieldTitles) {
  const titles = [...new Set(fieldTitles.filter(Boolean))]
  const all = []
  let offset = 0
  const limit = 100
  for (;;) {
    const body = {
      docid: docId,
      sheet_id: sheetId,
      offset,
      limit,
      key_type: 'CELL_VALUE_KEY_TYPE_FIELD_TITLE',
      field_titles: titles,
    }
    const data = await fetchRecordsPage(token, body)
    const records = Array.isArray(data.records) ? data.records : []
    all.push(...records)
    if (!data.has_more) break
    const next = data.next
    if (typeof next === 'number' && Number.isFinite(next)) offset = next
    else offset += records.length
    if (records.length === 0) break
  }
  return all
}

function normPlatformMark(s) {
  return normalizeId(s).toUpperCase()
}

/**
 * 智能表格 values 的 key 必须与表头完全一致；兼容 PAAS映射biz / PAAS映射BIZ 等写法。
 * @param {Record<string, unknown>} values
 * @param {string} primary
 * @param {string[]} aliases
 */
export function pickValuesField(values, primary, aliases = []) {
  if (!values || typeof values !== 'object') return undefined
  const tryKeys = [...new Set([primary, ...aliases].filter(Boolean))]
  for (const k of tryKeys) {
    if (Object.prototype.hasOwnProperty.call(values, k) && values[k] != null) {
      return values[k]
    }
  }
  const wantBiz = /PAAS映射/i.test(primary || '') || aliases.some((a) => /PAAS映射/i.test(a || ''))
  if (wantBiz) {
    for (const k of Object.keys(values)) {
      if (/PAAS映射/i.test(k) && /biz/i.test(k)) return values[k]
    }
  }
  return undefined
}

/**
 * 按「服务平台」拆成 PAAS / 原力 两套映射：服务平台取值与 yuanliMark 一致（默认 PAAS-YL）的进 yuanli，其余进 paas。
 * @returns {{ paas: Record<string, string[]>, yuanli: Record<string, string[]> }}
 */
export function recordsToSplitSettlementMaps(
  records,
  settlementTitle,
  projectTitle,
  platformTitle,
  yuanliMark,
) {
  const yl = normPlatformMark(yuanliMark || 'PAAS-YL')
  /** @type {Record<string, Set<string>>} */
  const accPaas = Object.create(null)
  /** @type {Record<string, Set<string>>} */
  const accYuanli = Object.create(null)

  const settlementAliases = ['结算套餐ID', '结算套餐']
  const projectAliases = ['PAAS映射biz', 'PAAS映射BIZ', 'PAAS映射Biz']
  const platformAliases = ['服务平台']

  for (const rec of records) {
    const values = rec?.values && typeof rec.values === 'object' ? rec.values : {}
    const sid = normalizeId(
      flattenWecomCell(pickValuesField(values, settlementTitle, settlementAliases)),
    )
    if (!sid) continue
    const pids = splitBizIds(
      flattenWecomCell(pickValuesField(values, projectTitle, projectAliases)),
    )
    const platformRaw = flattenWecomCell(
      pickValuesField(values, platformTitle, platformAliases),
    )
    const isYuanli = normPlatformMark(platformRaw) === yl
    const acc = isYuanli ? accYuanli : accPaas
    if (!acc[sid]) acc[sid] = new Set()
    if (pids.length === 0) {
      acc[sid] = new Set()
    } else {
      for (const p of pids) acc[sid].add(p)
    }
  }

  /** @param {Record<string, Set<string>>} acc */
  function toObj(acc) {
    /** @type {Record<string, string[]>} */
    const out = Object.create(null)
    for (const [sid, set] of Object.entries(acc)) {
      out[sid] = Array.from(set)
    }
    return out
  }
  return { paas: toObj(accPaas), yuanli: toObj(accYuanli) }
}

/**
 * @param {Record<string, string|undefined>} env - process.env 或 loadEnv 结果
 * @returns {Promise<{ paas: Record<string, string[]>, yuanli: Record<string, string[]> }>}
 */
export async function buildWecomSettlementMapsFromEnv(env) {
  const corpId = normalizeId(env.WECOM_CORP_ID)
  const corpSecret = normalizeId(env.WECOM_CORP_SECRET)
  const docId = normalizeId(env.WECOM_DOC_ID)
  const sheetId = normalizeId(env.WECOM_SHEET_ID)
  const settlementTitle = normalizeId(env.WECOM_FIELD_SETTLEMENT) || '结算套餐ID'
  /** 表头多为「PAAS映射biz」，与「PAAS映射BIZ」不同 key */
  const projectTitle = normalizeId(env.WECOM_FIELD_PROJECT) || 'PAAS映射biz'
  const platformTitle = normalizeId(env.WECOM_FIELD_PLATFORM) || '服务平台'
  const yuanliMark = normalizeId(env.WECOM_PLATFORM_YUANLI) || 'PAAS-YL'

  if (!corpId || !corpSecret) {
    throw new Error('缺少 WECOM_CORP_ID 或 WECOM_CORP_SECRET')
  }
  if (!docId || !sheetId) {
    throw new Error('缺少 WECOM_DOC_ID 或 WECOM_SHEET_ID')
  }

  const token = await fetchAccessToken(corpId, corpSecret)
  const fieldTitles = [settlementTitle, projectTitle, platformTitle]
  const records = await fetchAllSmartSheetRecords(token, docId, sheetId, fieldTitles)
  return recordsToSplitSettlementMaps(
    records,
    settlementTitle,
    projectTitle,
    platformTitle,
    yuanliMark,
  )
}
