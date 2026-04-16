import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  memo,
} from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Activity,
  Monitor,
  List,
  Layers,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Users,
  Zap,
  Loader2,
  X,
} from 'lucide-react';

import {
  aggregateOrdersDatasetByProjectDate,
  applyWecomSettlementMaps,
  getProjectIdToSettlementIds,
  normalizeDateKey,
  projectIdsForSupplyCardId,
  SUPPLY_ENV_PAAS,
  SUPPLY_ENV_YUANLI,
  supplyCardIdForProjectId,
} from './supply/settlementToProject.js';

const useApi =
  String(import.meta.env.VITE_USE_API || '').toLowerCase() === '1' ||
  String(import.meta.env.VITE_USE_API || '').toLowerCase() === 'true';

/** 企微 PAAS 结算映射 JSON；生产可设为独立代理完整 URL */
const WECOM_SETTLEMENT_MAP_URL =
  String(import.meta.env.VITE_WECOM_SETTLEMENT_MAP_URL || '').trim() || '/api/wecom/settlement-map';
/** 设为 1 时控制台打印结算映射来自企微还是代码兜底（调试用） */
const debugSettlementMap =
  String(import.meta.env.VITE_DEBUG_SETTLEMENT_MAP || '').trim() === '1' ||
  String(import.meta.env.VITE_DEBUG_SETTLEMENT_MAP || '').toLowerCase() === 'true';

/** 去掉 .env 里为防特殊字符加的外层引号，避免整串被当成空或带错字符 */
function normalizeDotenvValue(raw) {
  let s = String(raw ?? '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }
  return s;
}

const metabaseUser = String(import.meta.env.VITE_METABASE_USERNAME || '').trim();
const metabasePass = normalizeDotenvValue(import.meta.env.VITE_METABASE_PASSWORD);
/**
 * 自建 Metabase session：仅账密时启动不带 .env TOKEN（避免过期 UUID 先发请求再失败）；
 * 首次 /api/dataset 401 后由 queryMetabaseNative 调 /api/session 换新。仅有 TOKEN 无账密时仍用 TOKEN。
 */
let metabaseSessionId =
  metabaseUser && metabasePass
    ? ''
    : String(import.meta.env.VITE_METABASE_SESSION_TOKEN || '').trim();
let metabaseLoginPromise = null;

const yuanliMetabaseUser = String(import.meta.env.VITE_YUANLI_METABASE_USERNAME || '').trim();
const yuanliMetabasePass = normalizeDotenvValue(import.meta.env.VITE_YUANLI_METABASE_PASSWORD);
/** 原力站点根（无末尾 /）。设置后 session、dataset 均请求「该域名 + /api/...」；不设置则走开发代理 /api/metabase-yl */
const yuanliMetabaseBaseUrl = String(
  import.meta.env.VITE_YUANLI_METABASE_BASE_URL || '',
)
  .trim()
  .replace(/\/+$/, '');
let yuanliMetabaseSessionId =
  yuanliMetabaseUser && yuanliMetabasePass
    ? ''
    : String(import.meta.env.VITE_YUANLI_METABASE_SESSION_TOKEN || '').trim();
let yuanliMetabaseLoginPromise = null;
let yuanliAuthWarnedAt = 0;
const EMPTY_NATIVE_DATASET = { data: { cols: [], rows: [] } };

function metabaseApiPrefix(audience) {
  if (audience === SUPPLY_ENV_YUANLI) {
    return yuanliMetabaseBaseUrl || '/api/metabase-yl';
  }
  return '/api/metabase';
}

async function refreshMetabaseSessionViaLogin(audience = SUPPLY_ENV_PAAS) {
  if (audience === SUPPLY_ENV_YUANLI) {
    if (!yuanliMetabaseUser || !yuanliMetabasePass) {
      throw new Error(
        '原力 Metabase 401：请在 .env 配置 VITE_YUANLI_METABASE_SESSION_TOKEN，或填写 VITE_YUANLI_METABASE_USERNAME / VITE_YUANLI_METABASE_PASSWORD',
      );
    }
    if (yuanliMetabaseLoginPromise) return yuanliMetabaseLoginPromise;
    yuanliMetabaseLoginPromise = (async () => {
      const loginPairs = [
        { username: yuanliMetabaseUser, password: yuanliMetabasePass, tag: 'yuanli-env' },
      ];
      if (metabaseUser && metabaseUser !== yuanliMetabaseUser) {
        loginPairs.push({ username: metabaseUser, password: yuanliMetabasePass, tag: 'fallback-email' });
      }

      let lastError = '未知错误';
      for (const pair of loginPairs) {
        const res = await fetch(`${metabaseApiPrefix(SUPPLY_ENV_YUANLI)}/api/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: pair.username, password: pair.password }),
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) {
          lastError = `${res.status}: ${text.slice(0, 500)}`;
          continue;
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`原力 Metabase 登录响应非 JSON: ${text.slice(0, 200)}`);
        }
        const id = data?.id;
        if (!id) {
          lastError = '登录成功但未返回 session id';
          continue;
        }
        if (pair.tag !== 'yuanli-env') {
          console.info('[原力登录] 已自动回退使用邮箱登录名');
        }
        yuanliMetabaseSessionId = String(id);
        return yuanliMetabaseSessionId;
      }
      throw new Error(`原力 Metabase 登录失败: ${lastError}`);
    })();
    try {
      return await yuanliMetabaseLoginPromise;
    } finally {
      yuanliMetabaseLoginPromise = null;
    }
  }

  if (!metabaseUser || !metabasePass) {
    throw new Error(
      'Metabase 401：请在 .env 更新 VITE_METABASE_SESSION_TOKEN，或填写 VITE_METABASE_USERNAME / VITE_METABASE_PASSWORD 以自动登录',
    );
  }
  if (metabaseLoginPromise) return metabaseLoginPromise;

  metabaseLoginPromise = (async () => {
    const res = await fetch(`${metabaseApiPrefix(SUPPLY_ENV_PAAS)}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: metabaseUser, password: metabasePass }),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`Metabase 登录失败 ${res.status}: ${text.slice(0, 500)}`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Metabase 登录响应非 JSON: ${text.slice(0, 200)}`);
    }
    const id = data?.id;
    if (!id) throw new Error('Metabase 登录未返回 session id');
    metabaseSessionId = String(id);
    return metabaseSessionId;
  })();

  try {
    return await metabaseLoginPromise;
  } finally {
    metabaseLoginPromise = null;
  }
}

async function queryMetabaseNative({ database, query, audience = SUPPLY_ENV_PAAS }) {
  const prefix = metabaseApiPrefix(audience);
  const hasPasswordLogin =
    audience === SUPPLY_ENV_YUANLI
      ? Boolean(yuanliMetabaseUser && yuanliMetabasePass)
      : Boolean(metabaseUser && metabasePass);

  const run = () => {
    const token = audience === SUPPLY_ENV_YUANLI ? yuanliMetabaseSessionId : metabaseSessionId;
    /** 部分 Metabase/网关只认 Cookie；与 X-Metabase-Session 一并带上 */
    const sessionHeaders = token
      ? {
          'X-Metabase-Session': token,
          Cookie: `metabase.SESSION=${token}`,
        }
      : {};
    return fetch(`${prefix}/api/dataset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...sessionHeaders,
      },
      body: JSON.stringify({
        type: 'native',
        database,
        native: { query, 'template-tags': {} },
      }),
    });
  };

  const curToken = audience === SUPPLY_ENV_YUANLI ? yuanliMetabaseSessionId : metabaseSessionId;
  if (!curToken && hasPasswordLogin) {
    await refreshMetabaseSessionViaLogin(audience);
  }

  let res = await run();
  /** token 失效或错误时清空内存 session，用账密重新 POST /api/session，最多两轮 */
  let refreshAttempts = 0;
  while (res.status === 401) {
    await res.text().catch(() => '');
    if (!hasPasswordLogin || refreshAttempts >= 2) break;
    if (audience === SUPPLY_ENV_YUANLI) yuanliMetabaseSessionId = '';
    else metabaseSessionId = '';
    await refreshMetabaseSessionViaLogin(audience);
    refreshAttempts++;
    res = await run();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (audience === SUPPLY_ENV_YUANLI && res.status === 401) {
      const now = Date.now();
      if (now - yuanliAuthWarnedAt > 30000) {
        yuanliAuthWarnedAt = now;
        console.warn('[原力供应] 鉴权失败，已降级为空数据。请检查原力账号/密码或 session。');
      }
      return EMPTY_NATIVE_DATASET;
    }
    const hint401 =
      res.status === 401 && !hasPasswordLogin
        ? '（401：请在 .env 配置 VITE_METABASE_SESSION_TOKEN 或 VITE_METABASE_USERNAME + VITE_METABASE_PASSWORD；原力同理 VITE_YUANLI_*）'
        : '';
    throw new Error(`Metabase query failed: ${res.status} ${text}${hint401}`);
  }

  const text = await res.text().catch(() => '');
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    const ct = res.headers.get('content-type') ?? '';
    const cl = res.headers.get('content-length') ?? '';
    throw new Error(
      `Metabase 响应体为空 (HTTP ${res.status}，Content-Type=${ct || '—'}，Content-Length=${cl || '—'})。` +
        `链路已通但并非有效 JSON；可重启 dev 试 vite 代理对原力已禁 gzip；若仍如此请在 Network 里看该请求 Response 是否真为空。`,
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    const preview = trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
    throw new Error(`Metabase 响应不是合法 JSON (HTTP ${res.status}): ${preview}`);
  }
}

/** MM-DD 列表按“离今天最近的一天在前”排序 */
function sortDatesMmDdNewestFirst(dates) {
  const y = new Date().getFullYear();
  const now = Date.now();
  const toTime = (mmdd) => {
    const parts = String(mmdd).split('-');
    if (parts.length !== 2) return 0;
    const mo = Number(parts[0]);
    const da = Number(parts[1]);
    if (!Number.isFinite(mo) || !Number.isFinite(da)) return 0;
    let t = new Date(y, mo - 1, da).getTime();
    if (t > now + 48 * 3600000) t = new Date(y - 1, mo - 1, da).getTime();
    return t;
  };
  return [...dates].sort((a, b) => toTime(b) - toTime(a));
}

/** 看板卡片 project_id 与 ClickHouse 里可能出现的「环境」project_id 对齐（仅供应口径，不改动订单聚合计键） */
const SUPPLY_CARD_INSTANCE_ALIASES = {
  '401': ['10125'],
  '378': ['10100'],
};

/** 多 project_id 并到一张卡：同一结算套餐会落到多个 id 上、数值相同，按日取 max 去重，避免订单 double */
function orderMapMergedForSupplyCard(memberProjectIds, ordersByProjectDate) {
  const map = {};
  for (const key of memberProjectIds.map(String)) {
    const raw = ordersByProjectDate?.[key] || {};
    for (const [k, v] of Object.entries(raw)) {
      const d = normalizeDateKey(k);
      if (!d) continue;
      const total = Number(v.total) || 0;
      const month = Number(v.month) || 0;
      const elastic = Number(v.elastic) || 0;
      if (!map[d]) {
        map[d] = { total, month, elastic };
      } else {
        map[d].total = Math.max(map[d].total, total);
        map[d].month = Math.max(map[d].month, month);
        map[d].elastic = Math.max(map[d].elastic, elastic);
      }
    }
  }
  return map;
}

function mergeVmidSupplyForPids(memberProjectIds, vmidMapFull, byteOnly) {
  const byDate = {};
  if (byteOnly) return byDate;
  for (const pid of memberProjectIds.map(String)) {
    for (const [k, v] of Object.entries(vmidMapFull?.[pid] || {})) {
      const d = normalizeDateKey(k);
      if (!d) continue;
      if (!byDate[d]) byDate[d] = { maxSum: 0, avgSum: 0, hasMax: false, hasAvg: false };
      if (Number.isFinite(v.max)) {
        byDate[d].maxSum += v.max;
        byDate[d].hasMax = true;
      }
      if (Number.isFinite(v.avg)) {
        byDate[d].avgSum += v.avg;
        byDate[d].hasAvg = true;
      }
    }
  }
  const out = {};
  for (const [d, o] of Object.entries(byDate)) {
    out[d] = {
      max: o.hasMax ? o.maxSum : NaN,
      avg: o.hasAvg ? o.avgSum : NaN,
    };
  }
  return out;
}

function mergedInstanceRowsForSupply(memberProjectIds, instanceByProjectId) {
  const byDate = {};
  for (const pid of memberProjectIds.map(String)) {
    const rows = instanceRowsForSupplyProject(pid, instanceByProjectId);
    for (const r of rows) {
      const d = normalizeDateKey(r.date);
      if (!d) continue;
      if (!byDate[d]) {
        byDate[d] = {
          date: r.date,
          totalMax: 0,
          totalAvg: 0,
          hasMax: false,
          hasAvg: false,
          avail: r.avail,
          health: r.health,
          total: r.total,
        };
      }
      const tMax = Number(r.totalMax);
      const tAvg = Number(r.totalAvg);
      if (Number.isFinite(tMax)) {
        byDate[d].totalMax += tMax;
        byDate[d].hasMax = true;
      }
      if (Number.isFinite(tAvg)) {
        byDate[d].totalAvg += tAvg;
        byDate[d].hasAvg = true;
      }
    }
  }
  return Object.values(byDate).map((o) => ({
    date: o.date,
    totalMax: o.hasMax ? o.totalMax : undefined,
    totalAvg: o.hasAvg ? o.totalAvg : undefined,
    avail: o.avail,
    health: o.health,
    total: o.total,
  }));
}

function instanceRowsForSupplyProject(projectId, instanceByProjectId) {
  const pid = String(projectId);
  const by = instanceByProjectId || {};
  const direct = by[pid]?.table;
  if (Array.isArray(direct) && direct.length > 0) return direct;
  for (const alt of SUPPLY_CARD_INSTANCE_ALIASES[pid] || []) {
    const t = by[alt]?.table;
    if (Array.isArray(t) && t.length > 0) return t;
  }
  return [];
}

/** 供应表最多展示天数（与实例/字节 SQL 近 7 天对齐；订单回退时也不再拉满整个账期周） */
const SUPPLY_TABLE_DAYS = 7;

function parseSupplyVmid7dDataset(ds) {
  const cols = ds?.data?.cols ?? [];
  const rows = ds?.data?.rows ?? [];
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const findIdx = (keys) => {
    const nkeys = keys.map(norm);
    for (let i = 0; i < cols.length; i++) {
      const name = norm(cols[i]?.name ?? cols[i]?.display_name ?? '');
      if (!name) continue;
      if (nkeys.some((k) => name.includes(k))) return i;
    }
    return -1;
  };
  const iDt = findIdx(['dt', 'date']);
  const iPid = findIdx(['project_id', 'projectid']);
  const iMax = findIdx(['max_count', 'maxcount']);
  const iAvg = findIdx(['avg_count', 'avgcount']);
  const byProject = {};
  if (iDt === -1 || iPid === -1 || iMax === -1 || iAvg === -1) {
    console.warn('[供应vmid7d] 返回列缺少 dt / project_id / max_count / avg_count');
    return byProject;
  }
  for (const r of rows) {
    const projectId = String(r[iPid] ?? '').trim();
    if (!projectId) continue;
    const dk = normalizeDateKey(r[iDt]);
    if (!dk) continue;
    const mx = Number(r[iMax]);
    const av = Number(r[iAvg]);
    if (!byProject[projectId]) byProject[projectId] = {};
    byProject[projectId][dk] = {
      max: Number.isFinite(mx) ? mx : NaN,
      avg: Number.isFinite(av) ? av : NaN,
    };
  }
  return byProject;
}

function findDatasetColIdx(cols, aliases) {
  for (let i = 0; i < cols.length; i++) {
    const raw = String(cols[i]?.name ?? cols[i]?.display_name ?? '');
    if (!raw) continue;
    const ascii = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const a of aliases) {
      if (raw.includes(a)) return i;
      const na = String(a).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (na && ascii.includes(na)) return i;
    }
  }
  return -1;
}

/** 从原力供应 map 任一日数据里取业务名称（SQL 列「业务名称」/ biz_name） */
function yuanliBizNameForProject(vmidMapFull, projectId) {
  const dayMap = vmidMapFull?.[String(projectId)];
  if (!dayMap || typeof dayMap !== 'object') return '';
  for (const v of Object.values(dayMap)) {
    const n = v?.bizName != null ? String(v.bizName).trim() : '';
    if (n) return n;
  }
  return '';
}

/** 原力 Metabase：列「日期」「业务类型」「业务名称」「总数最大值」「总数平均值」（biz_type 仍作项目键与订单对齐） */
function parseYuanliSupplyDataset(ds) {
  const cols = ds?.data?.cols ?? [];
  const rows = ds?.data?.rows ?? [];
  const colNames = cols.map((c) => c?.name ?? c?.display_name ?? '').join(' | ');
  const iDt = findDatasetColIdx(cols, ['日期', 'date', 'daily.date', 'dailydate']);
  const iBiz = findDatasetColIdx(cols, ['业务类型', 'biz_type', 'biztype']);
  const iName = findDatasetColIdx(cols, ['业务名称', 'biz_name', 'bizname']);
  const iMax = findDatasetColIdx(cols, ['总数最大值', 'max_total', 'maxtotal']);
  const iAvg = findDatasetColIdx(cols, ['总数平均值', 'avg_total', 'avgtotal']);
  const byProject = {};
  if (iDt === -1 || iBiz === -1 || iMax === -1 || iAvg === -1) {
    console.warn(
      `[原力供应] 列匹配失败，请对照 Metabase 列名调整解析。当前列: ${colNames || '(无)'}`,
    );
    return byProject;
  }
  for (const r of rows) {
    const pid = String(r[iBiz] ?? '').trim();
    if (!pid) continue;
    const dk = normalizeDateKey(r[iDt]);
    if (!dk) continue;
    const mx = Number(r[iMax]);
    const av = Number(r[iAvg]);
    const bizName = iName !== -1 ? String(r[iName] ?? '').trim() : '';
    if (!byProject[pid]) byProject[pid] = {};
    const prev = byProject[pid][dk];
    const mergedName = bizName || prev?.bizName;
    byProject[pid][dk] = {
      max: Number.isFinite(mx) ? mx : NaN,
      avg: Number.isFinite(av) ? av : NaN,
      ...(mergedName ? { bizName: mergedName } : {}),
    };
  }
  return byProject;
}

/**
 * 按「供应卡片」合并：多项目卡为同一张结算套餐下多 biz id，供应路数按项目按日相加；33 仍为字节专用口径。
 */
