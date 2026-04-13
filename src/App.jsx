import React, { useEffect, useMemo, useState, startTransition } from 'react';
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
} from 'lucide-react';

import {
  aggregateOrdersDatasetByProjectDate,
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

const metabaseUser = String(import.meta.env.VITE_METABASE_USERNAME || '').trim();
const metabasePass = String(import.meta.env.VITE_METABASE_PASSWORD || '').trim();
/** 可变 session：优先 .env TOKEN；401 时用账号密码向 /api/session 换新 */
let metabaseSessionId = String(import.meta.env.VITE_METABASE_SESSION_TOKEN || '').trim();
let metabaseLoginPromise = null;

const yuanliMetabaseUser = String(import.meta.env.VITE_YUANLI_METABASE_USERNAME || '').trim();
const yuanliMetabasePass = String(import.meta.env.VITE_YUANLI_METABASE_PASSWORD || '').trim();
/** 原力站点根（无末尾 /）。设置后 session、dataset 均请求「该域名 + /api/...」；不设置则走开发代理 /api/metabase-yl */
const yuanliMetabaseBaseUrl = String(
  import.meta.env.VITE_YUANLI_METABASE_BASE_URL || '',
)
  .trim()
  .replace(/\/+$/, '');
let yuanliMetabaseSessionId = String(import.meta.env.VITE_YUANLI_METABASE_SESSION_TOKEN || '').trim();
let yuanliMetabaseLoginPromise = null;

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
      const res = await fetch(`${metabaseApiPrefix(SUPPLY_ENV_YUANLI)}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: yuanliMetabaseUser, password: yuanliMetabasePass }),
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        throw new Error(`原力 Metabase 登录失败 ${res.status}: ${text.slice(0, 500)}`);
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`原力 Metabase 登录响应非 JSON: ${text.slice(0, 200)}`);
      }
      const id = data?.id;
      if (!id) throw new Error('原力 Metabase 登录未返回 session id');
      yuanliMetabaseSessionId = String(id);
      return yuanliMetabaseSessionId;
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
  const run = () => {
    const token = audience === SUPPLY_ENV_YUANLI ? yuanliMetabaseSessionId : metabaseSessionId;
    return fetch(`${prefix}/api/dataset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Metabase-Session': token } : {}),
      },
      body: JSON.stringify({
        type: 'native',
        database,
        native: { query, 'template-tags': {} },
      }),
    });
  };

  let res = await run();
  if (res.status === 401) {
    await res.text().catch(() => '');
    await refreshMetabaseSessionViaLogin(audience);
    res = await run();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Metabase query failed: ${res.status} ${text}`);
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

const cloudTaskTrend = generateTrendData(7, 25, 5);
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

const FilterBar = ({ projects, selectedProjectIds, setSelectedProjectIds, loading = false }) => {
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
    <div className="flex flex-wrap items-center justify-between gap-4 mb-6 bg-white p-3 rounded-xl shadow-sm border border-slate-100">
      <div className="flex items-center gap-3 flex-wrap">
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

        <div className="relative">
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
            className="pl-3 pr-10 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64 bg-slate-50"
          />

          {open && options.length > 0 && (
            <div className="absolute left-0 top-full mt-2 z-50 w-72 max-h-64 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
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
            <div className="absolute left-0 top-full mt-2 z-50 w-72 rounded-2xl border border-slate-200 bg-white shadow-xl">
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
        <div />
      )}
    </div>
  );
};

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
  const toggleExpand = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

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

  const accentPalettes = [
    { border: 'border-indigo-200', chip: 'bg-indigo-50 text-indigo-700', chart: '#4f46e5' },
    { border: 'border-emerald-200', chip: 'bg-emerald-50 text-emerald-700', chart: '#059669' },
    { border: 'border-sky-200', chip: 'bg-sky-50 text-sky-700', chart: '#0284c7' },
    { border: 'border-rose-200', chip: 'bg-rose-50 text-rose-700', chart: '#e11d48' },
    { border: 'border-amber-200', chip: 'bg-amber-50 text-amber-700', chart: '#d97706' },
  ];

  const onEnv = typeof setSupplyEnv === 'function' ? setSupplyEnv : () => {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEnv(SUPPLY_ENV_PAAS)}
          className={`rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
            supplyEnv === SUPPLY_ENV_PAAS
              ? 'border-blue-200 bg-blue-50 text-blue-800 shadow-sm'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          自建 PAAS
        </button>
        <button
          type="button"
          onClick={() => onEnv(SUPPLY_ENV_YUANLI)}
          className={`rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
            supplyEnv === SUPPLY_ENV_YUANLI
              ? 'border-blue-200 bg-blue-50 text-blue-800 shadow-sm'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          原力环境
        </button>
      </div>

      {useApiProp && supplyFetchPending && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" aria-hidden />
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

          <div className="flex gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100 min-w-[300px]">
            <div className="flex-1">
              <p className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
                供应峰值（各卡最近一日）
                {useApiProp && supplyFetchPending ? (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-500" aria-hidden />
                ) : null}
              </p>
              <p className="text-xl font-semibold text-slate-700">{totalSupply.toLocaleString()}</p>
            </div>
            <div className="w-px bg-slate-200" />
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
        {list.map((proj) => {
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
            accentPalettes[Math.abs(paletteSeed) % accentPalettes.length] || accentPalettes[0];

          return (
          <Card
            key={proj.id}
            className={`p-4 flex flex-col hover:shadow-md transition-shadow ${palette.border}`}
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
                <ResponsiveContainer width="100%" height="100%">
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
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs mb-3 flex-wrap">
              <span className={`px-2 py-0.5 rounded font-medium ${pillBg(current)}`}>
                当前 {fmtPct(current)}
              </span>
              <span className="text-slate-500">
                高 <strong className={tone(max)}>{fmtPct(max)}</strong>
              </span>
              <span className="text-slate-500">
                低 <strong className={tone(min)}>{fmtPct(min)}</strong>
              </span>
            </div>

            <button
              onClick={() => toggleExpand(proj.id)}
              className="text-blue-500 hover:text-blue-600 text-sm font-medium flex items-center transition-colors self-start mb-2"
            >
              {expanded[proj.id] ? (
                <>
                  收起表格 <ChevronUp className="w-4 h-4 ml-0.5" />
                </>
              ) : (
                <>
                  展开表格 <ChevronDown className="w-4 h-4 ml-0.5" />
                </>
              )}
            </button>

            {expanded[proj.id] && (
              <div className="mt-3 pt-3 border-t border-slate-100 overflow-x-auto animate-in slide-in-from-top-2 fade-in duration-200">
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
          })}
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
          <div className="text-7xl font-black text-slate-900 tracking-tighter mb-6">658</div>

          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-600 px-3 py-2 rounded-lg text-sm font-medium w-fit border border-emerald-100">
            <Activity className="w-4 h-4" /> 峰值时间: 04-01 14:40
          </div>
        </div>

        {/* 右侧面积图 */}
        <div className="lg:w-2/3 h-[400px]">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm font-medium text-slate-500">近24小时排队趋势</p>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={queueData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
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
              <Area type="monotone" dataKey="users" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorUsers)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  </div>
);

// 3. 游戏云化任务 (Cloudification Tasks)
const CloudTaskView = () => (
  <div className="space-y-6">
    <Card className="overflow-hidden relative">
      {/* 装饰性背景 */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-full blur-3xl -mr-20 -mt-20 opacity-50 pointer-events-none" />

      <div className="p-8 flex flex-col md:flex-row items-center gap-10">
        <div className="md:w-1/3 shrink-0 relative z-10">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-blue-600 mb-6">
            <Zap className="w-5 h-5" /> 游戏云化任务
          </h2>
          <p className="text-sm font-medium text-slate-500 mb-2">云化任务平均耗时</p>
          <div className="flex items-end gap-3 mb-2">
            <span className="text-6xl font-black text-slate-900 tracking-tighter">26.3</span>
            <span className="text-2xl font-bold text-slate-500 mb-1">min</span>
          </div>
          <div className="inline-flex items-center gap-1.5 text-emerald-500 text-sm font-medium mt-2">
            <Activity className="w-4 h-4" /> 正常运行中
          </div>
        </div>

        <div className="md:w-2/3 h-[200px] w-full border-l border-slate-100 pl-10 relative z-10">
          <p className="text-sm text-slate-400 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" /> 24小时实时趋势
          </p>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={cloudTaskTrend}>
              <defs>
                <linearGradient id="colorCloud" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorCloud)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  </div>
);

// 4. 实例任务 (Instance Tasks)
const InstanceView = ({ projectsToShow, instanceByProjectId, loading = false }) => {
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const list = Array.isArray(projectsToShow) && projectsToShow.length > 0 ? projectsToShow : projects;

  const instanceProjects = list
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

  const overallAvailabilitySeries = (() => {
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
  })();

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
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={overallAvailabilitySeries}>
                <defs>
                  <linearGradient id="colorAvail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
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
                  stroke="#0ea5e9"
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
          <Card key={proj.id} className="p-3 border border-slate-200 flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="bg-slate-900 text-white font-bold px-2.5 py-1 rounded-full text-sm shrink-0">#{i + 1}</span>
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
                <p className="text-[12px] font-black text-emerald-600">
                  {proj.avail}
                </p>
              </div>
            </div>

            <div className="h-28 w-full mb-3 overflow-visible">
              <p className="text-xs text-slate-400 mb-1">近 7 天可用率</p>
              <ResponsiveContainer width="100%" height="100%">
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
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center gap-3 text-sm mb-4">
              <span className="text-slate-500">
                高 <strong className="text-emerald-500">{proj.high}</strong>
              </span>
              <span className="text-slate-500">
                低 <strong className="text-rose-500">{proj.low}</strong>
              </span>
            </div>

            <div className="border-t border-slate-100 pt-3 mt-auto">
              <div className="flex justify-end">
                <button
                  onClick={() => toggleExpand(proj.id)}
                  className="text-slate-500 hover:text-slate-800 text-xs font-medium flex items-center transition-colors"
                >
                  {expanded[proj.id] ? (
                    <>
                      收起按日明细 <ChevronUp className="w-3 h-3 ml-0.5" />
                    </>
                  ) : (
                    <>
                      展开按日明细 <ChevronDown className="w-3 h-3 ml-0.5" />
                    </>
                  )}
                </button>
              </div>

              {expanded[proj.id] && (
                <div className="mt-4 overflow-x-auto animate-in slide-in-from-top-2 fade-in duration-200">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-100">
                        <th className="pb-3 font-medium">日期 (月日)</th>
                        <th className="pb-3 font-medium text-right">实例可用率 (%)</th>
                        <th className="pb-3 font-medium text-right">健康实例数</th>
                        <th className="pb-3 font-medium text-right">总门路数</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700">
                      {proj.table.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                          <td className="py-3 font-medium">{row.date}</td>
                          <td className="py-3 text-right">{row.avail}</td>
                          <td className="py-3 text-right">{row.health}</td>
                          <td className="py-3 text-right">{row.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

// --- 主应用组件 (Main App Component) ---
export default function App() {
  const [activeTab, setActiveTab] = useState('supply');
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
  const [instanceLoading, setInstanceLoading] = useState(() => useApi);

  useEffect(() => {
    if (!useApi) setInstanceLoading(false);
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
        setOrdersByProjectDatePaas(aggregateOrdersDatasetByProjectDate(dataset, SUPPLY_ENV_PAAS));
        setOrdersByProjectDateYuanli(aggregateOrdersDatasetByProjectDate(dataset, SUPPLY_ENV_YUANLI));
      } catch (e) {
        console.warn('[供应] 订单拉取失败（自建 Metabase；原力映射同源 dataset）', e);
        if (!cancelled) {
          setOrdersByProjectDatePaas({});
          setOrdersByProjectDateYuanli({});
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
  }, []);

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
    instanceByProjectId,
    bytedanceSupplyByDate,
    ordersByProjectDatePaas,
    ordersByProjectDateYuanli,
    supplyVmidByProjectId,
    supplyYuanliByProjectId,
  ]);

  const supplyProjectsToShow =
    selectedProjectIds.length > 0
      ? supplyProjects.filter((p) => {
          const sel = new Set(selectedProjectIds.map(String));
          if (sel.has(String(p.id))) return true;
          const members = p.mergedProjectIds || projectIdsForSupplyCardId(p.id, supplyEnv);
          return members.some((m) => sel.has(String(m)));
        })
      : supplyProjects;

  const yuanliMetabaseConfigured = Boolean(
    String(import.meta.env.VITE_YUANLI_METABASE_SESSION_TOKEN || '').trim() ||
      (String(import.meta.env.VITE_YUANLI_METABASE_USERNAME || '').trim() &&
        String(import.meta.env.VITE_YUANLI_METABASE_PASSWORD || '').trim()),
  );

  const filterBarProjects = useMemo(() => {
    if (activeTab === 'supply' && supplyEnv === SUPPLY_ENV_YUANLI) {
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
    activeTab,
    supplyEnv,
    instanceProjectOptions,
    ordersByProjectDateYuanli,
    supplyYuanliByProjectId,
  ]);

  const instanceProjectsToShow =
    selectedProjectIds.length > 0
      ? instanceProjectOptions.filter((p) => selectedProjectIds.includes(String(p.id)))
      : instanceProjectOptions.length
        ? instanceProjectOptions
        : projects;

  const tabs = [
    { id: 'tasks', label: '游戏云化任务', icon: Zap },
    { id: 'scheduling', label: '调度与体验', icon: Users },
    { id: 'instances', label: '实例任务', icon: List },
    { id: 'supply', label: '供应看板', icon: Monitor },
  ];


  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900 pb-12">
      {/* 顶部导航 (Header) */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo & Title */}
            <div className="flex items-center gap-4">
              <div className="bg-slate-900 p-2 rounded-lg">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight">资源全链路观测</h1>
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  实时监测已开启
                </div>
              </div>
            </div>

            {/* Tabs */}
            <nav className="hidden md:flex gap-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => startTransition(() => setActiveTab(tab.id))}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      isActive ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>

          </div>
        </div>
      </header>

      {/* 主内容区 (Main Content) */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <FilterBar
          projects={filterBarProjects}
          selectedProjectIds={selectedProjectIds}
          setSelectedProjectIds={setSelectedProjectIds}
          loading={useApi && activeTab === 'supply' && supplyFetchPending}
        />

        <div className="mt-4">
          {activeTab === 'supply' && (
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
          {activeTab === 'scheduling' && (
            <div role="tabpanel" id="tabpanel-scheduling">
              <SchedulingView />
            </div>
          )}
          {activeTab === 'tasks' && (
            <div role="tabpanel" id="tabpanel-tasks">
              <CloudTaskView />
            </div>
          )}
          {activeTab === 'instances' && (
            <div role="tabpanel" id="tabpanel-instances">
              <InstanceView
                projectsToShow={instanceProjectsToShow}
                instanceByProjectId={instanceByProjectId}
                loading={useApi && instanceLoading}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
