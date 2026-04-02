// 结算套餐ID -> 业务项目ID(=PAAS平台映射 biz) 映射
// 说明：
// - Metabase 订单 SQL 会返回 `id`（结算套餐ID），需要把它映射到项目ID后才能聚合出“订单/弹性/总数”
// - 项目ID/结算套餐ID统一用字符串存储，避免数字/字符串混用导致的匹配失败

const SETTLEMENT_ID_TO_PROJECT_IDS = {
  // 你提供的这几行 biz 为空：先不强行映射，交给下游逻辑按“无映射 => 不计入任何项目”
  SPH04LU7: [],
  SPHZMKFI: [],
  SPE9Z0LB: [],
  SP4PBIR5: [],
  SPSWTCMU: [],
  SPY2Q7V7: [],

  SPFLNTMT: ['33'],
  SPVVINT4: ['400'],
  SPF9GCZB: ['400'],
  SP6OOYFE: ['401', '10125'],
  SP2O3A54: ['382'],
  SPR9EP7R: ['33'],
  SPVUVIVX: ['10100', '378'],
  SPWPND37: ['10106'],
  SP2Y4L54: ['76'],
  SP9TC9NB: ['23'],
  SPB9RZ2X: ['23'],
  SPR5IKKW: ['23'],
  SP4KAIHX: ['23'],
  SP8O53XW: ['57'],
  SP7KHG0R: ['69'],
  SP493DS4: ['71'],
  SPFOQ08I: ['68'],
  SPN8DQV8: ['77'],
  SP1Z623M: ['42'],
  SPIWA4P8: ['73', '80'],
  // 临时屏蔽：这些结算套餐暂不计入看板订单聚合
  SPVVF7MQ: [],
  SPP7TRZI: [],
  SP5BLFZK: [],
  SPWO9DD9: [],
  SP8VVP0K: [],

  // 额外：你给了 `378` 和 `400` 等为第二列数据，这些已经在对应 settlement 映射里覆盖
};

function normalizeId(id) {
  return String(id ?? '').trim();
}