function buildSupplyTableForProject(
  memberProjectIds,
  instanceByProjectId,
  byteSupplyByDate,
  ordersByProjectDate,
  vmidMapFull,
) {
  const pids = memberProjectIds.map(String);
  const byteOnly = pids.length === 1 && pids[0] === '33';

  const instRows = mergedInstanceRowsForSupply(pids, instanceByProjectId);
  const instByD = {};
  for (const r of instRows || []) {
    const d = normalizeDateKey(r.date);
    if (!d) continue;
    instByD[d] = r;
  }

  const byteRaw = byteOnly ? byteSupplyByDate || {} : {};
  const byteByD = {};
  for (const [k, v] of Object.entries(byteRaw)) {
    const d = normalizeDateKey(k);
    if (d) byteByD[d] = v;
  }

  const vmidD = mergeVmidSupplyForPids(pids, vmidMapFull, byteOnly);

  const orderMapRaw = orderMapMergedForSupplyCard(pids, ordersByProjectDate);
  const orderMap = {};
  for (const [k, v] of Object.entries(orderMapRaw)) {
    const d = normalizeDateKey(k);
    if (d) orderMap[d] = v;
  }

  const dates = new Set();
  if (!byteOnly && Object.keys(vmidD).length > 0) {
    for (const d of Object.keys(vmidD)) dates.add(d);
  } else if (byteOnly) {
    for (const d of Object.keys(byteByD)) dates.add(d);
    if (dates.size === 0) return null;
  } else if (Object.keys(instByD).length > 0) {
    for (const d of Object.keys(instByD)) dates.add(d);
  } else {
    for (const d of Object.keys(orderMap)) dates.add(d);
    if (dates.size === 0) return null;
  }

  if (dates.size === 0) return null;

  const sortedDesc = sortDatesMmDdNewestFirst(Array.from(dates)).slice(0, SUPPLY_TABLE_DAYS);

  return sortedDesc.map((date) => {
    const inst = instByD[date];
    const byteHit = byteOnly ? byteByD[date] : undefined;
    const vm = vmidD[date];
    let max;
    let avg;

    if (!byteOnly && vm && (Number.isFinite(vm.max) || Number.isFinite(vm.avg))) {
      max = Number.isFinite(vm.max) ? Math.round(vm.max) : '—';
      avg = Number.isFinite(vm.avg) ? Math.round(vm.avg) : '—';
    } else if (byteOnly && byteHit && (Number.isFinite(byteHit.max) || Number.isFinite(byteHit.avg))) {
      max = Number.isFinite(byteHit.max) ? Math.round(byteHit.max) : '—';
      avg = Number.isFinite(byteHit.avg) ? Math.round(byteHit.avg) : '—';
    } else if (inst && (Number.isFinite(Number(inst.totalMax)) || Number.isFinite(Number(inst.totalAvg)))) {
      max = Number.isFinite(Number(inst.totalMax)) ? Math.round(Number(inst.totalMax)) : '—';
      avg = Number.isFinite(Number(inst.totalAvg)) ? Math.round(Number(inst.totalAvg)) : '—';
    } else {
      max = '—';
      avg = '—';
    }

    const ot = orderMap[date]?.total;
    const order = Number.isFinite(Number(ot)) ? Number(ot) : '—';

    return { date, max, avg, order };
  });
}

// --- 模拟数据 (Mock Data) ---
const generateTrendData = (points, base, variance) => {
  return Array.from({ length: points }).map((_, i) => ({
    time: `04-0${(i % 9) + 1}`,
    value: Math.max(
      0,
      Math.floor(base + (Math.random() * variance - variance / 2) + (i > points - 3 ? variance : 0)),
    ),
  }));
};

const queueData = [
  { time: '04-01 19:30', users: 600 },
  { time: '04-01 22:00', users: 640 },
  { time: '04-02 01:00', users: 240 },
  { time: '04-02 04:00', users: 220 },
  { time: '04-02 07:00', users: 500 },
  { time: '04-02 10:00', users: 350 },
  { time: '04-02 13:00', users: 400 },
  { time: '04-02 16:00', users: 50 },
  { time: '04-02 19:00', users: 20 },
  { time: '04-02 22:00', users: 15 },
  { time: '04-03 01:00', users: 10 },
  { time: '04-03 04:00', users: 12 },
  { time: '04-03 07:00', users: 260 },
  { time: '04-03 10:00', users: 250 },
  { time: '04-03 13:00', users: 180 },
];

const CLOUD_TASK_DATES = ['04-03', '04-04', '04-05', '04-06', '04-07', '04-08', '04-09'];
const buildCloudStageTrend = ({
  successBase,
  successWave,
  durationBase,
  durationWave,
}) =>
  CLOUD_TASK_DATES.map((date, idx) => {
    const swing = Math.sin((idx + 1) * 0.9);
    const successRate = Math.max(
      80,
      Math.min(99.9, Number((successBase + swing * successWave).toFixed(2))),
    );
    const avgDuration = Math.max(
      20,
      Number((durationBase + Math.cos((idx + 1) * 0.7) * durationWave).toFixed(1)),
    );
    const failRate = Number((100 - successRate).toFixed(2));
    return { time: date, successRate, failRate, avgDuration };
  });

const CLOUD_TASK_PHASES = [
  {
    id: 'image-save',
    title: '3.1 游戏镜像保存阶段',
    aliases: '端游：游戏保存；手游：保存镜像',
    object: '游戏保存 / 保存镜像子任务',
    scope: '项目级别筛选',
    statusScope: '游戏保存成功 / 镜像保存成功 / 游戏保存失败 / 镜像保存失败',
    avgDuration: 122.4,
    successRate: 97.62,
    totalTasks: 12640,
    trend: buildCloudStageTrend({ successBase: 97.6, successWave: 0.8, durationBase: 122, durationWave: 12 }),
    roomBreakdown: [
      { name: '华北A', avgDuration: 118.3, successRate: 98.1, failRate: 1.9, tasks: 3510 },
      { name: '华东B', avgDuration: 126.7, successRate: 97.2, failRate: 2.8, tasks: 2890 },
      { name: '华南A', avgDuration: 121.1, successRate: 97.9, failRate: 2.1, tasks: 2432 },
    ],
  },
  {
    id: 'room-dispatch',
    title: '3.2 游戏云化｜机房分发阶段',
    aliases: '机房分发',
    object: '机房分发子任务',
    scope: '项目级别筛选',
    statusScope: '机房分发成功 / 机房分发失败',
    avgDuration: 86.5,
    successRate: 96.78,
    totalTasks: 10928,
    trend: buildCloudStageTrend({ successBase: 96.8, successWave: 1.1, durationBase: 86, durationWave: 10 }),
    roomBreakdown: [
      { name: '华北A', avgDuration: 81.9, successRate: 97.4, failRate: 2.6, tasks: 3012 },
      { name: '华东B', avgDuration: 88.6, successRate: 96.3, failRate: 3.7, tasks: 2745 },
      { name: '华南A', avgDuration: 85.7, successRate: 96.8, failRate: 3.2, tasks: 2308 },
    ],
  },
  {
    id: 'deploy',
    title: '3.3 游戏部署阶段',
    aliases: '游戏部署',
    object: '游戏部署子任务',
    scope: '项目级别筛选',
    statusScope: '游戏部署成功 / 游戏部署失败',
    avgDuration: 73.2,
    successRate: 98.24,
    totalTasks: 10116,
    trend: buildCloudStageTrend({ successBase: 98.2, successWave: 0.7, durationBase: 73, durationWave: 8 }),
    roomBreakdown: [
      { name: '华北A', avgDuration: 70.8, successRate: 98.6, failRate: 1.4, tasks: 2950 },
      { name: '华东B', avgDuration: 75.1, successRate: 97.9, failRate: 2.1, tasks: 2481 },
      { name: '华南A', avgDuration: 72.6, successRate: 98.3, failRate: 1.7, tasks: 2196 },
    ],
  },
  {
    id: 'accelerate',
    title: '3.4 游戏加速阶段',
    aliases: '游戏加速',
    object: '游戏加速子任务',
    scope: '项目级别筛选',
    statusScope: '游戏加速成功 / 游戏加速失败',
    avgDuration: 49.8,
    successRate: 97.18,
    totalTasks: 9660,
    trend: buildCloudStageTrend({ successBase: 97.2, successWave: 0.9, durationBase: 50, durationWave: 6 }),
    roomBreakdown: [
      { name: '华北A', avgDuration: 47.1, successRate: 97.9, failRate: 2.1, tasks: 2710 },
      { name: '华东B', avgDuration: 51.4, successRate: 96.8, failRate: 3.2, tasks: 2332 },
      { name: '华南A', avgDuration: 50.3, successRate: 97.0, failRate: 3.0, tasks: 2014 },
    ],
  },
  {
    id: 'disk-mount',
    title: '3.5 云盘挂载阶段',
    aliases: '云盘挂载',
    object: '云盘挂载子任务',
    scope: '项目级别筛选',
    statusScope: '云盘挂载成功 / 云盘挂载失败',
    avgDuration: 58.6,
    successRate: 98.67,
    totalTasks: 9140,
    trend: buildCloudStageTrend({ successBase: 98.7, successWave: 0.6, durationBase: 59, durationWave: 7 }),
    roomBreakdown: [
      { name: '华北A', avgDuration: 56.8, successRate: 99.0, failRate: 1.0, tasks: 2598 },
      { name: '华东B', avgDuration: 59.9, successRate: 98.4, failRate: 1.6, tasks: 2215 },
      { name: '华南A', avgDuration: 58.1, successRate: 98.6, failRate: 1.4, tasks: 1980 },
    ],
  },
  {
    id: 'disk-dispatch',
    title: '3.6 云盘分发阶段',
    aliases: '云盘分发',
    object: '云盘分发子任务',
    scope: '项目级别筛选',
    statusScope: '云盘分发成功 / 云盘分发失败',
    avgDuration: 64.1,
    successRate: 97.95,
    totalTasks: 8876,
    trend: buildCloudStageTrend({ successBase: 98.0, successWave: 0.8, durationBase: 64, durationWave: 7 }),
    roomBreakdown: [
      { name: '华北A', avgDuration: 61.5, successRate: 98.3, failRate: 1.7, tasks: 2468 },
      { name: '华东B', avgDuration: 65.7, successRate: 97.6, failRate: 2.4, tasks: 2108 },
      { name: '华南A', avgDuration: 64.8, successRate: 97.9, failRate: 2.1, tasks: 1895 },
    ],
  },
  {
    id: 'auto-cloud',
    title: '3.7 自动云化任务',
    aliases: '任务类型：全自动云化',
    object: '自动云化全链路子任务',
    scope: '项目级别筛选',
    statusScope: '以加速阶段成功/失败为口径',
    avgDuration: 211.3,
    successRate: 96.34,
    totalTasks: 4022,
    trend: buildCloudStageTrend({ successBase: 96.4, successWave: 1.2, durationBase: 211, durationWave: 18 }),
    roomBreakdown: [
      { name: '华北A', avgDuration: 204.6, successRate: 96.9, failRate: 3.1, tasks: 1184 },
      { name: '华东B', avgDuration: 216.8, successRate: 95.8, failRate: 4.2, tasks: 965 },
      { name: '华南A', avgDuration: 212.7, successRate: 96.2, failRate: 3.8, tasks: 843 },
    ],
  },
];

const CLOUD_TASK_GAMESET_OPTIONS = [
  { id: 'all', label: '全部游戏集' },
  { id: 'gs-1001', label: '燕云主线（1001）' },
  { id: 'gs-1002', label: '逆水寒联机（1002）' },
  { id: 'gs-1003', label: '永劫竞速（1003）' },
  { id: 'gs-1004', label: '字节体验服（1004）' },
];

const CLOUD_TASK_PERIOD_OPTIONS = [
  { id: '7', label: '近7天' },
  { id: '14', label: '近14天' },
  { id: '30', label: '近30天' },
];

function parseCloudDeployDurationDataset(ds) {
  const cols = ds?.data?.cols ?? [];
  const rows = ds?.data?.rows ?? [];
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const findIdx = (keys) => {
    const nkeys = keys.map(norm);
    for (let i = 0; i < cols.length; i += 1) {
      const name = norm(cols[i]?.name ?? cols[i]?.display_name ?? '');
      if (!name) continue;
      if (nkeys.some((k) => name.includes(k))) return i;
    }
    return -1;
  };
  const iIdc = findIdx(['idcid', 'idc_id', 'idc']);
  const iIdcName = findIdx(['idcname', 'idc_name']);
  const iDt = findIdx(['dt', 'date']);
  const iProject = findIdx(['projectid', 'project_id']);
  const iAvg = findIdx(['avg_duration']);
  const iMax = findIdx(['max_duration']);
  const iMin = findIdx(['min_duration']);
  if (iIdc === -1 || iProject === -1) return [];

  return rows.map((r) => ({
    dt: normalizeCloudTaskDateKey(r[iDt]),
    idcId: String(r[iIdc] ?? '').trim(),
    idcName: String(iIdcName === -1 ? '' : r[iIdcName] ?? '').trim(),
    projectId: normalizeProjectIdValue(r[iProject]),
    avgDuration: Number(r[iAvg] ?? NaN),
    maxDuration: Number(r[iMax] ?? NaN),
    minDuration: Number(r[iMin] ?? NaN),
  }));
}

function parseCloudDeploySuccessDataset(ds) {
  const cols = ds?.data?.cols ?? [];
  const rows = ds?.data?.rows ?? [];
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const findIdx = (keys) => {
    const nkeys = keys.map(norm);
    for (let i = 0; i < cols.length; i += 1) {
      const name = norm(cols[i]?.name ?? cols[i]?.display_name ?? '');
      if (!name) continue;
      if (nkeys.some((k) => name.includes(k))) return i;
    }
    return -1;
  };
  const iIdc = findIdx(['idcid', 'idc_id', 'idc']);
  const iDt = findIdx(['dt', 'date']);
  const iProject = findIdx(['projectid', 'project_id']);
  const iSuccessCnt = findIdx(['success_cnt']);
  const iFailCnt = findIdx(['fail_cnt']);
  const iTotalCnt = findIdx(['total_cnt']);
  const iSuccessRate = findIdx(['success_rate']);
  const iFailRate = findIdx(['fail_rate']);
  if (iIdc === -1 || iProject === -1) return [];

  return rows.map((r) => ({
    dt: normalizeCloudTaskDateKey(r[iDt]),
    idcId: String(r[iIdc] ?? '').trim(),
    projectId: normalizeProjectIdValue(r[iProject]),
    successCnt: Number(r[iSuccessCnt] ?? NaN),
    failCnt: Number(r[iFailCnt] ?? NaN),
    totalCnt: Number(r[iTotalCnt] ?? NaN),
    successRate: Number(r[iSuccessRate] ?? NaN),
    failRate: Number(r[iFailRate] ?? NaN),
  }));
}

const CLOUD_ROOM_NAME_TO_ID = {
  华北A: 'IDC-BJ-A',
  华东B: 'IDC-SH-B',
  华南A: 'IDC-GZ-A',
};

function buildRecentDayLabels(days) {
  const labels = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    labels.push(`${mm}-${dd}`);
  }
  return labels;
}

function buildCloudTrendByPeriod(baseTrend, days, successShift = 0, durationScale = 1) {
  const labels = buildRecentDayLabels(days);
  return labels.map((label, idx) => {
    const src = baseTrend[idx % baseTrend.length] || baseTrend[baseTrend.length - 1];
    const successRate = Math.max(
      80,
      Math.min(99.9, Number((Number(src?.successRate || 0) + successShift).toFixed(2))),
    );
    const avgDuration = Math.max(
      20,
      Number((Number(src?.avgDuration || 0) * durationScale).toFixed(1)),
    );
    return {
      time: label,
      successRate,
      failRate: Number((100 - successRate).toFixed(2)),
      avgDuration,
    };
  });
}

function normalizeProjectIdValue(raw) {
  return String(raw ?? '')
    .replace(/\[/g, '')
    .replace(/\]/g, '')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .trim();
}

