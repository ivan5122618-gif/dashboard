import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';

import { aggregateOrdersDatasetByProjectDate, normalizeDateKey } from './supply/settlementToProject.js';

const useApi =
  String(import.meta.env.VITE_USE_API || '').toLowerCase() === '1' ||
  String(import.meta.env.VITE_USE_API || '').toLowerCase() === 'true';

const metabaseUser = String(import.meta.env.VITE_METABASE_USERNAME || '').trim();
const metabasePass = String(import.meta.env.VITE_METABASE_PASSWORD || '').trim();
/** 可变 session：优先 .env TOKEN；401 时用账号密码向 /api/session 换新 */
let metabaseSessionId = String(import.meta.env.VITE_METABASE_SESSION_TOKEN || '').trim();
let metabaseLoginPromise = null;

async function refreshMetabaseSessionViaLogin() {
  if (!metabaseUser || !metabasePass) {
    throw new Error(
      'Metabase 401：请在 .env 更新 VITE_METABASE_SESSION_TOKEN，或填写 VITE_METABASE_USERNAME / VITE_METABASE_PASSWORD 以自动登录',
    );
  }
  if (metabaseLoginPromise) return metabaseLoginPromise;

  metabaseLoginPromise = (async () => {
    const res = await fetch('/api/metabase/api/session', {
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

async function queryMetabaseNative({ database, query }) {
  const run = () =>
    fetch('/api/metabase/api/dataset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(metabaseSessionId ? { 'X-Metabase-Session': metabaseSessionId } : {}),
      },
      body: JSON.stringify({
        type: 'native',
        database,
        native: { query },
      }),
    });

  let res = await run();
  if (res.status === 401) {
    await refreshMetabaseSessionViaLogin();
    res = await run();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Metabase query failed: ${res.status} ${text}`);
  }

  return res.json();
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

/** 一张供应卡片对应多个业务 project_id 时，按日合并订单（同套餐双 id 取 max 去重） */
const SUPPLY_CARD_ORDER_SOURCE_IDS = {
  '401': ['401', '10125'],
  '378': ['378', '10100'],
};

/** 多 project_id 并到一张卡：同一结算套餐会落到两个 id 上数值相同，按日取 max 去重，避免相加 double */
function orderMapMergedForSupplyCard(pid, ordersByProjectDate) {
  const keys = SUPPLY_CARD_ORDER_SOURCE_IDS[pid] || [pid];
  const map = {};
  for (const key of keys) {
    const raw = ordersByProjectDate?.[String(key)] || {};
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

/**
 * 按项目合并：实例 7d 总门路数、字节 g_instance_id、订单。
 * - 33：日期仅来自字节专用 SQL；订单只按同日合并。
 * - 其它：日期来自实例 7d；无实例行时暂用订单日期但最多 SUPPLY_TABLE_DAYS 天（供应列为 — 表示实例 SQL 未返回该项目）。
 */
function buildSupplyTableForProject(projectId, instanceRows, byteSupplyByDate, ordersByProjectDate) {
  const pid = String(projectId);
  const instByD = {};
  for (const r of instanceRows || []) {
    const d = normalizeDateKey(r.date);
    if (!d) continue;
    instByD[d] = r;
  }

  const byteRaw = pid === '33' ? byteSupplyByDate || {} : {};
  const byteByD = {};
  for (const [k, v] of Object.entries(byteRaw)) {
    const d = normalizeDateKey(k);
    if (d) byteByD[d] = v;
  }

  const orderMapRaw = orderMapMergedForSupplyCard(pid, ordersByProjectDate);
  const orderMap = {};
  for (const [k, v] of Object.entries(orderMapRaw)) {
    const d = normalizeDateKey(k);
    if (d) orderMap[d] = v;
  }

  const dates = new Set();
  // 字节（33）：表格行数与日期只跟「专用 g_instance_id 近 7 天 SQL」一致，不并入订单/实例的其它日期
  if (pid === '33') {
    for (const d of Object.keys(byteByD)) dates.add(d);
    if (dates.size === 0) return null;
  } else if (Object.keys(instByD).length > 0) {
    for (const d of Object.keys(instByD)) dates.add(d);
  } else {
    for (const d of Object.keys(orderMap)) dates.add(d);
    if (dates.size === 0) return null;
  }

  const sortedDesc = sortDatesMmDdNewestFirst(Array.from(dates)).slice(0, SUPPLY_TABLE_DAYS);

  return sortedDesc.map((date) => {
    const inst = instByD[date];
    const byteHit = pid === '33' ? byteByD[date] : undefined;
    let max;
    let avg;

    if (pid === '33' && byteHit && (Number.isFinite(byteHit.max) || Number.isFinite(byteHit.avg))) {
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
    AND toHour(fmt_ts) >= 12
    AND toHour(fmt_ts) < 20

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
       AND \`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`dt\` < toDate(now())
       AND \`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`project_id\` = '33'
       AND toHour(toDateTime(\`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`fmt_ts\`)) >= 12
       AND toHour(toDateTime(\`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`fmt_ts\`)) < 20)
    GROUP BY
        toDate(fmt_ts),
        toStartOfMinute(toDateTime(\`game\`.\`dwd_cloudgame_game_vminfo_v2_inc\`.\`fmt_ts\`))
) t
GROUP BY dt
ORDER BY dt ASC`;

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
    AND coms_purchase_order_settlement_view.date >= date_add(
      str_to_date(
        concat(yearweek(date_add(date_add(now(6), INTERVAL -1 week), INTERVAL -1 day)), ' Sunday'),
        '%X%V %W'
      ),
      INTERVAL 1 day
    )
    AND coms_purchase_order_settlement_view.date < date_add(
      str_to_date(
        concat(yearweek(date_add(date_add(now(6), INTERVAL 1 week), INTERVAL -1 day)), ' Sunday'),
        '%X%V %W'
      ),
      INTERVAL 1 day
    )
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

const FilterBar = ({ projects, selectedProjectIds, setSelectedProjectIds }) => {
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
      <div className="flex items-center gap-3">
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

      <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200">
        {['24h', '7天', '30天'].map((time, i) => (
          <button
            key={time}
            className={`px-4 py-1 text-sm rounded-md transition-colors ${
              i === 0 ? 'bg-white shadow-sm font-medium text-blue-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {time}
          </button>
        ))}
      </div>
    </div>
  );
};

// --- 视图组件 (Views based on images) ---
// 1. 供应看板 (Supply Dashboard)
const SupplyView = ({ projectsToShow }) => {
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const list = Array.isArray(projectsToShow) && projectsToShow.length > 0 ? projectsToShow : projects;
  const totalSupply = list.reduce((sum, p) => sum + (typeof p.supply === 'number' ? p.supply : 0), 0);
  const totalOrders = list.reduce((sum, p) => sum + (typeof p.order === 'number' ? p.order : 0), 0);
  const redundancyRatio =
    totalOrders > 0 ? ((totalSupply - totalOrders) / totalOrders) * 100 : 0;

  const accentPalettes = [
    { border: 'border-indigo-200', chip: 'bg-indigo-50 text-indigo-700', chart: '#4f46e5' },
    { border: 'border-emerald-200', chip: 'bg-emerald-50 text-emerald-700', chart: '#059669' },
    { border: 'border-sky-200', chip: 'bg-sky-50 text-sky-700', chart: '#0284c7' },
    { border: 'border-rose-200', chip: 'bg-rose-50 text-rose-700', chart: '#e11d48' },
    { border: 'border-amber-200', chip: 'bg-amber-50 text-amber-700', chart: '#d97706' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* 顶部总览卡片 */}
      <Card className="p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h2 className="text-sm font-medium text-slate-500 mb-2 flex items-center gap-2">
              <Layers className="w-4 h-4" /> 供应监控冗余
            </h2>
            <div className="flex items-baseline gap-4">
              <span className="text-5xl font-bold text-slate-900 tracking-tight">
                {redundancyRatio.toFixed(1)}
                <span className="text-3xl">%</span>
              </span>
              <TrendBadge value={`所有项目: 供应 ${totalSupply} / 订单 ${totalOrders}`} isPositive={redundancyRatio >= 0} />
            </div>
          </div>

          <div className="flex gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100 min-w-[300px]">
            <div className="flex-1">
              <p className="text-xs text-slate-400 mb-1">供应 (当前)</p>
              <p className="text-xl font-semibold text-slate-700">{totalSupply.toLocaleString()}</p>
            </div>
            <div className="w-px bg-slate-200" />
            <div className="flex-1">
              <p className="text-xs text-slate-400 mb-1">订单 (当前)</p>
              <p className="text-xl font-semibold text-slate-700">{totalOrders.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* 项目栅格：保证 100% 缩放下也尽量看得到 3 列 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((proj) => {
          const hasSupplyNum = typeof proj.supply === 'number' && Number.isFinite(proj.supply);
          const marginPct =
            hasSupplyNum && typeof proj.order === 'number' && proj.order > 0
              ? ((proj.supply - proj.order) / proj.order) * 100
              : 0;
          const values = Array.isArray(proj.trend) ? proj.trend.map((d) => d.value) : [];
          const current = values.length ? values[values.length - 1] : 0;
          const max = values.length ? Math.max(...values) : 0;
          const min = values.length ? Math.min(...values) : 0;

          const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
          const tone = (v) => (v >= 0 ? 'text-emerald-600' : 'text-rose-600');
          const pillBg = (v) => (v >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600');
          const palette = accentPalettes[Number(proj.id) % accentPalettes.length] || accentPalettes[0];

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
                <span className={`text-xs px-2 py-1 rounded font-medium ${palette.chip}`}>冗余 {fmtPct(marginPct)}</span>
              </div>
            </div>

            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-sm text-slate-500">
                当前{proj.unit === '卡' ? '卡数' : '路数'}{' '}
                <strong className="text-slate-800 text-lg">
                  {hasSupplyNum ? proj.supply : '—'}
                </strong>
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-sm text-slate-500">
                当前订单 <strong className="text-slate-800 text-lg">{proj.order}</strong>
              </span>
            </div>

            <div className="h-28 w-full mb-4">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>近7天冗余率 (%)</span>
              </div>
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
  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
const InstanceView = ({ projectsToShow, instanceByProjectId }) => {
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
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

            <div className="h-24 w-full mb-2 overflow-visible">
              <p className="text-xs text-slate-400 mb-1">近 7 天可用率</p>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={proj.trend} margin={{ top: 0, right: 0, left: 0, bottom: 6 }}>
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
                    width={28}
                    dx={-6}
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
  const [supplyProjects, setSupplyProjects] = useState(projects);
  const [bytedanceSupplyByDate, setBytedanceSupplyByDate] = useState({});
  const [ordersByProjectDate, setOrdersByProjectDate] = useState(undefined);

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
    if (!shouldFetchCurrent && !shouldFetchTrend) return;
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
        const curPromise = shouldFetchCurrent
          ? queryMetabaseNative({ database: INSTANCE_CURRENT_DB_ID, query: INSTANCE_CURRENT_AVAILABLE_SQL })
          : Promise.resolve(null);
        const trendPromise = shouldFetchTrend
          ? queryMetabaseNative({ database: INSTANCE_AVAILABILITY_7D_DB_ID, query: INSTANCE_AVAILABILITY_7D_SQL })
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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 供应看板：订单（写入 state；与实例/字节在同一 effect 里按项目合并，避免先后覆盖）
  useEffect(() => {
    if (!useApi) return;
    let cancelled = false;
    (async () => {
      try {
        const dataset = await queryMetabaseNative({
          database: METABASE_SUPPLY_ORDERS_DB_ID,
          query: METABASE_SQL_SUPPLY_ORDERS_7D_BY_SETTLEMENT,
        });
        if (cancelled) return;
        setOrdersByProjectDate(aggregateOrdersDatasetByProjectDate(dataset));
      } catch (e) {
        console.warn('[供应] 拉取订单失败，继续使用 mock', e);
        if (!cancelled) setOrdersByProjectDate({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 供应看板：按项目用「实例 7d / 字节 / 订单」日期并集重建表格（不再多套 mock 行）
  useEffect(() => {
    if (!useApi) return;
    const byProject = instanceByProjectId || {};
    const byteMap = bytedanceSupplyByDate || {};
    const hasInstance = Object.keys(byProject).length > 0;
    const hasByte = Object.keys(byteMap).length > 0;
    const ordersReady = ordersByProjectDate !== undefined;
    if (!hasInstance && !hasByte && !ordersReady) return;

    const orderData = ordersByProjectDate ?? {};

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

      // 供应看板项目：取“已有卡片 + 实例返回 + 订单返回 + 字节固定项目”
      const allIds = new Set([
        ...Object.keys(prevById),
        ...Object.keys(byProject),
        ...Object.keys(orderData),
      ]);
      if (hasByte) allIds.add('33');

      const idList = Array.from(allIds);

      const cards = idList.map((pid) => {
        const base = prevById[pid] || seedById[pid] || {};
        const fromInstance = byProject[pid];
        const name =
          base.name ||
          fromInstance?.name ||
          (pid === '33' ? '字节跳动' : `项目 ${pid}`);
        const unit = base.unit || (pid === '33' ? '卡' : '路');

        const instanceRows = instanceRowsForSupplyProject(pid, byProject);
        const built = buildSupplyTableForProject(pid, instanceRows, byteMap, orderData);
        if (!built) {
          return {
            id: pid,
            name,
            unit,
            sub: base.sub,
            supply: base.supply ?? null,
            order: base.order ?? 0,
            margin: base.margin ?? '+0',
            trend: Array.isArray(base.trend) ? base.trend : [],
            table: Array.isArray(base.table) ? base.table : [],
          };
        }

        let cardOrder = Number.isFinite(Number(base.order)) ? Number(base.order) : 0;
        for (const row of built) {
          if (Number.isFinite(Number(row.order))) {
            cardOrder = Math.round(Number(row.order));
            break;
          }
        }
        let cardSupply = null;
        for (const row of built) {
          if (Number.isFinite(Number(row.max))) {
            cardSupply = Math.round(Number(row.max));
            break;
          }
        }

        return {
          id: pid,
          name,
          unit,
          sub: base.sub,
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
  }, [instanceByProjectId, bytedanceSupplyByDate, ordersByProjectDate]);

  const supplyProjectsToShow =
    selectedProjectIds.length > 0
      ? supplyProjects.filter((p) => selectedProjectIds.includes(String(p.id)))
      : supplyProjects;

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
                    onClick={() => setActiveTab(tab.id)}
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
          projects={instanceProjectOptions.length ? instanceProjectOptions : projects}
          selectedProjectIds={selectedProjectIds}
          setSelectedProjectIds={setSelectedProjectIds}
        />

        <div className="mt-4">
          {activeTab === 'supply' && <SupplyView projectsToShow={supplyProjectsToShow} />}
          {activeTab === 'scheduling' && <SchedulingView />}
          {activeTab === 'tasks' && <CloudTaskView />}
          {activeTab === 'instances' && (
            <InstanceView projectsToShow={instanceProjectsToShow} instanceByProjectId={instanceByProjectId} />
          )}
        </div>
      </main>
    </div>
  );
}