/** 统一成 MM-DD，供多数据源按日 join（兼容 ISO、斜杠、Date、时间戳） */
export function normalizeDateKey(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw > 1e12 ? raw : raw * 1000);
    if (!Number.isNaN(d.getTime())) {
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${m}-${day}`;
    }
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${m}-${d}`;
  }
  const s = String(raw).trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}-${iso[3]}`;
  const slash = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (slash) return `${slash[2]}-${slash[3]}`;
  const mmd = /^(\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (mmd) return `${mmd[1].padStart(2, '0')}-${mmd[2].padStart(2, '0')}`;
  if (s.length >= 10 && s.includes('-')) return s.slice(5, 10);
  return s;
}

export function projectIdsFromSettlementId(settlementId) {
  const sid = normalizeId(settlementId);
  return SETTLEMENT_ID_TO_PROJECT_IDS[sid] ? [...SETTLEMENT_ID_TO_PROJECT_IDS[sid]] : [];
}

export function settlementIdsFromProjectId(projectId) {
  const pid = normalizeId(projectId);
  const out = [];
  for (const [sid, pids] of Object.entries(SETTLEMENT_ID_TO_PROJECT_IDS)) {
    if (pids.some((x) => normalizeId(x) === pid)) out.push(sid);
  }
  return out;
}

// 反向映射缓存：projectId -> settlementIds
let _projectIdToSettlementIds = null;
export function getProjectIdToSettlementIds() {
  if (_projectIdToSettlementIds) return _projectIdToSettlementIds;
  const map = {};
  for (const [sid, pids] of Object.entries(SETTLEMENT_ID_TO_PROJECT_IDS)) {
    for (const pid of pids) {
      const p = normalizeId(pid);
      if (!p) continue;
      if (!map[p]) map[p] = [];
      map[p].push(sid);
    }
  }
  _projectIdToSettlementIds = map;
  return map;
}

export const __SETTLEMENT_ID_TO_PROJECT_IDS__ = SETTLEMENT_ID_TO_PROJECT_IDS;

function idxByColName(cols) {
  const map = {};
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i] || {};
    const name = normalizeId(c.name ?? c.display_name ?? '');
    if (!name) continue;
    map[name] = i;
    // Metabase 有时返回 `表名.列名`，再挂一份短名方便 idx.date 命中
    const short = name.includes('.') ? normalizeId(name.split('.').pop()) : '';
    if (short && map[short] === undefined) map[short] = i;
  }
  return map;
}

/** 按别名匹配列（兼容短名、带 schema/表前缀、大小写） */
function colIndexByAliases(cols, aliases) {
  const wants = aliases.map((a) => normalizeId(a).toLowerCase());
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i] || {};
    const raw = normalizeId(c.name ?? c.display_name ?? '');
    if (!raw) continue;
    const variants = [raw.toLowerCase()];
    if (raw.includes('.')) variants.push(raw.split('.').pop().toLowerCase());
    if (wants.some((w) => variants.includes(w))) return i;
  }
  return -1;
}

// 某些项目会映射到多个 settlement_id：默认多套餐 **相加**；字节多套餐 **取大**（避免重复口径）
const PROJECT_ORDER_AGGREGATION_STRATEGY = {
  '33': 'max',
};

// 将订单 Metabase dataset 结果聚合成：projectId -> date -> { total, month, elastic }
// 适配你的 SQL 返回字段：
// - date
// - id （结算套餐ID）
// - max    （plan_total = 包月+按天合计；你这里称“总数”）
// - max_2  （plan_month_quantity；包月）
// - max_3  （plan_day_quantity；按天=弹性）
export function aggregateOrdersDatasetByProjectDate(dataset) {
  const cols = dataset?.data?.cols ?? [];
  const rows = dataset?.data?.rows ?? [];
  const idx = idxByColName(cols);

  const idxDate =
    idx.date ??
    idx['date'] ??
    colIndexByAliases(cols, ['date']);
  const idxId =
    idx.id ??
    idx['id'] ??
    colIndexByAliases(cols, ['id']);
  const idxMax =
    idx.max ??
    colIndexByAliases(cols, ['max']);
  const idxMax2 =
    idx.max_2 ??
    idx.max2 ??
    colIndexByAliases(cols, ['max_2', 'max2']);
  const idxMax3 =
    idx.max_3 ??
    idx.max3 ??
    colIndexByAliases(cols, ['max_3', 'max3']);

  if (idxDate === -1 || idxId === -1 || idxMax === -1 || idxMax2 === -1 || idxMax3 === -1) {
    // 不要静默产出错误结构，直接暴露问题
    const names = cols.map((c) => c?.name ?? c?.display_name ?? '').join(', ');
    throw new Error(`aggregateOrdersDatasetByProjectDate: missing expected columns. cols=${names}`);
  }

  const byProject = {};
  const byProjectDateSettlement = {};

  for (const r of rows) {
    const date = normalizeDateKey(r[idxDate]);
    const settlementId = normalizeId(r[idxId]);
    const total = Number(r[idxMax] ?? 0);
    const month = Number(r[idxMax2] ?? 0);
    const elastic = Number(r[idxMax3] ?? 0);

    if (!date || !settlementId) continue;
    if (!Number.isFinite(total) || !Number.isFinite(month) || !Number.isFinite(elastic)) continue;

    const projectIds = projectIdsFromSettlementId(settlementId);
    if (!projectIds.length) continue;

    // 一个结算套餐映射多个项目：每个项目各记一笔；同项目多套餐在阶段二按 sum 聚合
    for (const rawProjectId of projectIds) {
      const projectId = normalizeId(rawProjectId);
      if (!projectId) continue;
      if (!byProjectDateSettlement[projectId]) byProjectDateSettlement[projectId] = {};
      if (!byProjectDateSettlement[projectId][date]) byProjectDateSettlement[projectId][date] = {};
      byProjectDateSettlement[projectId][date][settlementId] = { total, month, elastic };
    }
  }

  // 第二阶段：按项目策略聚合
  for (const [projectId, dateMap] of Object.entries(byProjectDateSettlement)) {
    if (!byProject[projectId]) byProject[projectId] = {};
    const strategy = PROJECT_ORDER_AGGREGATION_STRATEGY[projectId] || 'sum';

    for (const [date, settlementMap] of Object.entries(dateMap)) {
      const vals = Object.values(settlementMap);
      if (!vals.length) continue;

      if (strategy === 'max') {
        let best = vals[0];
        for (const v of vals) {
          if (Number(v.total) > Number(best.total)) best = v;
        }
        byProject[projectId][date] = {
          total: Number(best.total) || 0,
          month: Number(best.month) || 0,
          elastic: Number(best.elastic) || 0,
        };
      } else {
        let total = 0;
        let month = 0;
        let elastic = 0;
        for (const v of vals) {
          total += Number(v.total) || 0;
          month += Number(v.month) || 0;
          elastic += Number(v.elastic) || 0;
        }
        byProject[projectId][date] = { total, month, elastic };
      }
    }
  }

  return byProject;
}