function splitProjectIdTokens(raw) {
  const cleaned = normalizeProjectIdValue(raw);
  if (!cleaned) return [];
  return cleaned
    .split(/[,\s|;/，、]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeCloudTaskDateKey(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const matched = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (matched) {
    const mm = matched[2].padStart(2, '0');
    const dd = matched[3].padStart(2, '0');
    return `${mm}-${dd}`;
  }
  return normalizeDateKey(s);
}

function formatAdaptiveDuration(seconds, digits = 1) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec < 0) return '0.0s';
  if (sec < 60) return `${sec.toFixed(digits)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return s >= 0.05 ? `${m}m ${s.toFixed(digits)}s` : `${m}m`;
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = (sec - h * 3600) / 60;
    return m >= 0.05 ? `${h}h ${m.toFixed(digits)}m` : `${h}h`;
  }
  const d = Math.floor(sec / 86400);
  const h = (sec - d * 86400) / 3600;
  return h >= 0.05 ? `${d}d ${h.toFixed(digits)}h` : `${d}d`;
}

function getDurationAxisMode(maxSeconds) {
  const maxSec = Number(maxSeconds);
  if (!Number.isFinite(maxSec) || maxSec < 120) return 's';
  if (maxSec < 7200) return 'min';
  return 'h';
}

function formatDurationByAxis(seconds, mode, digits = 1) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec < 0) return `0.0${mode}`;
  if (mode === 'min') return `${(sec / 60).toFixed(digits)}m`;
  if (mode === 'h') return `${(sec / 3600).toFixed(digits)}h`;
  return `${sec.toFixed(digits)}s`;
}
const overallAvailability = generateTrendData(14, 95, 2);

const generateTableData = (unit = '路') => [
  { date: '04-01', max: 6466, avg: 6399, order: 4100 },
  { date: '03-31', max: 6470, avg: 6469, order: 5900 },
  { date: '03-30', max: 6470, avg: 6304, order: 5900 },
  { date: '03-29', max: 6261, avg: 6261, order: 5900 },
  { date: '03-28', max: 6261, avg: 6261, order: 5900 },
];

// 供应看板：卡片列表在此配置。 Metabase 只给列表里出现的 id 填数；要加项目需在这里增项并配 settlement 映射。
const projects = [
  { id: 68, name: '燕云十六声', unit: '路', supply: 4784, order: 4100, margin: '+684', trend: generateTrendData(7, 30, 20), table: generateTableData('路') },
  { id: 33, name: '字节跳动', unit: '卡', supply: 948, order: 780, margin: '+168', trend: generateTrendData(7, 15, 5), table: generateTableData('卡') },
  { id: 378, name: '快手二期统一环境', unit: '路', sub: '快手云玩法二期 (10100)', supply: 730, order: 680, margin: '+50', trend: generateTrendData(7, 5, 5), table: generateTableData('路') },
  { id: 42, name: '永劫无间', unit: '路', supply: 632, order: 300, margin: '+332', trend: generateTrendData(7, 50, 30), table: generateTableData('路') },
  { id: 23, name: '逆水寒端游', unit: '路', supply: 334, order: 288, margin: '+46', trend: generateTrendData(7, 20, 10), table: generateTableData('路') },
  {
    id: 401,
    name: 'ID 401',
    unit: '路',
    sub: '启思云游戏-正式环境 (10125)',
    supply: 246,
    order: 100,
    margin: '+146',
    trend: generateTrendData(7, 150, 50),
    table: generateTableData('路'),
  },
];

// --- Metabase：实例任务（占位 SQL，需你粘贴完整字符串后我再启用） ---
// 注意：你在聊天里这段 SQL 太长，系统会省略末尾；这里必须是“完整无省略”的原文。
const INSTANCE_CURRENT_AVAILABLE_SQL = `SELECT
  game.dwd_cloudgame_game_vminfo_v2_inc.project_id AS project_id,
  game.dwd_cloudgame_game_vminfo_v2_inc.project_name AS project_name,
  count() AS total_count,
  CASE
    WHEN count() > 0 THEN
      sum(CASE WHEN (game.dwd_cloudgame_game_vminfo_v2_inc.vm_status = '1-外部调度'
        AND game.dwd_cloudgame_game_vminfo_v2_inc.os_state = '2-健康可用') THEN 1.0 ELSE 0.0 END)
    ELSE NULL
  END AS health_count,
  CASE
    WHEN count() > 0 THEN
      sum(CASE WHEN ((game.dwd_cloudgame_game_vminfo_v2_inc.vm_status <> '1-外部调度'
          OR game.dwd_cloudgame_game_vminfo_v2_inc.vm_status IS NULL)
        OR (game.dwd_cloudgame_game_vminfo_v2_inc.os_state <> '2-健康可用'
          OR game.dwd_cloudgame_game_vminfo_v2_inc.os_state IS NULL)) THEN 1.0 ELSE 0.0 END)
    ELSE NULL
  END AS abnormal_count
FROM game.dwd_cloudgame_game_vminfo_v2_inc
WHERE
  (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '70' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '381' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '10124' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '31180' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '369' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '379' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '402' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '404' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '18' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '32' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '372' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '354' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND (game.dwd_cloudgame_game_vminfo_v2_inc.project_id <> '387' OR game.dwd_cloudgame_game_vminfo_v2_inc.project_id IS NULL)
  AND game.dwd_cloudgame_game_vminfo_v2_inc.arch = 'X86'
  AND game.dwd_cloudgame_game_vminfo_v2_inc.resources_purpose = '订单资源'
  AND game.dwd_cloudgame_game_vminfo_v2_inc.dt >= toDate(now())
  AND game.dwd_cloudgame_game_vminfo_v2_inc.dt < toDate((CAST(now() AS timestamp) + INTERVAL 1 day))
  AND game.dwd_cloudgame_game_vminfo_v2_inc.fmt_ts >= toStartOfMinute(toDateTime((CAST(now() AS timestamp) + INTERVAL -1 minute)))
  AND game.dwd_cloudgame_game_vminfo_v2_inc.fmt_ts < toStartOfMinute(toDateTime(now()))
GROUP BY game.dwd_cloudgame_game_vminfo_v2_inc.project_id,
  game.dwd_cloudgame_game_vminfo_v2_inc.project_name
ORDER BY game.dwd_cloudgame_game_vminfo_v2_inc.project_id ASC,
  game.dwd_cloudgame_game_vminfo_v2_inc.project_name ASC`;
const INSTANCE_AVAILABILITY_7D_SQL = `SELECT
  dt,
  project_id,
  AVG(rt) AS avg_rt,
  round(AVG(numerator)) AS avg_numerator,
  round(AVG(denominator)) AS avg_denominator,
  round(MAX(denominator)) AS max_denominator
FROM
(
  SELECT
    dt,
    project_id,
    toStartOfMinute(fmt_ts) AS fmt_ts2,

    uniqIf(
      vmid,
      vm_status = '1-外部调度'
        AND os_state = '2-健康可用'
        AND resources_purpose = '订单资源'
    ) AS numerator,

    uniqIf(vmid, resources_purpose = '订单资源') AS denominator,

    numerator / nullIf(denominator, 0) AS rt

  FROM game.dwd_cloudgame_game_vminfo_v2_inc
  WHERE 1 = 1
    AND dt >= toDate(cast(now() as timestamp) + interval -7 day)
    AND dt < toDate(cast(now() as timestamp) + interval 1 day)
    AND project_id NOT IN ('70','381','10124','31180','369','379','402','404','18','32','372','354','387')
    AND arch = 'X86'
    AND resources_purpose = '订单资源'
    AND toHour(fmt_ts) >= 12

  GROUP BY dt, project_id, toStartOfMinute(fmt_ts)
) t

GROUP BY dt, project_id
ORDER BY dt, project_id`;

// 字节跳动（project_id=33）供应：与业务侧一致的 SQL（g_instance_id 按分钟、日维度 avg/max，12–20 点，dt 近 7 天）
const BYTE_DANCE_SUPPLY_7D_SQL = `SELECT
    dt,
    round(avg(cnt), 0) AS avg_count,
    max(cnt) AS max_count
FROM
(
    SELECT
        toDate(fmt_ts) AS dt,
        toStartOfMinute(toDateTime(\`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`fmt_ts\`)) AS fmt_ts,
        uniq(\`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`g_instance_id\`) AS cnt
    FROM \`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`
    WHERE (\`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`dt\` >= toDate((CAST(now() AS timestamp) + INTERVAL -7 day))
       AND \`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`dt\` < toDate((CAST(now() AS timestamp) + INTERVAL 1 day))
       AND \`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`project_id\` = '33'
       AND toHour(toDateTime(\`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`fmt_ts\`)) >= 12
       AND toHour(toDateTime(\`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`fmt_ts\`)) < 20)
    GROUP BY
        toDate(fmt_ts),
        toStartOfMinute(toDateTime(\`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`fmt_ts\`))
) t
GROUP BY dt
ORDER BY dt ASC`;

// 供应看板：全项目日 max/avg（vmid 按分钟 uniq，订单资源、12 点起，近 7 天；Metabase DB 默认 131）
const SUPPLY_VMID_7D_SQL = `SELECT
    dt,
    project_id,
    project_name,
    max(cnt) AS max_count,
    avg(cnt) AS avg_count
FROM
(
    SELECT
        dt,
        project_id,
        project_name,
        toStartOfMinute(toDateTime(fmt_ts)) AS ts_min,
        uniq(vmid) AS cnt
    FROM game.dwd_cloudgame_game_vminfo_v2_inc
    WHERE dt >= toDate(now() - INTERVAL 7 DAY)
      AND dt < toDate(now() + INTERVAL 1 DAY)
      AND resources_purpose = '订单资源'
      AND toHour(toDateTime(fmt_ts)) >= 12
    GROUP BY
        dt,
        project_id,
        project_name,
        ts_min
)
GROUP BY
    dt,
    project_id,
    project_name
ORDER BY
    dt DESC,
    project_id`;

// 原力环境供应：按 dt + biz_name + biz_type 的分钟计数，计算每日 max/avg（仅 12 点后）
const YUANLI_SUPPLY_7D_SQL = `SELECT
    dt AS \`日期\`,
    biz_name AS \`业务名称\`,
    biz_type AS \`业务类型\`,
    max(total_minute) AS \`总数最大值\`,
    avg(total_minute) AS \`总数平均值\`
FROM
(
    SELECT
        dt,
        biz_name,
        biz_type,
        toStartOfMinute(fmt_ts) AS minute_ts,
        count() AS total_minute
    FROM game.dwd_cloudgame_game_vminfo_inc
    WHERE
        dt >= today() - 7
        AND dt < today() + 1
        AND fmt_ts >= now() - toIntervalDay(7)
        AND toHour(fmt_ts) >= 12
    GROUP BY
        dt,
        biz_name,
        biz_type,
        minute_ts
)
GROUP BY
    dt,
    biz_name,
    biz_type
ORDER BY
    dt,
    biz_name;`;

// --- Metabase：供应看板订单（结算套餐 -> 项目 聚合所需原始数据）---
// dataset 返回列：
// - date：日期（YYYY-MM-DD 或 YYYY/MM/DD，后续统一转成 MM-DD）
// - id：结算套餐ID
// - max：plan_total（总订单数：包月+弹性）
// - max_2：plan_month_quantity（包月）
// - max_3：plan_day_quantity（弹性）
const METABASE_SUPPLY_ORDERS_DB_ID = 159;
const METABASE_SQL_SUPPLY_ORDERS_7D_BY_SETTLEMENT = `
SELECT
  coms_purchase_order_settlement_view.date AS date,
  coms_purchase_order_settlement_view.id AS id,
  max(coms_purchase_order_settlement_view.plan_total) AS max,
  max(coms_purchase_order_settlement_view.plan_month_quantity) AS max_2,
  max(coms_purchase_order_settlement_view.plan_day_quantity) AS max_3
FROM coms_purchase_order_settlement_view
WHERE
  (
    (coms_purchase_order_settlement_view.customer_id <> 'CTEST' OR coms_purchase_order_settlement_view.customer_id IS NULL)
    AND coms_purchase_order_settlement_view.date >= date_sub(curdate(), interval 7 day)
    AND coms_purchase_order_settlement_view.date < date_add(curdate(), interval 1 day)
    AND coms_purchase_order_settlement_view.resource_type = 'x86'
  )
GROUP BY
  coms_purchase_order_settlement_view.date,
  coms_purchase_order_settlement_view.id
ORDER BY
  coms_purchase_order_settlement_view.date ASC,
  coms_purchase_order_settlement_view.id ASC`;

const CLOUD_TASK_LIVE_DB_ID = Number(
  import.meta.env.VITE_METABASE_CLOUD_TASK_DEPLOY_DB_ID || 97,
);
const CLOUD_TASK_DURATION_SQL_TEMPLATE = `SELECT
    dt,
    idcId,
    idcName,
    REPLACE(REPLACE(projectId, '[', ''), ']', '') AS projectId,
    AVG(TIMESTAMPDIFF(SECOND, started_at, ended_at)) AS avg_duration,
    MAX(TIMESTAMPDIFF(SECOND, started_at, ended_at)) AS max_duration,
    MIN(TIMESTAMPDIFF(SECOND, started_at, ended_at)) AS min_duration
FROM dwd_cgboss_task_info_1d
WHERE dt >= date(date_add(now(6), INTERVAL -7 day))
  AND dt < date(date_add(now(6), INTERVAL 1 day))
  AND pstage = '__PSTAGE__'
  AND started_at IS NOT NULL
  AND ended_at IS NOT NULL
  AND ended_at > started_at
GROUP BY
    dt,
    idcId,
    idcName,
    REPLACE(REPLACE(projectId, '[', ''), ']', '')
ORDER BY
    dt,
    idcId,
    projectId;`;

const CLOUD_TASK_SUCCESS_SQL_TEMPLATE = `SELECT
    dt,
    idcId,
    REPLACE(REPLACE(projectId, '[', ''), ']', '') AS projectId,
    SUM(CASE WHEN status = __SUCCESS_STATUS__ THEN 1 ELSE 0 END) AS success_cnt,
    SUM(CASE WHEN status = __FAIL_STATUS__ THEN 1 ELSE 0 END) AS fail_cnt,
    SUM(CASE WHEN status IN (__SUCCESS_STATUS__, __FAIL_STATUS__) THEN 1 ELSE 0 END) AS total_cnt,
    SUM(CASE WHEN status = __SUCCESS_STATUS__ THEN 1 ELSE 0 END) * 1.0
        / NULLIF(SUM(CASE WHEN status IN (__SUCCESS_STATUS__, __FAIL_STATUS__) THEN 1 ELSE 0 END), 0) AS success_rate,
    SUM(CASE WHEN status = __FAIL_STATUS__ THEN 1 ELSE 0 END) * 1.0
        / NULLIF(SUM(CASE WHEN status IN (__SUCCESS_STATUS__, __FAIL_STATUS__) THEN 1 ELSE 0 END), 0) AS fail_rate
FROM dwd_cgboss_task_info_1d
WHERE dt >= date(date_add(now(6), INTERVAL -7 day))
  AND dt < date(date_add(now(6), INTERVAL 1 day))
  AND pstage = '__PSTAGE__'
GROUP BY
    dt,
    idcId,
    REPLACE(REPLACE(projectId, '[', ''), ']', '')
ORDER BY
    dt,
    idcId,
    projectId;`;

/** 各阶段成功/失败 status；未单独说明的阶段暂沿用部署口径 231/232 */
const CLOUD_TASK_LIVE_PHASE_CONFIGS = [
  { phaseId: 'deploy', pstage: 'psDeploy', successStatus: 231, failStatus: 232 },
  { phaseId: 'accelerate', pstage: 'psBoost', successStatus: 291, failStatus: 292 },
  { phaseId: 'disk-mount', pstage: 'psAttach', successStatus: 231, failStatus: 232 },
  { phaseId: 'disk-dispatch', pstage: 'psDispatch', successStatus: 231, failStatus: 232 },
];

function cloudTaskSqlForStage(template, pstage) {
  return String(template || '').replace(/__PSTAGE__/g, pstage);
}

function cloudTaskSuccessSql(template, { pstage, successStatus, failStatus }) {
  return String(template || '')
    .replace(/__PSTAGE__/g, pstage)
    .replace(/__SUCCESS_STATUS__/g, String(successStatus))
    .replace(/__FAIL_STATUS__/g, String(failStatus));
}

/** 从大表拉失败子任务行，用于主任务 ID + VMID 明细（与阶段失败 status 一致） */
const CLOUD_TASK_FAILURE_DETAIL_ROW_LIMIT = 20000;
const CLOUD_TASK_FAILURE_DETAIL_SQL_TEMPLATE = `SELECT
    pitem_id,
    vmId,
    idcId
FROM dwd_cgboss_task_info_1d
WHERE dt >= date(date_add(now(6), INTERVAL -__PERIOD_DAYS__ day))
  AND dt < date(date_add(now(6), INTERVAL 1 day))
  AND pstage = '__PSTAGE__'
  AND status = __FAIL_STATUS__
  __PROJECT_PREDICATE__
  __IDC_PREDICATE__
ORDER BY
    pitem_id,
    vmId
LIMIT __ROW_LIMIT__`;

function cloudTaskFailureDetailSql(template, { periodDays, pstage, failStatus, projectId, idcId }) {
  const days = Math.max(1, Math.min(90, Number(periodDays) || 7));
  const pid = String(projectId ?? 'all').trim();
  const projectPredicate =
    pid === 'all'
      ? 'AND 1 = 1'
      : /^\d+$/.test(pid)
        ? `AND FIND_IN_SET('${pid}', REPLACE(REPLACE(REPLACE(IFNULL(projectId, ''), '[', ''), ']', ''), ' ', '')) > 0`
        : 'AND 1 = 0';
  const idc = String(idcId ?? '').trim();
  const idcPredicate =
    idc && /^[a-zA-Z0-9\-_.]+$/.test(idc)
      ? `AND idcId = '${idc.replace(/'/g, "''")}'`
      : 'AND 1 = 1';
  return String(template || '')
    .replace(/__PERIOD_DAYS__/g, String(days))
    .replace(/__PSTAGE__/g, pstage)
    .replace(/__FAIL_STATUS__/g, String(failStatus))
    .replace(/__PROJECT_PREDICATE__/g, projectPredicate)
    .replace(/__IDC_PREDICATE__/g, idcPredicate)
    .replace(/__ROW_LIMIT__/g, String(CLOUD_TASK_FAILURE_DETAIL_ROW_LIMIT));
}

function parseCloudTaskFailureDetailDataset(ds) {
  const cols = ds?.data?.cols ?? [];
  const rows = ds?.data?.rows ?? [];
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const findIdx = (keys) => {
    const nkeys = keys.map(norm);
    for (let i = 0; i < cols.length; i += 1) {
      const name = norm(cols[i]?.name ?? cols[i]?.display_name ?? '');
      if (!name) continue;
      if (nkeys.some((k) => name.includes(k))) return i;
    }
    return -1;
  };
  const iPitem = findIdx(['pitem_id', 'pitemid']);
  const iVm = findIdx(['vmid', 'vm_id']);
  if (iPitem === -1) return [];

  return rows.map((r) => ({
    pitemId: String(iPitem === -1 ? '' : r[iPitem] ?? '').trim(),
    vmIdRaw: iVm === -1 ? '' : r[iVm],
  }));
}

function splitVmIdTokens(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  return s
    .split(/[,\s|;/，、]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function aggregateCloudTaskFailuresByPitem(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    const pkey = r.pitemId || '(空)';
    if (!map.has(pkey)) {
      map.set(pkey, { pitemId: pkey, vmIds: new Set() });
    }
    const rec = map.get(pkey);
    splitVmIdTokens(r.vmIdRaw).forEach((v) => rec.vmIds.add(v));
  });
  return Array.from(map.values())
    .map((rec) => ({
      pitemId: rec.pitemId,
      vmText: Array.from(rec.vmIds).join('，'),
    }))
    .sort((a, b) => String(a.pitemId).localeCompare(String(b.pitemId), 'zh-CN'));
}

function getCloudLivePhaseConfig(phaseId) {
  return CLOUD_TASK_LIVE_PHASE_CONFIGS.find((c) => c.phaseId === phaseId) || null;
}

const INSTANCE_CURRENT_DB_ID = Number(import.meta.env.VITE_METABASE_INSTANCE_CURRENT_DB_ID || 131);
const INSTANCE_AVAILABILITY_7D_DB_ID = Number(import.meta.env.VITE_METABASE_INSTANCE_AVAILABILITY_7D_DB_ID || 131);
const METABASE_BYTE_DANCE_SUPPLY_7D_DB_ID = Number(
  import.meta.env.VITE_METABASE_BYTE_DANCE_SUPPLY_7D_DB_ID || 131,
);
const METABASE_SUPPLY_VMID_7D_DB_ID = Number(
  import.meta.env.VITE_METABASE_SUPPLY_VMID_7D_DB_ID || 131,
);
/** 原力 Metabase：仅「原力供应」vminfo_inc SQL；订单与自建同源（自建 token + METABASE_SUPPLY_ORDERS_DB_ID） */
const METABASE_YUANLI_DB_ID = Number(
  import.meta.env.VITE_YUANLI_METABASE_DB_ID ||
    import.meta.env.VITE_YUANLI_METABASE_SUPPLY_DB_ID ||
    import.meta.env.VITE_YUANLI_METABASE_SUPPLY_ORDERS_DB_ID ||
    2,
);

const instanceTopProjects = [
  {
    id: 68,
    name: '燕云十六声',
    volatility: '6.3%',
    health: 4520,
    total: 4784,
    avail: '94.5%',
    trend: generateTrendData(7, 95, 4),
    high: '97.5%',
    low: '91.2%',
    table: [
      { date: '2026-04-02', avail: '96.87', health: 4438, total: 4581 },
      { date: '2026-04-01', avail: '91.22', health: 5353, total: 5846 },
      { date: '2026-03-31', avail: '97.53', health: 6088, total: 6242 },
      { date: '2026-03-30', avail: '97.09', health: 6063, total: 6245 },
    ],
  },
  {
    id: 33,
    name: '字节跳动',
    volatility: '1.1%',
    health: 948,
    total: 948,
    avail: '100.0%',
    trend: generateTrendData(7, 96, 2),
    high: '95.3%',
    low: '94.2%',
    table: [
      { date: '2026-04-02', avail: '94.77', health: 2268, total: 2393 },
      { date: '2026-04-01', avail: '95.32', health: 2422, total: 2541 },
      { date: '2026-03-31', avail: '94.22', health: 2450, total: 2600 },
      { date: '2026-03-30', avail: '95.27', health: 2480, total: 2603 },
    ],
  },
];

// --- 共享组件 (Shared Components) ---
const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden ${className}`}>{children}</div>
);

const TrendBadge = ({ value, isPositive = true }) => (
  <span
    className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
      isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
    }`}
  >
    {isPositive ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
    {value}
  </span>
);

const FilterBar = memo(function FilterBar({ projects, selectedProjectIds, setSelectedProjectIds, loading = false }) {
  const [keyword, setKeyword] = useState('');
  const [open, setOpen] = useState(false);

  const q = keyword.trim().toLowerCase();
  const selectedSet = new Set((selectedProjectIds || []).map((x) => String(x)));

  const options = (() => {
    if (!Array.isArray(projects) || projects.length === 0) return [];
    const base = !q
      ? projects
      : projects.filter((p) => {
          const idStr = String(p.id);
          return idStr.toLowerCase().includes(q) || String(p.name ?? '').toLowerCase().includes(q);
        });
    return base.slice(0, 20);
  })();

  const toggle = (id) => {
    const idStr = String(id);
    setSelectedProjectIds((prev) => {
      const prevArr = Array.isArray(prev) ? prev : [];
      return prevArr.map(String).includes(idStr) ? prevArr.filter((x) => String(x) !== idStr) : [...prevArr, idStr];
    });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between mb-6 bg-white p-3 rounded-xl shadow-sm border border-slate-100">
      <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:flex-wrap">
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" aria-hidden />
            加载中
          </span>
        ) : null}
        <div className="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-200">
          <span className="px-3 py-1 text-sm text-slate-500 font-medium">项目</span>
          <button
            type="button"
            onClick={() => setSelectedProjectIds([])}
            className="flex items-center gap-2 bg-white px-3 py-1 rounded shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            全部 <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="relative w-full sm:w-auto">
          <input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            type="text"
            placeholder="搜索项目（可输入ID/名称）..."
            className="w-full sm:w-64 pl-3 pr-10 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
          />

          {open && options.length > 0 && (
            <div className="absolute left-0 top-full mt-2 z-50 w-full sm:w-72 max-h-64 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="px-3 py-2 text-[11px] font-bold text-slate-400 border-b border-slate-100">
                下拉搜索结果（点击选择）
              </div>
              {options.map((p) => {
                const active = selectedSet.has(String(p.id));
                return (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(p.id)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      active ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold truncate">{p.name}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">{p.id}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {open && options.length === 0 && (
            <div className="absolute left-0 top-full mt-2 z-50 w-full sm:w-72 rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="px-3 py-3 text-[12px] text-slate-400 font-bold">无匹配项目</div>
            </div>
          )}
        </div>
      </div>

      {selectedProjectIds?.length > 0 ? (
        <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
          已选 {selectedProjectIds.length} 个
        </span>
      ) : (
        <div className="hidden sm:block" />
      )}
    </div>
  );
});

const SUPPLY_CARD_ACCENT_PALETTES = [
  { border: 'border-slate-200', chip: 'bg-black text-white', chart: '#000000' },
  { border: 'border-slate-200', chip: 'bg-white text-black border border-slate-200', chart: '#000000' },
  { border: 'border-slate-200', chip: 'bg-black text-white', chart: '#000000' },
  { border: 'border-slate-200', chip: 'bg-white text-black border border-slate-200', chart: '#000000' },
  { border: 'border-slate-200', chip: 'bg-black text-white', chart: '#000000' },
];

const SupplyProjectCard = memo(function SupplyProjectCard({
  proj,
  isExpanded,
  onToggle,
  useApiProp,
  supplyFetchPending,
}) {
  const hasSupplyNum = typeof proj.supply === 'number' && Number.isFinite(proj.supply);
  const vmidStillLoading = useApiProp && supplyFetchPending && !hasSupplyNum;
  const chartAwaitingSeries =
    vmidStillLoading && (!Array.isArray(proj.trend) || proj.trend.length === 0);
  const marginPct =
    hasSupplyNum && typeof proj.order === 'number' && proj.order > 0
      ? ((proj.supply - proj.order) / proj.order) * 100
      : 0;
  const redundancyAlertCard = marginPct > 5 || marginPct < 0;
  const values = Array.isArray(proj.trend) ? proj.trend.map((d) => d.value) : [];
  const current = values.length ? values[values.length - 1] : 0;
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;

  const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const tone = (v) => {
    const bad = v > 5 || v < 0;
    return bad ? 'text-rose-600' : 'text-emerald-600';
  };
  const pillBg = (v) => {
    const bad = v > 5 || v < 0;
    return bad ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600';
  };
  const marginChipClass = redundancyAlertCard
    ? 'bg-rose-50 text-rose-700'
    : 'bg-emerald-50 text-emerald-700';
  const paletteSeed =
    Number(proj.mergedProjectIds?.[0] ?? String(proj.id).split('+')[0]) || 0;
  const palette =
    SUPPLY_CARD_ACCENT_PALETTES[Math.abs(paletteSeed) % SUPPLY_CARD_ACCENT_PALETTES.length] ||
    SUPPLY_CARD_ACCENT_PALETTES[0];

  return (
    <Card
      className={`p-4 flex flex-col hover:shadow-md transition-shadow contain-layout [content-visibility:auto] ${palette.border}`}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-base font-bold text-slate-800">{proj.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{proj.sub || `项目 ID ${proj.id}`}</p>
        </div>
        <div className="text-right">
          <span className={`text-xs px-2 py-1 rounded font-medium ${marginChipClass}`}>
            冗余 {fmtPct(marginPct)}
          </span>
        </div>
      </div>

      <div className="flex items-baseline gap-2 flex-wrap mb-4 text-sm text-slate-600">
        <span className="text-slate-500">{proj.unit === '卡' ? '峰值（卡）' : '峰值（路）'}</span>
        {proj.supplyHeadlineDate ? (
          <span className="text-slate-400 tabular-nums">{proj.supplyHeadlineDate}</span>
        ) : null}
        <strong className="text-slate-900 text-lg tabular-nums inline-flex items-center gap-1.5">
          {hasSupplyNum ? (
            proj.supply
          ) : vmidStillLoading ? (
            <>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" aria-hidden />
              <span className="text-slate-400 font-semibold">—</span>
            </>
          ) : (
            '—'
          )}
        </strong>
        <span className="text-slate-300">|</span>
        <span className="text-slate-500">订单</span>
        <strong className="text-slate-900 text-lg tabular-nums">{proj.order}</strong>
      </div>

      <div className="h-28 w-full mb-4">
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span className="inline-flex items-center gap-1">
            近7天冗余率 (%)
            {useApiProp && supplyFetchPending ? (
              <Loader2 className="h-3 w-3 animate-spin text-blue-400" aria-hidden />
            ) : null}
          </span>
        </div>
        {chartAwaitingSeries ? (
          <div className="flex h-full min-h-[7rem] flex-col items-center justify-center gap-2 rounded-lg border border-slate-100 bg-slate-50/90 text-[11px] text-slate-500">
            <Loader2 className="h-7 w-7 animate-spin text-blue-500" aria-hidden />
            <span>曲线随供应数据返回后显示</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={proj.trend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                dy={8}
                minTickGap={18}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                dx={-10}
                width={44}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                labelStyle={{ color: '#64748b', marginBottom: '4px' }}
                formatter={(value) => [`${Number(value).toFixed(1)}%`, '冗余率']}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#0a72ef"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs mb-3 flex-wrap">
        <span className={`px-2 py-0.5 rounded font-medium ${pillBg(current)}`}>当前 {fmtPct(current)}</span>
        <span className="text-slate-500">
          高 <strong className={tone(max)}>{fmtPct(max)}</strong>
        </span>
        <span className="text-slate-500">
          低 <strong className={tone(min)}>{fmtPct(min)}</strong>
        </span>
      </div>

      <button
        type="button"
        onClick={() => onToggle(proj.id)}
        className="inline-flex items-center gap-1 self-start mb-2 rounded-md bg-white text-[#171717] border border-slate-200 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-50"
      >
        {isExpanded ? (
          <>
            收起表格 <ChevronUp className="w-4 h-4 ml-0.5" />
          </>
        ) : (
          <>
            展开表格 <ChevronDown className="w-4 h-4 ml-0.5" />
          </>
        )}
      </button>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="pb-3 font-medium">日期</th>
                <th className="pb-3 font-medium">供应最大 ({proj.unit})</th>
                <th className="pb-3 font-medium">供应平均 ({proj.unit})</th>
                <th className="pb-3 font-medium">订单 ({proj.unit})</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {(proj.table || []).map((row, idx) => (
                <tr key={idx} className="border-t border-slate-50">
                  <td className="py-3 font-medium">{row.date}</td>
                  <td className="py-3">{row.max}</td>
                  <td className="py-3">{row.avg}</td>
                  <td className="py-3">{row.order}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
});

// --- 视图组件 (Views based on images) ---
// 1. 供应看板 (Supply Dashboard)
const SupplyView = ({
  projectsToShow,
  supplyFetchPending = false,
  supplyEnv,
  setSupplyEnv,
  useApi: useApiProp = false,
  yuanliMetabaseConfigured = false,
}) => {
  const [expanded, setExpanded] = useState({});
  const toggleExpand = useCallback((id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const list =
    Array.isArray(projectsToShow) && projectsToShow.length > 0
      ? projectsToShow
      : supplyEnv === SUPPLY_ENV_YUANLI || useApiProp
        ? []
        : projects;
  const totalSupply = list.reduce((sum, p) => sum + (typeof p.supply === 'number' ? p.supply : 0), 0);
  const totalOrders = list.reduce((sum, p) => sum + (typeof p.order === 'number' ? p.order : 0), 0);
  const redundancyRatio =
    totalOrders > 0 ? ((totalSupply - totalOrders) / totalOrders) * 100 : 0;
  /** 与卡片一致：冗余率 >5% 或供应低于订单（负数）标红，否则标绿 */
  const overviewRedundancyAlert = redundancyRatio > 5 || redundancyRatio < 0;

  const onEnv = typeof setSupplyEnv === 'function' ? setSupplyEnv : () => {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEnv(SUPPLY_ENV_PAAS)}
          className={`rounded-full px-4 py-2 text-sm font-medium border transition-colors ${
            supplyEnv === SUPPLY_ENV_PAAS
              ? 'bg-[#171717] text-white'
              : 'bg-white text-[#171717] border-slate-200 hover:bg-slate-50'
          }`}
        >
          自建 PAAS
        </button>
        <button
          type="button"
          onClick={() => onEnv(SUPPLY_ENV_YUANLI)}
          className={`rounded-full px-4 py-2 text-sm font-medium border transition-colors ${
            supplyEnv === SUPPLY_ENV_YUANLI
              ? 'bg-[#171717] text-white'
              : 'bg-white text-[#171717] border-slate-200 hover:bg-slate-50'
          }`}
        >
          原力环境
        </button>
      </div>

      {useApiProp && supplyFetchPending && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-black" aria-hidden />
          <span>近 7 天 Metabase 取数中，订单会先出、供应峰值与曲线随后补齐。</span>
        </div>
      )}

      {useApiProp && supplyEnv === SUPPLY_ENV_YUANLI && !yuanliMetabaseConfigured && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 leading-relaxed">
          <strong className="font-semibold">原力供应未配置</strong>：在{' '}
          <span className="font-mono text-xs">.env</span> 填写{' '}
          <span className="font-mono text-xs">VITE_YUANLI_METABASE_SESSION_TOKEN</span>（或用户名+密码）及{' '}
          <span className="font-mono text-xs">VITE_YUANLI_METABASE_DB_ID</span>，重启 dev。订单仍用自建{' '}
          <span className="font-mono text-xs">VITE_METABASE_*</span>。
        </div>
      )}

      {useApiProp &&
        supplyEnv === SUPPLY_ENV_YUANLI &&
        yuanliMetabaseConfigured &&
        !supplyFetchPending &&
        Array.isArray(projectsToShow) &&
        projectsToShow.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 leading-relaxed">
            原力供应接口已配置，但当前<strong>没有拼出任何卡片</strong>（或自建订单/原力供应解析为空）。订单走{' '}
            <span className="font-mono text-xs">/api/metabase</span>，供应走{' '}
            <span className="font-mono text-xs">/api/metabase-yl</span> — 请在 Network 里分别看是否报错。
          </div>
        )}

      <details className="group rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2 text-xs text-slate-600 leading-relaxed open:pb-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 font-semibold text-slate-700 select-none [&::-webkit-details-marker]:hidden">
          <span>数据计算说明</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 marker:text-slate-400">
          <li>
            <strong className="text-slate-700">原力</strong>：订单与自建同一 Metabase；仅结算套餐→项目用原力映射。供应走原力 CH（
            <span className="font-mono text-[11px]">vminfo_inc</span>，12 点起），展示名用业务名称。
          </li>
          <li>
            <strong className="text-slate-700">自建供应</strong>：近 7 天 vmid 峰值/均值；字节 33 单独口径。
          </li>
          <li>
            <strong className="text-slate-700">订单</strong>：结算表 x86、去 CTEST；无映射套餐不出卡。
          </li>
          <li>
            <strong className="text-slate-700">冗余</strong>：相对订单；高于 5% 或供应低于订单标红。
          </li>
        </ul>
      </details>

      {/* 顶部总览卡片 */}
      <Card className="p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h2 className="text-sm font-medium text-slate-500 mb-2 flex flex-wrap items-center gap-2">
              <Layers className="w-4 h-4 shrink-0" />
              <span>供应监控冗余</span>
              {useApiProp && supplyFetchPending ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  近7天
                </span>
              ) : null}
            </h2>
            <div className="flex items-baseline gap-4 flex-wrap">
              <span className="text-5xl font-bold text-slate-900 tracking-tight">
                {redundancyRatio.toFixed(1)}
                <span className="text-3xl">%</span>
              </span>
              <TrendBadge
                value={`合计 峰值 ${totalSupply} / 订单 ${totalOrders}`}
                isPositive={!overviewRedundancyAlert}
              />
            </div>
          </div>

          <div className="w-full md:w-auto flex flex-col sm:flex-row gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100 sm:min-w-[300px]">
            <div className="flex-1">
              <p className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
                供应峰值（各卡最近一日）
                {useApiProp && supplyFetchPending ? (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-500" aria-hidden />
                ) : null}
              </p>
              <p className="text-xl font-semibold text-slate-700">{totalSupply.toLocaleString()}</p>
            </div>
            <div className="h-px sm:h-auto sm:w-px bg-slate-200" />
            <div className="flex-1">
              <p className="text-xs text-slate-400 mb-1">订单（同上日）</p>
              <p className="text-xl font-semibold text-slate-700">{totalOrders.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* 项目栅格：保证 100% 缩放下也尽量看得到 3 列 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.length === 0 && supplyFetchPending ? (
          <Card className="col-span-full border border-dashed border-slate-200 bg-slate-50/80 py-16">
            <div className="flex flex-col items-center justify-center gap-3 text-slate-600">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600" aria-hidden />
              <p className="text-sm font-medium">正在拉取近 7 天订单与供应…</p>
              <p className="text-xs text-slate-500">先出订单与卡片框架，CH/vmid 返回后自动刷新峰值与曲线。</p>
            </div>
          </Card>
        ) : null}
        {list.map((proj) => (
          <SupplyProjectCard
            key={proj.id}
            proj={proj}
            isExpanded={!!expanded[proj.id]}
            onToggle={toggleExpand}
            useApiProp={useApiProp}
            supplyFetchPending={supplyFetchPending}
          />
        ))}
      </div>
    </div>
  );
};

// 2. 调度与体验 (Scheduling)
const SchedulingView = () => (
  <div className="space-y-6">
    <Card className="p-0">
      <div className="flex border-b border-slate-100 bg-slate-50/50 p-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-blue-600">
          <Users className="w-5 h-5" /> 调度与体验
        </h2>
      </div>
      <div className="flex flex-col lg:flex-row p-6 lg:p-8 gap-8">
        {/* 左侧大数字 */}
        <div className="lg:w-1/3 flex flex-col justify-center">
          <p className="text-sm font-medium text-slate-500 mb-2">排队最大人数</p>
          <div className="text-5xl sm:text-6xl lg:text-7xl font-black text-slate-900 tracking-tighter mb-6">658</div>

          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-600 px-3 py-2 rounded-lg text-sm font-medium w-fit border border-emerald-100">
            <Activity className="w-4 h-4" /> 峰值时间: 04-01 14:40
          </div>
        </div>

        {/* 右侧面积图 */}
        <div className="lg:w-2/3 h-[280px] sm:h-[340px] lg:h-[400px]">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm font-medium text-slate-500">近24小时排队趋势</p>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={queueData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#000000" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#000000" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                dy={10}
                minTickGap={30}
              />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} dx={-10} />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: 'none',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
                labelStyle={{ color: '#64748b', marginBottom: '4px' }}
              />
              <Area type="monotone" dataKey="users" stroke="#0a72ef" strokeWidth={2.5} fillOpacity={1} fill="url(#colorUsers)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  </div>
);

// 3. 游戏云化任务 (Cloudification Tasks)
const CloudTaskView = ({ liveRowsByPhase = {}, projectNameOptions = [] }) => {
  const phaseList = useMemo(() => {
    const liveOnly = CLOUD_TASK_PHASES
      .filter((phase) => CLOUD_TASK_LIVE_PHASE_CONFIGS.some((cfg) => cfg.phaseId === phase.id))
      .map((phase) => {
        const phaseRows = Array.isArray(liveRowsByPhase?.[phase.id]) ? liveRowsByPhase[phase.id] : [];
        const durationRows = phaseRows.filter((r) => Number.isFinite(r?.avgDuration));
        const successRows = phaseRows.filter(
          (r) => Number.isFinite(r?.totalCnt) && r.totalCnt > 0,
        );
        if (durationRows.length === 0) return null;

        const totalTasks = successRows.reduce((s, r) => s + r.totalCnt, 0);
        const successTasks = successRows.reduce(
          (s, r) => s + (Number.isFinite(r.successCnt) ? r.successCnt : 0),
          0,
        );
        const weightedAvg =
          durationRows.reduce((s, r) => s + r.avgDuration, 0) /
          Math.max(durationRows.length, 1);

        const maxDuration = durationRows.reduce(
          (max, r) => Math.max(max, Number.isFinite(r.maxDuration) ? r.maxDuration : 0),
          0,
        );
        const minDuration = durationRows.reduce((min, r) => {
          if (!Number.isFinite(r.minDuration)) return min;
          return Math.min(min, r.minDuration);
        }, Number.MAX_SAFE_INTEGER);

        return {
          ...phase,
          aliases: `${phase.aliases}（实时）`,
          dataSource: 'live',
          liveRows: phaseRows,
          totalTasks,
          avgDuration: Number(weightedAvg.toFixed(1)),
          successRate: Number(((successTasks / Math.max(totalTasks, 1)) * 100).toFixed(2)),
          maxDuration: Number(maxDuration.toFixed(1)),
          minDuration: Number(
            (minDuration === Number.MAX_SAFE_INTEGER ? phase.avgDuration : minDuration).toFixed(1),
          ),
        };
      })
      .filter(Boolean);

    const deployFirst = liveOnly.find((p) => p.id === 'deploy');
    const others = liveOnly.filter((p) => p.id !== 'deploy');
    return deployFirst ? [deployFirst, ...others] : liveOnly;
  }, [liveRowsByPhase]);
  const cloudProjectOptions = useMemo(() => {
    const map = new Map();
    (projectNameOptions || []).forEach((p) => {
      const pid = String(p?.id ?? '').trim();
      const pname = String(p?.name ?? '').trim();
      if (!pid) return;
      map.set(pid, pname ? `${pname} (${pid})` : `项目 ${pid}`);
    });
    projects.forEach((p) => {
      const pid = String(p.id);
      if (!map.has(pid)) map.set(pid, `${p.name} (${pid})`);
    });
    Object.values(liveRowsByPhase || {}).forEach((rows) => {
      (rows || []).forEach((r) => {
        splitProjectIdTokens(r?.projectId).forEach((pid) => {
          if (!pid || map.has(pid)) return;
          map.set(pid, `项目 ${pid}`);
        });
      });
    });
    return [
      { id: 'all', label: '全部项目' },
      ...Array.from(map.entries()).map(([id, label]) => ({ id, label })),
    ];
  }, [liveRowsByPhase, projectNameOptions]);
  const phaseProjectOptions = useMemo(() => {
    const nameMap = new Map();
    (projectNameOptions || []).forEach((p) => {
      const pid = String(p?.id ?? '').trim();
      const pname = String(p?.name ?? '').trim();
      if (pid) nameMap.set(pid, pname || `项目 ${pid}`);
    });
    projects.forEach((p) => {
      const pid = String(p?.id ?? '').trim();
      if (pid && !nameMap.has(pid)) nameMap.set(pid, p.name || `项目 ${pid}`);
    });

    const optionsMap = {};
    Object.entries(liveRowsByPhase || {}).forEach(([phaseId, rows]) => {
      const map = new Map();
      (rows || []).forEach((r) => {
        const successCnt = Number(r?.successCnt ?? 0);
        if (!Number.isFinite(successCnt) || successCnt <= 0) return;
        splitProjectIdTokens(r?.projectId).forEach((pid) => {
          if (!pid || map.has(pid)) return;
          map.set(pid, `${nameMap.get(pid) || `项目 ${pid}`} (${pid})`);
        });
      });
      const list = Array.from(map.entries())
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh-CN'));
      optionsMap[phaseId] = [{ id: 'all', label: '全部项目' }, ...list];
    });
    return optionsMap;
  }, [liveRowsByPhase, projectNameOptions]);
  const [phaseFilters, setPhaseFilters] = useState(() =>
    Object.fromEntries(
      phaseList.map((phase) => [
        phase.id,
        { projectId: 'all', gameSetId: 'all', periodDays: '7' },
      ]),
    ),
  );
  const [phaseSorters, setPhaseSorters] = useState(() =>
    Object.fromEntries(
      phaseList.map((phase) => [phase.id, { key: 'avgDuration', order: 'desc' }]),
    ),
  );
  const [expandedPhaseIds, setExpandedPhaseIds] = useState(() =>
    phaseList.length ? [phaseList[0].id] : [],
  );

  const [failureDetailModal, setFailureDetailModal] = useState({
    open: false,
    phaseId: null,
    phaseTitle: '',
    idcId: null,
    loading: false,
    error: null,
    groups: [],
    truncated: false,
  });

  const closeFailureDetailModal = useCallback(() => {
    setFailureDetailModal({
      open: false,
      phaseId: null,
      phaseTitle: '',
      idcId: null,
      loading: false,
      error: null,
      groups: [],
      truncated: false,
    });
  }, []);

  const loadFailureDetails = useCallback(
    async (phaseId, idcIdOpt) => {
      if (!useApi) return;
      const cfg = getCloudLivePhaseConfig(phaseId);
      if (!cfg) return;
      const filter = phaseFilters[phaseId] || {
        projectId: 'all',
        gameSetId: 'all',
        periodDays: '7',
      };
      const phaseMeta = phaseList.find((p) => p.id === phaseId);
      setFailureDetailModal({
        open: true,
        phaseId,
        phaseTitle: phaseMeta?.title ?? phaseId,
        idcId: idcIdOpt || null,
        loading: true,
        error: null,
        groups: [],
        truncated: false,
      });
      try {
        const sql = cloudTaskFailureDetailSql(CLOUD_TASK_FAILURE_DETAIL_SQL_TEMPLATE, {
          periodDays: filter.periodDays,
          pstage: cfg.pstage,
          failStatus: cfg.failStatus,
          projectId: filter.projectId,
          idcId: idcIdOpt,
        });
        const ds = await queryMetabaseNative({
          database: CLOUD_TASK_LIVE_DB_ID,
          query: sql,
          audience: SUPPLY_ENV_PAAS,
        });
        const raw = parseCloudTaskFailureDetailDataset(ds);
        const groups = aggregateCloudTaskFailuresByPitem(raw);
        setFailureDetailModal((m) => ({
          ...m,
          loading: false,
          groups,
          truncated: raw.length >= CLOUD_TASK_FAILURE_DETAIL_ROW_LIMIT,
        }));
      } catch (e) {
        console.warn('[云化任务] 失败明细查询失败', e);
        setFailureDetailModal((m) => ({
          ...m,
          loading: false,
          error: e?.message || String(e),
        }));
      }
    },
    [phaseFilters, phaseList],
  );

  const updatePhaseFilter = useCallback((phaseId, key, value) => {
    setPhaseFilters((prev) => ({
      ...prev,
      [phaseId]: {
        ...(prev[phaseId] || {
          projectId: 'all',
          gameSetId: 'all',
          periodDays: '7',
        }),
        [key]: value,
      },
    }));
  }, []);
  const togglePhaseDetails = useCallback((phaseId) => {
    setExpandedPhaseIds((prev) =>
      prev.includes(phaseId) ? prev.filter((id) => id !== phaseId) : [...prev, phaseId],
    );
  }, []);
  const togglePhaseSort = useCallback((phaseId, sortKey) => {
    setPhaseSorters((prev) => {
      const cur = prev[phaseId] || { key: 'avgDuration', order: 'desc' };
      const nextOrder =
        cur.key === sortKey ? (cur.order === 'asc' ? 'desc' : 'asc') : 'desc';
      return {
        ...prev,
        [phaseId]: { key: sortKey, order: nextOrder },
      };
    });
  }, []);
  const renderSortLabel = useCallback(
    (phaseId, sortKey, label) => {
      const sorter = phaseSorters[phaseId] || { key: 'avgDuration', order: 'desc' };
      const active = sorter.key === sortKey;
      const arrow = active ? (sorter.order === 'asc' ? '↑' : '↓') : '';
      return (
        <span className={`inline-flex items-center gap-1 ${active ? 'text-[#171717]' : 'text-[#666666]'}`}>
          <span>{label}</span>
          <span className={`text-[10px] ${active ? 'text-[#171717]' : 'text-slate-300'}`}>{arrow || '·'}</span>
        </span>
      );
    },
    [phaseSorters],
  );

  const stageViews = useMemo(() => {
    return phaseList.map((phase) => {
      const filter = phaseFilters[phase.id] || {
        projectId: 'all',
        gameSetId: 'all',
        periodDays: '7',
      };
      const isLiveDeploy = phase.dataSource === 'live';
      const periodDays = Number(filter.periodDays || 7);

      if (isLiveDeploy) {
        const liveRows = Array.isArray(phase.liveRows) ? phase.liveRows : [];
        const rowsByProject =
          filter.projectId === 'all'
            ? liveRows
            : liveRows.filter((r) =>
                splitProjectIdTokens(r.projectId).includes(String(filter.projectId)),
              );
        const labels = buildRecentDayLabels(periodDays);
        const labelSet = new Set(labels);
        const durationRows = rowsByProject.filter(
          (r) =>
            labelSet.has(String(r.dt || '')) &&
            Number.isFinite(r.avgDuration),
        );
        const successRows = rowsByProject.filter(
          (r) =>
            labelSet.has(String(r.dt || '')) &&
            Number.isFinite(r.totalCnt) &&
            r.totalCnt > 0,
        );
        const totalTasks = successRows.reduce((s, r) => s + r.totalCnt, 0);
        const successTasks = successRows.reduce(
          (s, r) => s + (Number.isFinite(r.successCnt) ? r.successCnt : 0),
          0,
        );
        const successRate =
          totalTasks > 0 ? Number(((successTasks / totalTasks) * 100).toFixed(2)) : 0;
        const idcDurationAgg = {};
        durationRows.forEach((r) => {
          const idcKey = String(r.idcId || '未知机房');
          if (!idcDurationAgg[idcKey]) idcDurationAgg[idcKey] = { sum: 0, count: 0 };
          idcDurationAgg[idcKey].sum += r.avgDuration;
          idcDurationAgg[idcKey].count += 1;
        });
        const idcAvgDurations = Object.values(idcDurationAgg).map((rec) =>
          rec.count > 0 ? rec.sum / rec.count : 0,
        );
        const avgDuration =
          idcAvgDurations.length > 0
            ? Number(
                (
                  idcAvgDurations.reduce((s, v) => s + v, 0) /
                  idcAvgDurations.length
                ).toFixed(1),
              )
            : 0;
        const maxDuration = durationRows.reduce(
          (max, r) => Math.max(max, Number.isFinite(r.maxDuration) ? r.maxDuration : 0),
          0,
        );
        const minDurationRaw = durationRows.reduce((min, r) => {
          if (!Number.isFinite(r.minDuration)) return min;
          return Math.min(min, r.minDuration);
        }, Number.MAX_SAFE_INTEGER);
        const minDuration =
          minDurationRaw === Number.MAX_SAFE_INTEGER ? 0 : Number(minDurationRaw.toFixed(1));

        const byDay = {};
        durationRows.forEach((r) => {
          const day = String(r.dt || '');
          if (!day) return;
          if (!byDay[day]) {
            byDay[day] = {
              successCnt: 0,
              failCnt: 0,
              totalCnt: 0,
              idcDurationAgg: {},
            };
          }
          const idcKey = String(r.idcId || '未知机房');
          if (!byDay[day].idcDurationAgg[idcKey]) {
            byDay[day].idcDurationAgg[idcKey] = { sum: 0, count: 0 };
          }
          byDay[day].idcDurationAgg[idcKey].sum += r.avgDuration;
          byDay[day].idcDurationAgg[idcKey].count += 1;
        });
        successRows.forEach((r) => {
          const day = String(r.dt || '');
          if (!day) return;
          if (!byDay[day]) {
            byDay[day] = {
              successCnt: 0,
              failCnt: 0,
              totalCnt: 0,
              idcDurationAgg: {},
            };
          }
          byDay[day].successCnt += Number.isFinite(r.successCnt) ? r.successCnt : 0;
          byDay[day].failCnt += Number.isFinite(r.failCnt) ? r.failCnt : 0;
          byDay[day].totalCnt += Number.isFinite(r.totalCnt) ? r.totalCnt : 0;
        });
        const trend = labels.map((day) => {
          const rec = byDay[day];
          if (!rec) {
            return { time: day, successRate: 0, failRate: 0, avgDuration: 0 };
          }
          const daySuccessRate =
            rec.totalCnt > 0 ? (rec.successCnt / rec.totalCnt) * 100 : 0;
          const dayFailRate =
            rec.totalCnt > 0 ? (rec.failCnt / rec.totalCnt) * 100 : 0;
          const dayIdcAverages = Object.values(rec.idcDurationAgg).map((v) =>
            v.count > 0 ? v.sum / v.count : 0,
          );
          const dayAvgDuration =
            dayIdcAverages.length > 0
              ? dayIdcAverages.reduce((s, v) => s + v, 0) / dayIdcAverages.length
              : 0;
          return {
            time: day,
            successRate: Number(daySuccessRate.toFixed(2)),
            failRate: Number(dayFailRate.toFixed(2)),
            avgDuration: Number(dayAvgDuration.toFixed(1)),
          };
        });

        const roomAgg = {};
        durationRows.forEach((r) => {
          const roomId = String(r.idcId || '未知机房');
          const roomName = String(r.idcName || roomId || '未知机房');
          if (!roomAgg[roomId]) {
            roomAgg[roomId] = {
              roomId,
              roomName,
              tasks: 0,
              successCnt: 0,
              failCnt: 0,
              avgDurationSum: 0,
              durationCount: 0,
              maxDuration: 0,
              minDuration: Number.MAX_SAFE_INTEGER,
            };
          }
          roomAgg[roomId].roomName = roomName;
          roomAgg[roomId].avgDurationSum += r.avgDuration;
          roomAgg[roomId].durationCount += 1;
          roomAgg[roomId].maxDuration = Math.max(
            roomAgg[roomId].maxDuration,
            Number.isFinite(r.maxDuration) ? r.maxDuration : 0,
          );
          if (Number.isFinite(r.minDuration)) {
            roomAgg[roomId].minDuration = Math.min(roomAgg[roomId].minDuration, r.minDuration);
          }
        });
        successRows.forEach((r) => {
          const roomId = String(r.idcId || '未知机房');
          if (!roomAgg[roomId]) {
            roomAgg[roomId] = {
              roomId,
              roomName: roomId,
              tasks: 0,
              successCnt: 0,
              failCnt: 0,
              avgDurationSum: 0,
              durationCount: 0,
              maxDuration: 0,
              minDuration: Number.MAX_SAFE_INTEGER,
            };
          }
          roomAgg[roomId].tasks += Number.isFinite(r.totalCnt) ? r.totalCnt : 0;
          roomAgg[roomId].successCnt += Number.isFinite(r.successCnt) ? r.successCnt : 0;
          roomAgg[roomId].failCnt += Number.isFinite(r.failCnt) ? r.failCnt : 0;
        });
        let roomBreakdown = Object.values(roomAgg).map((rec) => {
          const roomSuccessRate = rec.tasks > 0 ? (rec.successCnt / rec.tasks) * 100 : 0;
          const roomFailRate = rec.tasks > 0 ? (rec.failCnt / rec.tasks) * 100 : 0;
          return {
            roomId: rec.roomId,
            roomName: rec.roomName,
            name: rec.roomName,
            tasks: rec.tasks,
            avgDuration:
              rec.durationCount > 0
                ? Number((rec.avgDurationSum / rec.durationCount).toFixed(1))
                : 0,
            successRate: Number(roomSuccessRate.toFixed(2)),
            failRate: Number(roomFailRate.toFixed(2)),
            successCnt: rec.successCnt,
            failCnt: rec.failCnt,
            maxDuration: Number(rec.maxDuration.toFixed(1)),
            minDuration: Number(
              (rec.minDuration === Number.MAX_SAFE_INTEGER ? 0 : rec.minDuration).toFixed(1),
            ),
          };
        });
        const sorter = phaseSorters[phase.id] || { key: 'avgDuration', order: 'desc' };
        roomBreakdown = roomBreakdown
          .slice()
          .sort((a, b) => {
            const av = Number(a?.[sorter.key] ?? 0);
            const bv = Number(b?.[sorter.key] ?? 0);
            return sorter.order === 'asc' ? av - bv : bv - av;
          });
        return {
          ...phase,
          filter,
          trend,
          successRate,
          avgDuration,
          totalTasks,
          failRate: Number((100 - successRate).toFixed(2)),
          maxDuration: Number(maxDuration.toFixed(1)),
          minDuration,
          roomBreakdown,
        };
      }

      const projectSeed = filter.projectId === 'all' ? 0 : Number(filter.projectId) % 9;
      const gameSetSeed = filter.gameSetId === 'all' ? 0 : Number(filter.gameSetId.replace(/[^\d]/g, '')) % 7;
      const successShift = projectSeed * 0.08 - gameSetSeed * 0.05;
      const durationScale = 1 + (gameSetSeed - 3) * 0.015 + (projectSeed - 4) * 0.01;

      const successRate = Math.max(
        80,
        Math.min(99.9, Number((phase.successRate + successShift).toFixed(2))),
      );
      const avgDuration = Math.max(20, Number((phase.avgDuration * durationScale).toFixed(1)));
      const totalTasks = Math.max(
        1,
        Math.round(phase.totalTasks * (periodDays / 7) * (filter.projectId === 'all' ? 1 : 0.22)),
      );

      const trend = buildCloudTrendByPeriod(
        phase.trend,
        periodDays,
        successShift,
        durationScale,
      );
      const trendMaxDuration = trend.reduce(
        (max, item) => Math.max(max, Number(item.avgDuration) || 0),
        0,
      );
      const trendMinDuration = trend.reduce(
        (min, item) =>
          Math.min(min, Number(item.avgDuration) || Number.MAX_SAFE_INTEGER),
        Number.MAX_SAFE_INTEGER,
      );
      const maxDurationBase = Number.isFinite(phase.maxDuration)
        ? Number(phase.maxDuration)
        : trendMaxDuration;
      const minDurationBase = Number.isFinite(phase.minDuration)
        ? Number(phase.minDuration)
        : trendMinDuration;
      const maxDuration = Math.max(20, Number((maxDurationBase * durationScale).toFixed(1)));
      const minDuration = Math.max(
        1,
        Number((minDurationBase * durationScale).toFixed(1)),
      );
      let roomBreakdown = phase.roomBreakdown.map((row) => {
        const rowSuccess = Math.max(
          80,
          Math.min(99.9, Number((row.successRate + successShift * 0.9).toFixed(2))),
        );
        const rowDuration = Math.max(20, Number((row.avgDuration * durationScale).toFixed(1)));
        const rowTasks = Math.max(
          1,
          Math.round(row.tasks * (periodDays / 7) * (filter.projectId === 'all' ? 1 : 0.28)),
        );
        const rowSuccessCnt = Math.round((rowTasks * rowSuccess) / 100);
        const rowFailCnt = Math.max(0, rowTasks - rowSuccessCnt);
        const adjustSeed = (rowTasks % 7) * 0.01;
        const rowMaxDuration = Math.max(
          rowDuration,
          Number((maxDuration * (0.97 + adjustSeed)).toFixed(1)),
        );
        const rowMinDuration = Math.max(
          1,
          Math.min(rowDuration, Number((minDuration * (0.97 + adjustSeed)).toFixed(1))),
        );
        return {
          ...row,
          roomId: CLOUD_ROOM_NAME_TO_ID[row.name] || `IDC-${row.name}`,
          roomName: row.name,
          successRate: rowSuccess,
          failRate: Number((100 - rowSuccess).toFixed(2)),
          avgDuration: rowDuration,
          tasks: rowTasks,
          successCnt: rowSuccessCnt,
          failCnt: rowFailCnt,
          maxDuration: rowMaxDuration,
          minDuration: rowMinDuration,
        };
      });
      const sorter = phaseSorters[phase.id] || { key: 'avgDuration', order: 'desc' };
      roomBreakdown = roomBreakdown
        .slice()
        .sort((a, b) => {
          const av = Number(a?.[sorter.key] ?? 0);
          const bv = Number(b?.[sorter.key] ?? 0);
          return sorter.order === 'asc' ? av - bv : bv - av;
        });

      return {
        ...phase,
        filter,
        trend,
        successRate,
        avgDuration,
        totalTasks,
        failRate: Number((100 - successRate).toFixed(2)),
        maxDuration,
        minDuration,
        roomBreakdown,
      };
    });
  }, [phaseFilters, phaseList, phaseSorters]);

  const globalTaskCount = stageViews.reduce((sum, p) => sum + p.totalTasks, 0);
  const globalAvgDuration =
    stageViews.reduce((sum, p) => sum + p.avgDuration * p.totalTasks, 0) / Math.max(globalTaskCount, 1);
  const globalSuccessRate =
    stageViews.reduce((sum, p) => sum + p.successRate * p.totalTasks, 0) / Math.max(globalTaskCount, 1);
  const globalMaxDuration = stageViews.length
    ? Math.max(...stageViews.map((phase) => phase.maxDuration || 0))
    : 0;
  const globalMinDuration = stageViews.length
    ? Math.min(
        ...stageViews.map((phase) =>
          Number.isFinite(phase.minDuration) && phase.minDuration > 0 ? phase.minDuration : Number.MAX_SAFE_INTEGER,
        ),
      )
    : 0;

  const globalTrend = useMemo(() => {
    const maxDays = stageViews.reduce(
      (max, phase) => Math.max(max, phase.trend.length),
      7,
    );
    const labels = buildRecentDayLabels(maxDays);
    return labels.map((date, idx) => {
      const rows = stageViews
        .map((phase) => phase.trend[phase.trend.length - maxDays + idx])
        .filter(Boolean);
      return {
        time: date,
        successRate:
          rows.reduce((sum, row) => sum + row.successRate, 0) / Math.max(rows.length, 1),
        avgDuration:
          rows.reduce((sum, row) => sum + row.avgDuration, 0) / Math.max(rows.length, 1),
      };
    });
  }, [stageViews]);
  const globalDurationAxisMode = useMemo(() => {
    const maxSec = Math.max(...globalTrend.map((x) => Number(x?.avgDuration) || 0), 0);
    return getDurationAxisMode(maxSec);
  }, [globalTrend]);

  if (!stageViews.length) {
    return (
      <Card className="p-6">
        <p className="text-sm text-[#4d4d4d]">
          当前没有可展示的云化阶段数据（仅展示已接入并返回实时数据的阶段）。
        </p>
      </Card>
    );
  }

  return (
    <>
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2 text-[#171717]">
              <Zap className="w-5 h-5 text-[#0a72ef]" /> 游戏云化任务指标看板（实时）
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              口径：仅统计已完成子任务，默认近 7 天，可按项目筛选。耗时单位：秒。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-white border border-slate-200 text-[#4d4d4d]">
              子任务总数 {globalTaskCount.toLocaleString()}
            </span>
            <span className="px-2 py-1 rounded bg-[#ebf5ff] text-[#0068d6] border border-slate-200">
              成功率 {globalSuccessRate.toFixed(2)}%
            </span>
            <span className="px-2 py-1 rounded bg-white text-[#4d4d4d] border border-slate-200">
              平均耗时 {formatAdaptiveDuration(globalAvgDuration, 1)}
            </span>
            <span className="px-2 py-1 rounded bg-white text-[#4d4d4d] border border-slate-200">
              最长耗时 {formatAdaptiveDuration(globalMaxDuration, 1)}
            </span>
            <span className="px-2 py-1 rounded bg-white text-[#4d4d4d] border border-slate-200">
              最短耗时 {formatAdaptiveDuration(globalMinDuration === Number.MAX_SAFE_INTEGER ? 0 : globalMinDuration, 1)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-[#171717]">全阶段近 7 天总览趋势</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-52">
            <p className="text-xs text-slate-500 mb-2">成功率（%）</p>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={globalTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={38} />
                <Tooltip
                  formatter={(value) => [`${Number(value).toFixed(2)}%`, '成功率']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Line type="monotone" dataKey="successRate" stroke="#0a72ef" strokeWidth={2.2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-52">
            <p className="text-xs text-slate-500 mb-2">平均耗时（自适应单位）</p>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={globalTrend}>
                <defs>
                  <linearGradient id="cloudDurationGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0a72ef" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#0a72ef" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v) => formatDurationByAxis(v, globalDurationAxisMode, 1)}
                />
                <Tooltip
                  formatter={(value) => [formatAdaptiveDuration(value, 1), '平均耗时']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Area type="monotone" dataKey="avgDuration" stroke="#0a72ef" fill="url(#cloudDurationGradient)" strokeWidth={2.2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {stageViews.map((phase) => {
          const phaseDurationAxisMode = getDurationAxisMode(
            Math.max(...(phase.trend || []).map((x) => Number(x?.avgDuration) || 0), 0),
          );
          const phaseFailTotal = (phase.roomBreakdown || []).reduce(
            (s, r) => s + Number(r.failCnt || 0),
            0,
          );
          const showFailureDetail = useApi && phase.dataSource === 'live' && phaseFailTotal > 0;
          return (
          <Card key={phase.id} className="p-4 sm:p-5">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#171717]">{phase.title}</h3>
                <p className="text-xs text-slate-600 mt-1">{phase.aliases}</p>
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {showFailureDetail && (
                    <button
                      type="button"
                      onClick={() => loadFailureDetails(phase.id, null)}
                      className="inline-flex items-center gap-1 rounded-md bg-white text-[#171717] border border-transparent px-3 py-1.5 text-xs font-medium shadow-[0_0_0_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-slate-50"
                    >
                      失败明细（{phaseFailTotal.toLocaleString()}）
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => togglePhaseDetails(phase.id)}
                    className="inline-flex items-center gap-1 rounded-md bg-white text-[#171717] border border-transparent px-3 py-1.5 text-xs font-medium shadow-[0_0_0_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-slate-50"
                  >
                    {expandedPhaseIds.includes(phase.id) ? (
                      <>
                        收起详情 <ChevronUp className="w-4 h-4 ml-0.5" />
                      </>
                    ) : (
                      <>
                        展开详情 <ChevronDown className="w-4 h-4 ml-0.5" />
                      </>
                    )}
                  </button>
                </div>
                <div className="text-xs text-slate-600 leading-5 text-right">
                  <div>统计维度：{phase.scope}</div>
                  <div>统计对象：{phase.object}</div>
                  <div>统计状态：{phase.statusScope}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                <p className="text-xs text-slate-600">全局平均耗时</p>
                <p className="text-xl font-black text-[#171717] tabular-nums mt-1">{formatAdaptiveDuration(phase.avgDuration, 1)}</p>
                <p className="text-[11px] text-slate-600 mt-1">Σ(结束-开始)/子任务总数</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                <p className="text-xs text-[#0068d6]">成功率</p>
                <p className="text-xl font-black text-[#0068d6] tabular-nums mt-1">{phase.successRate.toFixed(2)}%</p>
                <p className="text-[11px] text-slate-600 mt-1">成功子任务数 / 子任务总数</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                <p className="text-xs text-slate-600">最长耗时</p>
                <p className="text-xl font-black text-[#171717] tabular-nums mt-1">{formatAdaptiveDuration(phase.maxDuration, 1)}</p>
                <p className="text-[11px] text-slate-600 mt-1">周期内子任务耗时最大值</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                <p className="text-xs text-slate-600">最短耗时</p>
                <p className="text-xl font-black text-[#171717] tabular-nums mt-1">{formatAdaptiveDuration(phase.minDuration, 1)}</p>
                <p className="text-[11px] text-slate-600 mt-1">周期内子任务耗时最小值</p>
              </div>
            </div>

            {expandedPhaseIds.includes(phase.id) && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-100">
                  <label className="text-xs text-[#4d4d4d]">
                    项目筛选
                    <select
                      value={phase.filter.projectId}
                      onChange={(e) => updatePhaseFilter(phase.id, 'projectId', e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
                    >
                      {(phaseProjectOptions[phase.id] || cloudProjectOptions).map((opt) => (
                        <option key={`project-${opt.id}`} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-[#4d4d4d]">
                    游戏集名称ID
                    <select
                      value={phase.filter.gameSetId}
                      onChange={(e) => updatePhaseFilter(phase.id, 'gameSetId', e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
                    >
                      {CLOUD_TASK_GAMESET_OPTIONS.map((opt) => (
                        <option key={`gameset-${opt.id}`} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-[#4d4d4d]">
                    周期筛选
                    <select
                      value={phase.filter.periodDays}
                      onChange={(e) => updatePhaseFilter(phase.id, 'periodDays', e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
                    >
                      {CLOUD_TASK_PERIOD_OPTIONS.map((opt) => (
                        <option key={`period-${opt.id}`} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                  <div className="h-48">
                    <p className="text-xs text-[#4d4d4d] mb-2">成功率趋势（{phase.filter.periodDays}天）</p>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={phase.trend}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={20} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={36} />
                        <Tooltip
                          formatter={(value) => [`${Number(value).toFixed(2)}%`, '成功率']}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Line type="monotone" dataKey="successRate" stroke="#0a72ef" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-48">
                    <p className="text-xs text-[#4d4d4d] mb-2">平均耗时趋势（{phase.filter.periodDays}天，自适应单位）</p>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={phase.trend}>
                        <defs>
                          <linearGradient id={`durationGradient-${phase.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0a72ef" stopOpacity={0.22} />
                            <stop offset="95%" stopColor="#0a72ef" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <YAxis
                          tick={{ fontSize: 10, fill: '#64748b' }}
                          axisLine={false}
                          tickLine={false}
                          width={44}
                          tickFormatter={(v) => formatDurationByAxis(v, phaseDurationAxisMode, 1)}
                        />
                        <Tooltip
                          formatter={(value) => [formatAdaptiveDuration(value, 1), '平均耗时']}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Area
                          type="monotone"
                          dataKey="avgDuration"
                          stroke="#0a72ef"
                          fill={`url(#durationGradient-${phase.id})`}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 text-xs font-medium text-[#4d4d4d]">
                    机房分组明细
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-100">
                        <th className="py-2 px-3 text-left font-medium text-slate-600">机房ID</th>
                        <th className="py-2 px-3 text-left font-medium text-slate-600">机房名称</th>
                        <th
                          className="py-2 px-3 text-right font-medium cursor-pointer select-none"
                          onClick={() => togglePhaseSort(phase.id, 'tasks')}
                        >
                          {renderSortLabel(phase.id, 'tasks', '任务数')}
                        </th>
                        <th className="py-2 px-3 text-right font-medium">成功任务数</th>
                        <th className="py-2 px-3 text-right font-medium">失败任务数</th>
                        <th
                          className="py-2 px-3 text-right font-medium cursor-pointer select-none"
                          onClick={() => togglePhaseSort(phase.id, 'avgDuration')}
                        >
                          {renderSortLabel(phase.id, 'avgDuration', '平均耗时')}
                        </th>
                        <th
                          className="py-2 px-3 text-right font-medium cursor-pointer select-none"
                          onClick={() => togglePhaseSort(phase.id, 'maxDuration')}
                        >
                          {renderSortLabel(phase.id, 'maxDuration', '最大耗时')}
                        </th>
                        <th
                          className="py-2 px-3 text-right font-medium cursor-pointer select-none"
                          onClick={() => togglePhaseSort(phase.id, 'minDuration')}
                        >
                          {renderSortLabel(phase.id, 'minDuration', '最小耗时')}
                        </th>
                        <th
                          className="py-2 px-3 text-right font-medium cursor-pointer select-none"
                          onClick={() => togglePhaseSort(phase.id, 'successRate')}
                        >
                          {renderSortLabel(phase.id, 'successRate', '成功率')}
                        </th>
                        {showFailureDetail && (
                          <th className="py-2 px-3 text-right font-medium text-slate-600">失败明细</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="text-slate-700">
                      {phase.roomBreakdown.map((row) => (
                        <tr key={`${phase.id}-${row.roomId}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                          <td className="py-2 px-3 font-mono text-xs text-[#4d4d4d]">{row.roomId}</td>
                          <td className="py-2 px-3 text-[#171717]">{row.roomName}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{row.tasks.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{Number(row.successCnt || 0).toLocaleString()}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{Number(row.failCnt || 0).toLocaleString()}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{formatAdaptiveDuration(row.avgDuration, 1)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{formatAdaptiveDuration(Number(row.maxDuration || 0), 1)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{formatAdaptiveDuration(Number(row.minDuration || 0), 1)}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-[#0068d6]">{row.successRate.toFixed(2)}%</td>
                          {showFailureDetail && (
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              {Number(row.failCnt || 0) > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => loadFailureDetails(phase.id, row.roomId)}
                                  className="text-xs font-medium text-[#0068d6] hover:underline"
                                >
                                  查看
                                </button>
                              ) : (
                                <span className="text-xs text-slate-300">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
          );
        })}
      </div>
    </div>

    {failureDetailModal.open && (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/45"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-failure-detail-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeFailureDetailModal();
        }}
      >
        <div
          className="relative flex w-full max-w-lg max-h-[min(85vh,560px)] flex-col overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_12px_40px_rgba(0,0,0,0.12)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <h4 id="cloud-failure-detail-title" className="text-sm font-semibold leading-snug text-[#171717] pr-6">
              失败任务明细
              <span className="block mt-0.5 text-xs font-normal text-[#4d4d4d]">
                {failureDetailModal.phaseTitle}
                {failureDetailModal.idcId ? ` · 机房 ${failureDetailModal.idcId}` : ''}
              </span>
            </h4>
            <button
              type="button"
              onClick={closeFailureDetailModal}
              className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-[#171717]"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-[12rem] flex-1 overflow-y-auto px-4 py-3">
            {failureDetailModal.loading && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-[#4d4d4d]">
                <Loader2 className="h-8 w-8 animate-spin text-[#0a72ef]" aria-hidden />
                正在查询大表…
              </div>
            )}
            {!failureDetailModal.loading && failureDetailModal.error && (
              <p className="text-sm text-red-600">{failureDetailModal.error}</p>
            )}
            {!failureDetailModal.loading && !failureDetailModal.error && failureDetailModal.groups.length === 0 && (
              <p className="text-sm text-[#4d4d4d]">未查询到失败行（可能已被筛选条件过滤）。</p>
            )}
            {!failureDetailModal.loading && !failureDetailModal.error && failureDetailModal.groups.length > 0 && (
              <ul className="space-y-4 text-sm text-[#171717]">
                {failureDetailModal.groups.map((g) => (
                  <li
                    key={`fd-${failureDetailModal.phaseId}-${g.pitemId}`}
                    className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2.5 shadow-[0_0_0_1px_rgba(0,0,0,0.03)]"
                  >
                    <div className="font-medium text-[#171717]">主任务ID：{g.pitemId}</div>
                    <div className="mt-1.5 text-[#4d4d4d] break-words">
                      VMID：{g.vmText || '—'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!failureDetailModal.loading && failureDetailModal.truncated && (
              <p className="mt-3 text-xs text-amber-700">
                命中行数达到上限（{CLOUD_TASK_FAILURE_DETAIL_ROW_LIMIT.toLocaleString()}），仅展示前若干条聚合结果；如需全量请缩小时间或项目范围。
              </p>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
};

const InstanceProjectCard = memo(function InstanceProjectCard({ proj, rank, isExpanded, onToggle }) {
  return (
    <Card className="p-3 border border-slate-200 flex flex-col contain-layout [content-visibility:auto]">
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="bg-slate-900 text-white font-bold px-2.5 py-1 rounded-full text-sm shrink-0">
            #{rank}
          </span>
          <span className="font-bold text-slate-800 text-lg truncate">{proj.name}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">7 天波幅</p>
          <p className="font-bold text-emerald-500">{proj.volatility}</p>
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-2">项目 ID {proj.id}</p>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-slate-50 border border-slate-100 rounded-lg px-2 py-2 text-center">
          <p className="text-[11px] font-bold text-slate-500">可用数</p>
          <p className="text-[12px] font-black text-slate-900">
            {typeof proj.currentHealthValue === 'number' ? proj.currentHealthValue.toFixed(0) : '—'}
          </p>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-lg px-2 py-2 text-center">
          <p className="text-[11px] font-bold text-slate-500">总数</p>
          <p className="text-[12px] font-black text-slate-900">
            {typeof proj.currentTotalValue === 'number' ? proj.currentTotalValue.toFixed(0) : '—'}
          </p>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-lg px-2 py-2 text-center">
          <p className="text-[11px] font-bold text-slate-500">可用率</p>
          <p className="text-[12px] font-black text-emerald-600">{proj.avail}</p>
        </div>
      </div>

      <div className="h-28 w-full mb-3 overflow-visible">
        <p className="text-xs text-slate-400 mb-1">近 7 天可用率</p>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={proj.trend} margin={{ top: 0, right: 4, left: 2, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              dy={4}
              minTickGap={0}
              interval={0}
              tickMargin={6}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              width={36}
              dx={0}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            />
            <Tooltip
              formatter={(value) => [`${Number(value).toFixed(1)}%`, '可用率']}
              contentStyle={{
                borderRadius: '8px',
                border: 'none',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                background: 'white',
              }}
              labelStyle={{ color: '#334155' }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#0a72ef"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-3 text-sm mb-3">
        <span className="text-slate-500">
          高 <strong className="text-emerald-500">{proj.high}</strong>
        </span>
        <span className="text-slate-500">
          低 <strong className="text-rose-500">{proj.low}</strong>
        </span>
      </div>

      <button
        type="button"
        onClick={() => onToggle(proj.id)}
        className="inline-flex items-center gap-1 self-start mb-2 rounded-md bg-white text-[#171717] border border-slate-200 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-50"
      >
        {isExpanded ? (
          <>
            收起按日明细 <ChevronUp className="w-4 h-4 ml-0.5" />
          </>
        ) : (
          <>
            展开按日明细 <ChevronDown className="w-4 h-4 ml-0.5" />
          </>
        )}
      </button>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-slate-100 overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-100">
                <th className="pb-2 px-2 font-medium w-1/4">日期</th>
                <th className="pb-2 px-2 font-medium text-right w-1/4">可用率 (%)</th>
                <th className="pb-2 px-2 font-medium text-right w-1/4">健康实例数</th>
                <th className="pb-2 px-2 font-medium text-right w-1/4">总门路数</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {proj.table.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40 transition-colors"
                >
                  <td className="py-2.5 px-2 font-medium whitespace-nowrap">{row.date}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">{row.avail}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">{row.health}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
});

// 4. 实例任务 (Instance Tasks)
const InstanceView = ({ projectsToShow, instanceByProjectId, loading = false }) => {
  const [expanded, setExpanded] = useState({});
  const toggleExpand = useCallback((id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const list = useMemo(
    () => (Array.isArray(projectsToShow) && projectsToShow.length > 0 ? projectsToShow : projects),
    [projectsToShow],
  );

  const instanceProjects = useMemo(() => {
    return list
    .map((proj) => {
      const override = instanceByProjectId && instanceByProjectId[String(proj.id)];
      if (override) return override;

      // 接口模式下：没有命中 SQL 的项目不再用 mock 补，避免展示与真实数据不一致
      if (useApi) {
        return {
          id: proj.id,
          name: proj.name,
          volatility: '—',
          health: '—',
          total: '—',
          avail: '—',
          trend: [],
          high: '—',
          low: '—',
          table: [],
          currentAvailValue: undefined,
          currentHealthValue: undefined,
          currentTotalValue: undefined,
        };
      }

      const trendBase = 95 + ((Number(proj.id) % 7) - 3) * 0.35;
      const trendVar = 2.5 + (Number(proj.id) % 5) * 0.35;
      const trend = generateTrendData(7, trendBase, trendVar, 'day');
      const vals = Array.isArray(trend) ? trend.map((d) => d.value) : [];
      const currentAvail = vals.length ? vals[vals.length - 1] : 95;
      const total = typeof proj.supply === 'number' ? proj.supply : 0;
      const health = Math.floor((total * currentAvail) / 100);
      const high = vals.length ? Math.max(...vals) : currentAvail;
      const low = vals.length ? Math.min(...vals) : currentAvail;
      const volatility = vals.length ? (high - low) : 1.1;

      const baseRows = Array.isArray(proj.table) ? proj.table.slice(-4) : [];
      const val4 = vals.slice(-4);
      const table = baseRows.map((r, i) => {
        const v = typeof val4[i] === 'number' ? val4[i] : currentAvail;
        return {
          date: r.date,
          avail: `${v.toFixed(2)}%`,
          health: Math.floor((total * v) / 100),
          total,
        };
      });

      return {
        id: proj.id,
        name: proj.name,
        volatility: `${volatility.toFixed(1)}%`,
        health,
        total,
        avail: `${currentAvail.toFixed(1)}%`,
        trend,
        high: `${high.toFixed(1)}%`,
        low: `${low.toFixed(1)}%`,
        table,
        // 仅为 mock：当前可用实例数用“健康实例数”近似
        currentAvailValue: health,
        currentHealthValue: health,
        currentTotalValue: total,
      };
    })
    .sort((a, b) => {
      const aNum = Number(a?.total);
      const bNum = Number(b?.total);
      const an = Number.isFinite(aNum) ? aNum : -Infinity;
      const bn = Number.isFinite(bNum) ? bNum : -Infinity;
      return bn - an;
    });
  }, [list, instanceByProjectId]);

  const overallAvailabilitySeries = useMemo(() => {
    if (!instanceProjects.length) return overallAvailability;
    const hasTrend = instanceProjects.every((p) => Array.isArray(p.trend) && p.trend.length > 0);
    if (!hasTrend) return overallAvailability;

    const byKey = {};
    for (const p of instanceProjects) {
      for (const pt of p.trend) {
        const key = String(pt.time ?? '');
        if (!key) continue;
        if (!byKey[key]) {
          byKey[key] = { time: key, sumPct: 0, count: 0, sumNum: 0, sumDen: 0, hasCounts: false };
        }

        const v = Number(pt.value);
        if (Number.isFinite(v)) {
          byKey[key].sumPct += v;
          byKey[key].count += 1;
        }

        const num = Number(pt.numerator);
        const den = Number(pt.denominator);
        if (Number.isFinite(num) && Number.isFinite(den)) {
          byKey[key].sumNum += num;
          byKey[key].sumDen += den;
          byKey[key].hasCounts = true;
        }
      }
    }

    const keys = Object.keys(byKey).sort((a, b) => a.localeCompare(b));
    return keys.map((k) => {
      const rec = byKey[k];
      if (rec.hasCounts && rec.sumDen !== 0) {
        return { time: rec.time, value: (rec.sumNum / rec.sumDen) * 100 };
      }
      return { time: rec.time, value: rec.count ? rec.sumPct / rec.count : 0 };
    });
  }, [instanceProjects]);

  const avgAvailPct = overallAvailabilitySeries.length
    ? Number(overallAvailabilitySeries[overallAvailabilitySeries.length - 1].value) || 0
    : 0;

  const globalCurrentHealth = instanceProjects.reduce((s, p) => {
    const v = p?.currentHealthValue;
    return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  }, 0);
  const globalCurrentTotal = instanceProjects.reduce((s, p) => {
    const v = p?.currentTotalValue;
    return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  }, 0);
  const globalCurrentRatio = globalCurrentTotal > 0 ? (globalCurrentHealth / globalCurrentTotal) * 100 : 0;

  if (loading && useApi) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" aria-hidden />
          正在加载实例数据…
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="h-40 border border-slate-200 animate-pulse bg-slate-50" />
          ))}
        </div>
        <div className="h-6 w-56 rounded bg-slate-200 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-64 border border-slate-200 animate-pulse bg-slate-50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800">全网实例可用率</h3>
              <p className="text-xs text-slate-500 mt-1">近7天</p>
            </div>
            <span className="text-2xl font-black text-slate-900">
              {avgAvailPct.toFixed(1)}
              <span className="text-sm text-slate-500">%</span>
            </span>
          </div>
          <div className="h-24 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={overallAvailabilitySeries}>
                <defs>
                  <linearGradient id="colorAvail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#000000" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#000000" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  dy={6}
                  minTickGap={0}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  width={38}
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                />
                <Tooltip
                  formatter={(value) => [`${Number(value).toFixed(1)}%`, '可用率']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#0a72ef"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                  fill="url(#colorAvail)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-slate-800">当前实例可用数</h3>
          </div>
          <div className="flex items-end justify-between">
            <div className="text-3xl font-black text-slate-900 leading-none">
              {globalCurrentHealth.toLocaleString()}
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">可用率</div>
              <div className="text-lg font-black text-emerald-600">
                {globalCurrentTotal > 0 ? `${globalCurrentRatio.toFixed(1)}%` : '—'}
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-slate-800">当前总数</h3>
          </div>
          <div className="text-3xl font-black text-slate-900">
            {globalCurrentTotal.toLocaleString()}
          </div>
        </Card>
      </div>

      <div className="mt-8 mb-4">
        <h3 className="text-lg font-bold text-slate-800">项目明细 (TOP 排序)</h3>
        <p className="text-xs text-slate-500 mt-1">按总门路数从高到低；卡片内实时 + 近 7 天曲线，口径与总览一致。</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {instanceProjects.map((proj, i) => (
          <InstanceProjectCard
            key={proj.id}
            proj={proj}
            rank={i + 1}
            isExpanded={!!expanded[proj.id]}
            onToggle={toggleExpand}
          />
        ))}
      </div>
    </div>
  );
};

function TabPanelLoading({ tabLabel }) {
  return (
    <div
      className="flex min-h-[min(18rem,46vh)] w-full flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white shadow-sm px-6 py-12"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-10 w-10 animate-spin text-[#0a72ef]" aria-hidden />
      <p className="text-sm font-medium text-slate-600">正在加载「{tabLabel}」…</p>
      <p className="text-xs text-slate-400">内容较多时稍候即现</p>
    </div>
  );
}

// --- 主应用组件 (Main App Component) ---
export default function App() {
  /** 顶部 Tab 立即高亮 */
  const [tabIndicator, setTabIndicator] = useState('supply');
  /** 下方面板延后挂载（避免主线程被图表同步阻塞） */
  const [tabPanel, setTabPanel] = useState('supply');
  const [isTabTransitionPending, startTabTransition] = useTransition();

  const selectTab = useCallback((id) => {
    if (id === tabPanel && !isTabTransitionPending) return;
    setTabIndicator(id);
    startTabTransition(() => {
      setTabPanel(id);
    });
  }, [tabPanel, isTabTransitionPending]);
  const [selectedProjectIds, setSelectedProjectIds] = useState([]);
  const [instanceByProjectId, setInstanceByProjectId] = useState({});
  const [instanceProjectOptions, setInstanceProjectOptions] = useState([]);
  const [supplyProjects, setSupplyProjects] = useState(() => (useApi ? [] : projects));
  const [bytedanceSupplyByDate, setBytedanceSupplyByDate] = useState({});
  const [supplyVmidByProjectId, setSupplyVmidByProjectId] = useState(() => (useApi ? undefined : {}));
  const [supplyYuanliByProjectId, setSupplyYuanliByProjectId] = useState(() => (useApi ? undefined : {}));
  const [ordersByProjectDatePaas, setOrdersByProjectDatePaas] = useState(undefined);
  const [ordersByProjectDateYuanli, setOrdersByProjectDateYuanli] = useState(undefined);
  const [supplyEnv, setSupplyEnv] = useState(SUPPLY_ENV_PAAS);
  const [cloudTaskLiveRowsByPhase, setCloudTaskLiveRowsByPhase] = useState({});
  /** 企微映射更新后递增，驱动供应卡片按新 settlement→项目关系重算 */
  const [settlementMapEpoch, setSettlementMapEpoch] = useState(0);
  const supplyOrdersDatasetRef = useRef(null);
  const [instanceLoading, setInstanceLoading] = useState(() => useApi);

  useEffect(() => {
    if (!useApi) setInstanceLoading(false);
  }, []);

  useEffect(() => {
    if (!useApi) {
      setCloudTaskLiveRowsByPhase({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const phasePairs = await Promise.all(
          CLOUD_TASK_LIVE_PHASE_CONFIGS.map(async (cfg) => {
            const [durationDs, successDs] = await Promise.all([
              queryMetabaseNative({
                database: CLOUD_TASK_LIVE_DB_ID,
                query: cloudTaskSqlForStage(CLOUD_TASK_DURATION_SQL_TEMPLATE, cfg.pstage),
                audience: SUPPLY_ENV_PAAS,
              }),
              queryMetabaseNative({
                database: CLOUD_TASK_LIVE_DB_ID,
                query: cloudTaskSuccessSql(CLOUD_TASK_SUCCESS_SQL_TEMPLATE, {
                  pstage: cfg.pstage,
                  successStatus: cfg.successStatus,
                  failStatus: cfg.failStatus,
                }),
                audience: SUPPLY_ENV_PAAS,
              }),
            ]);
            return [cfg.phaseId, durationDs, successDs];
          }),
        );
        if (cancelled) return;
        const nextRows = {};
        phasePairs.forEach(([phaseId, durationDs, successDs]) => {
          const durationRows = parseCloudDeployDurationDataset(durationDs);
          const successRows = parseCloudDeploySuccessDataset(successDs);
          const merged = {};
          durationRows.forEach((r) => {
            const key = `${r.dt || ''}__${r.idcId}__${r.projectId}`;
            merged[key] = { ...r };
          });
          successRows.forEach((r) => {
            const key = `${r.dt || ''}__${r.idcId}__${r.projectId}`;
            merged[key] = { ...(merged[key] || {}), ...r };
          });
          nextRows[phaseId] = Object.values(merged);
        });
        setCloudTaskLiveRowsByPhase(nextRows);
      } catch (e) {
        console.warn('[云化任务] 拉取实时数据失败', e);
        if (!cancelled) setCloudTaskLiveRowsByPhase({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 近 7 天订单/供应仍有一路未返回（用于界面内小 loading，不再整页骨架卡死） */
  const supplyFetchPending = useMemo(() => {
    if (!useApi) return false;
    if (supplyEnv === SUPPLY_ENV_YUANLI) {
      return (
        ordersByProjectDateYuanli === undefined || supplyYuanliByProjectId === undefined
      );
    }
    return ordersByProjectDatePaas === undefined || supplyVmidByProjectId === undefined;
  }, [
    useApi,
    supplyEnv,
    ordersByProjectDateYuanli,
    supplyYuanliByProjectId,
    ordersByProjectDatePaas,
    supplyVmidByProjectId,
  ]);

  useEffect(() => {
    if (!useApi) return;
    if (!SUPPLY_VMID_7D_SQL?.trim()) {
      setSupplyVmidByProjectId({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ds = await queryMetabaseNative({
          database: METABASE_SUPPLY_VMID_7D_DB_ID,
          query: SUPPLY_VMID_7D_SQL,
          audience: SUPPLY_ENV_PAAS,
        });
        if (cancelled) return;
        setSupplyVmidByProjectId(parseSupplyVmid7dDataset(ds));
      } catch (e) {
        console.error('[供应vmid7d] Metabase 失败，供应列回退实例/字节', e);
        if (!cancelled) setSupplyVmidByProjectId({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!useApi || !BYTE_DANCE_SUPPLY_7D_SQL?.trim()) return;
    let cancelled = false;

    const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const findIdx = (cols, keys) => {
      const nkeys = keys.map(norm);
      for (let i = 0; i < cols.length; i++) {
        const name = norm(cols[i]?.name ?? cols[i]?.display_name ?? '');
        if (!name) continue;
        if (nkeys.some((k) => name.includes(k))) return i;
      }
      return -1;
    };

    (async () => {
      try {
        const ds = await queryMetabaseNative({
          database: METABASE_BYTE_DANCE_SUPPLY_7D_DB_ID,
          query: BYTE_DANCE_SUPPLY_7D_SQL,
          audience: SUPPLY_ENV_PAAS,
        });
        if (cancelled) return;
        const cols = ds?.data?.cols ?? [];
        const rows = ds?.data?.rows ?? [];
        const iDt = findIdx(cols, ['dt', 'date']);
        const iAvg = findIdx(cols, ['avg_count', 'avgcount']);
        const iMax = findIdx(cols, ['max_count', 'maxcount']);
        if (iDt === -1 || iAvg === -1 || iMax === -1) {
          console.warn('[字节供应7d] 返回列缺少 dt / avg_count / max_count');
          return;
        }
        const map = {};
        for (const r of rows) {
          const key = normalizeDateKey(r[iDt]);
          if (!key) continue;
          const avg = Number(r[iAvg]);
          const max = Number(r[iMax]);
          map[key] = {
            avg: Number.isFinite(avg) ? avg : NaN,
            max: Number.isFinite(max) ? max : NaN,
          };
        }
        if (!cancelled) setBytedanceSupplyByDate(map);
      } catch (e) {
        console.error('[字节供应7d] Metabase 失败，沿用 mock/实例合并', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!useApi) return;
    const shouldFetchCurrent = !!INSTANCE_CURRENT_AVAILABLE_SQL;
    const shouldFetchTrend = !!INSTANCE_AVAILABILITY_7D_SQL;
    if (!shouldFetchCurrent && !shouldFetchTrend) {
      setInstanceLoading(false);
      return;
    }
    let cancelled = false;

    const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const findIdx = (cols, keys) => {
      const nkeys = keys.map(norm);
      for (let i = 0; i < cols.length; i++) {
        const name = norm(cols[i]?.name ?? cols[i]?.display_name ?? '');
        if (!name) continue;
        if (nkeys.some((k) => name.includes(k))) return i;
      }
      return -1;
    };
    (async () => {
      setInstanceLoading(true);
      try {
        const curPromise = shouldFetchCurrent
          ? queryMetabaseNative({
              database: INSTANCE_CURRENT_DB_ID,
              query: INSTANCE_CURRENT_AVAILABLE_SQL,
              audience: SUPPLY_ENV_PAAS,
            })
          : Promise.resolve(null);
        const trendPromise = shouldFetchTrend
          ? queryMetabaseNative({
              database: INSTANCE_AVAILABILITY_7D_DB_ID,
              query: INSTANCE_AVAILABILITY_7D_SQL,
              audience: SUPPLY_ENV_PAAS,
            })
          : Promise.resolve(null);

        const [curDs, trendDs] = await Promise.all([curPromise, trendPromise]);

        if (cancelled) return;

        const curCols = curDs?.data?.cols ?? [];
        const curRows = curDs?.data?.rows ?? [];
        const trendCols = trendDs?.data?.cols ?? [];
        const trendRows = trendDs?.data?.rows ?? [];

        const curIdxProjectId = findIdx(curCols, ['project_id']);
        const curIdxProjectName = findIdx(curCols, ['project_name']);
        const curIdxFmtTs = findIdx(curCols, ['fmt_ts', 'fmtts', 'timestamp']);
        let curIdxTotal = findIdx(curCols, ['total_count', 'totalcount']);
        if (curIdxTotal === -1) curIdxTotal = findIdx(curCols, ['count']);
        const curIdxHealth = findIdx(curCols, ['health_count', 'count-where', 'count_where', 'numerator', 'health']);

        const currentByProject = {};
        for (const r of curRows) {
          const projectId = String(r[curIdxProjectId] ?? '').trim();
          if (!projectId) continue;
          const projectName = String(r[curIdxProjectName] ?? '').trim();
          const fmtTsRaw = curIdxFmtTs === -1 ? undefined : r[curIdxFmtTs];
          const totalCount = Number(r[curIdxTotal] ?? NaN);
          const healthCount = Number(r[curIdxHealth] ?? NaN);
          if (!Number.isFinite(totalCount) && !Number.isFinite(healthCount)) continue;
          let tsMs = curIdxFmtTs === -1 ? 0 : Number(fmtTsRaw);
          if (!Number.isFinite(tsMs) && curIdxFmtTs !== -1) tsMs = Date.parse(String(fmtTsRaw));
          if (!Number.isFinite(tsMs)) tsMs = 0;

          const prev = currentByProject[projectId];
          if (!prev || tsMs >= prev.tsMs) {
            currentByProject[projectId] = {
              projectName,
              total: totalCount,
              health: healthCount,
              tsMs,
            };
          }
        }

        const trendIdxDt = findIdx(trendCols, ['dt', 'date']);
        const trendIdxProjectId = findIdx(trendCols, ['project_id']);
        const trendIdxAvgRt = findIdx(trendCols, ['avg_rt', 'avgrt', 'rt']);
        const trendIdxAvgNum = findIdx(trendCols, ['avg_num', 'avgnum', 'numerator', 'num']);
        const trendIdxAvgDen = findIdx(trendCols, ['avg_den', 'avgden', 'denominator', 'den']);
        const trendIdxMaxDen = findIdx(trendCols, ['max_den', 'maxden', 'max_denominator', 'maxdenominator']);

        const seriesByProject = {};
        for (const r of trendRows) {
          const projectId = String(r[trendIdxProjectId] ?? '').trim();
          if (!projectId) continue;
          const dt = String(r[trendIdxDt] ?? '').trim();
          const avgRt = Number(r[trendIdxAvgRt] ?? NaN);
          const avgNum = Number(r[trendIdxAvgNum] ?? NaN);
          const avgDen = Number(r[trendIdxAvgDen] ?? NaN);
          const maxDen = Number(r[trendIdxMaxDen] ?? NaN);
          if (!dt) continue;
          if (!Number.isFinite(avgRt)) continue;
          if (!seriesByProject[projectId]) seriesByProject[projectId] = [];
          seriesByProject[projectId].push({ dt, value: avgRt * 100, avgNum, avgDen, maxDen });
        }

        const next = {};
        const hasAvgNum = trendIdxAvgNum !== -1;
        const hasAvgDen = trendIdxAvgDen !== -1;
        for (const [projectId, series] of Object.entries(seriesByProject)) {
          const sortedAsc = series.slice().sort((a, b) => a.dt.localeCompare(b.dt));
          const sorted = sortedAsc.slice().reverse();
          if (!sorted.length) continue;

          const values = sortedAsc.map((x) => x.value).filter((v) => Number.isFinite(v));
          const high = values.length ? Math.max(...values) : 0;
          const low = values.length ? Math.min(...values) : 0;
          const volatility = values.length ? high - low : 1.1;

          const last = sortedAsc[sortedAsc.length - 1]; // 最新一天
          const health = hasAvgNum && Number.isFinite(last.avgNum) ? Math.round(last.avgNum) : '—';
          const total = hasAvgDen && Number.isFinite(last.avgDen) ? Math.round(last.avgDen) : '—';
          const availPct = Number.isFinite(last.value) ? last.value : 0;

          const trend = sorted.map((x) => ({
            time: normalizeDateKey(x.dt),
            value: x.value,
            numerator: x.avgNum,
            denominator: x.avgDen,
          }));

          const current = currentByProject[projectId];
          const projectName = current?.projectName || String(projectId);

          next[projectId] = {
            id: projectId,
            name: projectName,
            volatility: `${volatility.toFixed(1)}%`,
            health,
            total,
            avail: `${availPct.toFixed(1)}%`,
            trend,
            high: `${high.toFixed(1)}%`,
            low: `${low.toFixed(1)}%`,
            table: sorted.map((x) => ({
              date: normalizeDateKey(x.dt),
              avail: `${x.value.toFixed(2)}`,
              health: Number.isFinite(x.avgNum) ? Math.round(x.avgNum) : '—',
              total: Number.isFinite(x.avgDen) ? Math.round(x.avgDen) : '—',
              totalAvg: Number.isFinite(x.avgDen) ? Math.round(x.avgDen) : '—',
              totalMax: Number.isFinite(x.maxDen) ? Math.round(x.maxDen) : '—',
            })),
            currentAvailValue: current?.health ?? undefined,
            currentHealthValue: current?.health ?? undefined,
            currentTotalValue: current?.total ?? undefined,
          };
        }

        if (!cancelled) {
          setInstanceByProjectId(next);
          setInstanceProjectOptions(
            Object.values(next).map((p) => ({
              id: String(p.id),
              name: p.name,
              unit: String(p.id) === '33' ? '卡' : '路',
            })),
          );
        }
      } catch (e) {
        console.error('[实例任务] Metabase 接口失败，继续使用 mock', e);
      } finally {
        if (!cancelled) setInstanceLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 供应看板：订单 — 仅请求自建 Metabase 一次；原力 Tab 用同一 dataset + 原力结算映射聚合（不请求原力 token）
  useEffect(() => {
    if (!useApi) return;
    let cancelled = false;
    (async () => {
      try {
        const dataset = await queryMetabaseNative({
          database: METABASE_SUPPLY_ORDERS_DB_ID,
          query: METABASE_SQL_SUPPLY_ORDERS_7D_BY_SETTLEMENT,
          audience: SUPPLY_ENV_PAAS,
        });
        if (cancelled) return;
        supplyOrdersDatasetRef.current = dataset;
        setOrdersByProjectDatePaas(aggregateOrdersDatasetByProjectDate(dataset, SUPPLY_ENV_PAAS));
        setOrdersByProjectDateYuanli(aggregateOrdersDatasetByProjectDate(dataset, SUPPLY_ENV_YUANLI));
      } catch (e) {
        console.warn('[供应] 订单拉取失败（自建 Metabase；原力映射同源 dataset）', e);
        if (!cancelled) {
          supplyOrdersDatasetRef.current = null;
          setOrdersByProjectDatePaas({});
          setOrdersByProjectDateYuanli({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 企微智能表格：PAAS 结算套餐→项目映射（凭证仅在 dev 中间件或独立代理上，见 .env.example）
  useEffect(() => {
    if (String(import.meta.env.VITE_WECOM_SETTLEMENT_MAP_DISABLED || '').trim() === '1') {
      if (debugSettlementMap) {
        console.info(
          '[结算映射] 未请求企业微信（VITE_WECOM_SETTLEMENT_MAP_DISABLED=1）→ 使用 settlementToProject.js 代码内兜底映射',
        );
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (debugSettlementMap) {
          console.info('[结算映射] 正在请求', WECOM_SETTLEMENT_MAP_URL, '（企业微信智能表格经服务端拉取）');
        }
        const res = await fetch(WECOM_SETTLEMENT_MAP_URL, { credentials: 'same-origin' });
        if (!res.ok) {
          if (debugSettlementMap) {
            console.info(
              '[结算映射] 企微映射接口失败 HTTP',
              res.status,
              '→ 保持代码内兜底；可看 Network 里 settlement-map 响应',
            );
          }
          return;
        }
        const data = await res.json();
        if (!data || data.error || typeof data.paas !== 'object') {
          if (debugSettlementMap) {
            console.info('[结算映射] 响应无有效 paas 字段或含 error → 未覆盖兜底', data?.error || data);
          }
          return;
        }
        if (cancelled) return;
        const bundle = { paas: data.paas };
        if (typeof data.yuanli === 'object') bundle.yuanli = data.yuanli;
        applyWecomSettlementMaps(bundle);
        if (debugSettlementMap) {
          console.info('[结算映射] 已应用企业微信智能表格数据', {
            fetchedAt: data.fetchedAt,
            paas套餐数: Object.keys(bundle.paas).length,
            yuanli套餐数: Object.keys(bundle.yuanli || {}).length,
          });
        }
        setSettlementMapEpoch((n) => n + 1);
        const ds = supplyOrdersDatasetRef.current;
        if (ds) {
          setOrdersByProjectDatePaas(aggregateOrdersDatasetByProjectDate(ds, SUPPLY_ENV_PAAS));
          setOrdersByProjectDateYuanli(aggregateOrdersDatasetByProjectDate(ds, SUPPLY_ENV_YUANLI));
        }
      } catch (e) {
        console.warn('[企微结算映射] 拉取失败，使用代码内兜底映射', e);
        if (debugSettlementMap) {
          console.info('[结算映射] 请求异常 → 使用代码内兜底（非企微数据）');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 原力环境供应（biz_type + inc 表）
  useEffect(() => {
    if (!useApi) return;
    // 仅在切到「原力」标签时请求，避免 PAAS 场景下无意义的 401 噪音
    if (supplyEnv !== SUPPLY_ENV_YUANLI) return;
    if (!YUANLI_SUPPLY_7D_SQL?.trim()) {
      setSupplyYuanliByProjectId({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ds = await queryMetabaseNative({
          database: METABASE_YUANLI_DB_ID,
          query: YUANLI_SUPPLY_7D_SQL,
          audience: SUPPLY_ENV_YUANLI,
        });
        if (cancelled) return;
        setSupplyYuanliByProjectId(parseYuanliSupplyDataset(ds));
      } catch (e) {
        console.error('[原力供应] Metabase 失败', e);
        if (!cancelled) setSupplyYuanliByProjectId({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useApi, supplyEnv]);

  // 供应看板：按环境与数据源合并卡片（订单就绪即可先出卡；vmid/原力 CH 未到则用空 map，供应数字与曲线稍后补齐）
  useEffect(() => {
    if (!useApi) return;
    const isYl = supplyEnv === SUPPLY_ENV_YUANLI;
    if (isYl) {
      if (ordersByProjectDateYuanli === undefined) return;
    } else if (ordersByProjectDatePaas === undefined) {
      return;
    }

    const byProject = instanceByProjectId || {};
    const instanceForSupply = isYl ? {} : byProject;
    const byteMap = isYl ? {} : bytedanceSupplyByDate || {};
    const vmidMap = isYl
      ? supplyYuanliByProjectId ?? {}
      : supplyVmidByProjectId ?? {};
    const hasInstance = !isYl && Object.keys(byProject).length > 0;
    const hasByte = !isYl && Object.keys(byteMap).length > 0;
    const hasSupply = Object.keys(vmidMap).length > 0;
    const orderData = isYl ? ordersByProjectDateYuanli ?? {} : ordersByProjectDatePaas ?? {};
    const ordersReady = isYl ? ordersByProjectDateYuanli !== undefined : ordersByProjectDatePaas !== undefined;
    if (!hasInstance && !hasByte && !ordersReady && !hasSupply) return;

    const buildTrendFromTable = (newTable) => {
      const ascRows = newTable.slice().reverse();
      return ascRows.map((r) => {
        const ord = Number(r.order);
        const supply = Number(r.max);
        const value =
          ord > 0 && Number.isFinite(supply) ? ((supply - ord) / ord) * 100 : 0;
        return { time: r.date, value };
      });
    };

    setSupplyProjects((prev) => {
      const prevById = {};
      for (const p of prev) prevById[String(p.id)] = p;
      const seedById = {};
      for (const p of projects) seedById[String(p.id)] = p;

      const allIds = new Set([
        ...(isYl ? [] : Object.keys(prevById)),
        ...(isYl ? [] : Object.keys(byProject)),
        ...Object.keys(orderData),
        ...Object.keys(vmidMap),
      ]);
      if (hasByte && !isYl) allIds.add('33');

      const settlementByProject = getProjectIdToSettlementIds(supplyEnv);
      const hasSettlementForProject = (pid) => (settlementByProject[String(pid)] ?? []).length > 0;
      const cardIdSet = new Set();
      for (const pid of allIds) {
        if (!hasSettlementForProject(pid)) continue;
        cardIdSet.add(supplyCardIdForProjectId(pid, supplyEnv));
      }
      const idList = Array.from(cardIdSet);

      const cards = idList.map((cardId) => {
        const memberIds = projectIdsForSupplyCardId(cardId, supplyEnv);
        const primaryPid = memberIds[0];
        const base = isYl
          ? seedById[primaryPid] || {}
          : prevById[cardId] || prevById[primaryPid] || seedById[primaryPid] || {};
        const name =
          memberIds.length === 1
            ? (isYl ? yuanliBizNameForProject(vmidMap, primaryPid) : '') ||
              base.name ||
              instanceForSupply[primaryPid]?.name ||
              seedById[primaryPid]?.name ||
              (primaryPid === '33' ? '字节跳动' : `项目 ${primaryPid}`)
            : memberIds
                .map((pid) => {
                  if (isYl) {
                    const yl = yuanliBizNameForProject(vmidMap, pid);
                    if (yl) return yl;
                  }
                  const fromInstance = instanceForSupply[pid]?.name;
                  const seed = seedById[pid]?.name;
                  return fromInstance || seed || (pid === '33' ? '字节跳动' : `项目 ${pid}`);
                })
                .join(' · ');
        const sub =
          memberIds.length > 1 ? `项目 ID ${memberIds.join('、')}` : base.sub || `项目 ID ${primaryPid}`;
        const unit = base.unit || (memberIds.includes('33') ? '卡' : '路');

        const built = buildSupplyTableForProject(
          memberIds,
          instanceForSupply,
          byteMap,
          orderData,
          vmidMap,
        );
        if (!built) {
          return {
            id: cardId,
            mergedProjectIds: memberIds,
            name,
            unit,
            sub,
            supplyHeadlineDate: null,
            supply: base.supply ?? null,
            order: base.order ?? 0,
            margin: base.margin ?? '+0',
            trend: Array.isArray(base.trend) ? base.trend : [],
            table: Array.isArray(base.table) ? base.table : [],
          };
        }

        const h0 = built[0];
        const supplyHeadlineDate = h0?.date ?? null;
        const cardSupply = Number.isFinite(Number(h0?.max)) ? Math.round(Number(h0.max)) : null;
        const cardOrder = Number.isFinite(Number(h0?.order)) ? Math.round(Number(h0.order)) : 0;

        return {
          id: cardId,
          mergedProjectIds: memberIds,
          name,
          unit,
          sub,
          supplyHeadlineDate,
          margin: base.margin ?? '+0',
          table: built,
          trend: buildTrendFromTable(built),
          order: cardOrder,
          supply: cardSupply !== null ? cardSupply : null,
        };
      });

      // 按当前供应降序；无供应值的卡片放到最后
      cards.sort((a, b) => {
        const as = Number(a?.supply);
        const bs = Number(b?.supply);
        const aOk = Number.isFinite(as);
        const bOk = Number.isFinite(bs);
        if (aOk && bOk) return bs - as;
        if (aOk) return -1;
        if (bOk) return 1;
        const ao = Number(a?.order);
        const bo = Number(b?.order);
        const aoOk = Number.isFinite(ao);
        const boOk = Number.isFinite(bo);
        if (aoOk && boOk) return bo - ao;
        return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
      });

      return cards;
    });
  }, [
    supplyEnv,
    settlementMapEpoch,
    instanceByProjectId,
    bytedanceSupplyByDate,
    ordersByProjectDatePaas,
    ordersByProjectDateYuanli,
    supplyVmidByProjectId,
    supplyYuanliByProjectId,
  ]);

  const supplyProjectsToShow = useMemo(() => {
    if (selectedProjectIds.length === 0) return supplyProjects;
    const sel = new Set(selectedProjectIds.map(String));
    return supplyProjects.filter((p) => {
      if (sel.has(String(p.id))) return true;
      const members = p.mergedProjectIds || projectIdsForSupplyCardId(p.id, supplyEnv);
      return members.some((m) => sel.has(String(m)));
    });
  }, [selectedProjectIds, supplyProjects, supplyEnv]);

  const yuanliMetabaseConfigured = Boolean(
    String(import.meta.env.VITE_YUANLI_METABASE_SESSION_TOKEN || '').trim() ||
      (String(import.meta.env.VITE_YUANLI_METABASE_USERNAME || '').trim() &&
        String(import.meta.env.VITE_YUANLI_METABASE_PASSWORD || '').trim()),
  );

  const filterBarProjects = useMemo(() => {
    if (tabIndicator === 'supply' && supplyEnv === SUPPLY_ENV_YUANLI) {
      const ids = new Set(['5', '6', '8', '10', '20']);
      for (const k of Object.keys(ordersByProjectDateYuanli || {})) ids.add(String(k));
      for (const k of Object.keys(supplyYuanliByProjectId || {})) ids.add(String(k));
      return Array.from(ids)
        .sort((a, b) => {
          const na = Number(a);
          const nb = Number(b);
          if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
          return String(a).localeCompare(String(b), 'zh-CN');
        })
        .map((id) => ({
          id: String(id),
          name: yuanliBizNameForProject(supplyYuanliByProjectId, id) || `项目 ${id}`,
          unit: '路',
        }));
    }
    return instanceProjectOptions.length ? instanceProjectOptions : projects;
  }, [
    tabIndicator,
    supplyEnv,
    instanceProjectOptions,
    ordersByProjectDateYuanli,
    supplyYuanliByProjectId,
  ]);

  const instanceProjectsToShow = useMemo(() => {
    if (selectedProjectIds.length > 0) {
      return instanceProjectOptions.filter((p) => selectedProjectIds.includes(String(p.id)));
    }
    return instanceProjectOptions.length ? instanceProjectOptions : projects;
  }, [selectedProjectIds, instanceProjectOptions]);

  const tabs = [
    { id: 'tasks', label: '游戏云化任务', icon: Zap },
    { id: 'scheduling', label: '调度与体验', icon: Users },
    { id: 'instances', label: '实例任务', icon: List },
    { id: 'supply', label: '供应看板', icon: Monitor },
  ];


  return (
    <div className="vercel-theme min-h-screen bg-white text-[#171717] font-sans selection:bg-[hsla(0,0%,95%,1)] selection:text-[#171717] pb-12">
      {/* 顶部导航 (Header) */}
      <header className="sticky top-0 z-50">
        <div className="w-full px-4 sm:px-6 lg:px-10">
          <div className="flex flex-col items-start gap-3 py-3 md:h-12 md:flex-row md:items-center md:justify-between md:gap-0 md:py-0">
            {/* Logo & Title */}
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="bg-[#171717] p-2 rounded-md">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-semibold leading-tight tracking-[-0.32px]">资源全链路观测</h1>
                <div className="flex items-center gap-1.5 text-xs font-medium text-black">
                  <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                  实时监测已开启
                </div>
              </div>
            </div>

            {/* Tabs */}
            <nav className="flex w-full md:w-auto gap-2 overflow-x-auto whitespace-nowrap pb-1 md:pb-0">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = tabIndicator === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => selectTab(tab.id)}
                    className={`shrink-0 flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium transition-colors duration-100 ${
                      isActive
                        ? 'bg-[#171717] text-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)]'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>

          </div>
        </div>
      </header>

      {/* 主内容区 (Main Content) */}
      <main className="w-full px-4 sm:px-6 lg:px-10 py-8">
        <FilterBar
          projects={filterBarProjects}
          selectedProjectIds={selectedProjectIds}
          setSelectedProjectIds={setSelectedProjectIds}
          loading={useApi && tabIndicator === 'supply' && supplyFetchPending}
        />

        <div className="mt-4 min-h-[min(22rem,52vh)]">
          <div
            key={isTabTransitionPending ? `loading-${tabIndicator}` : `panel-${tabPanel}`}
            className="tab-panel-buffer"
          >
            {isTabTransitionPending ? (
              <TabPanelLoading tabLabel={tabs.find((t) => t.id === tabIndicator)?.label ?? '页面'} />
            ) : (
              <>
                {tabPanel === 'supply' && (
                  <div role="tabpanel" id="tabpanel-supply">
                    <SupplyView
                      projectsToShow={supplyProjectsToShow}
                      supplyFetchPending={supplyFetchPending}
                      supplyEnv={supplyEnv}
                      setSupplyEnv={setSupplyEnv}
                      useApi={useApi}
                      yuanliMetabaseConfigured={yuanliMetabaseConfigured}
                    />
                  </div>
                )}
                {tabPanel === 'scheduling' && (
                  <div role="tabpanel" id="tabpanel-scheduling">
                    <SchedulingView />
                  </div>
                )}
                {tabPanel === 'tasks' && (
                  <div role="tabpanel" id="tabpanel-tasks">
              <CloudTaskView
                liveRowsByPhase={cloudTaskLiveRowsByPhase}
                projectNameOptions={instanceProjectOptions}
              />
                  </div>
                )}
                {tabPanel === 'instances' && (
                  <div role="tabpanel" id="tabpanel-instances">
                    <InstanceView
                      projectsToShow={instanceProjectsToShow}
                      instanceByProjectId={instanceByProjectId}
                      loading={useApi && instanceLoading}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
