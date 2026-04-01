import { fetchJson } from './httpClient.js';

/**
 * 这里是你需要“填空”的 API 调用层。
 *
 * 你只要做两件事：
 * - **填接口地址**（URL）
 * - **把后端返回字段映射成前端需要的结构**（见每个函数的返回示例）
 *
 * 注意：目前前端内置了 mock 数据兜底；当你把下面函数实现好后，页面会自动切换到接口数据。
 */

// 你可以把 baseURL 改成你们网关地址，也可以用 Vite 环境变量：
// 例如在 `.env` 里写：VITE_API_BASE_URL=http://xx.xx.xx.xx:8080
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function buildUrl(path) {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
}

// ---------------- Metabase 相关配置（你需要在这里填空） ----------------

/**
 * Metabase 基础地址。
 * - 直连：填完整地址，例如 https://metabase.vrviu.com（不要带 /api/dataset）
 * - 走代理（推荐，可避免 CORS）：在 .env 设 VITE_METABASE_USE_PROXY=true，此处会变为 /api/metabase，由 vite.config.js 代理到上方 target
 */
const USE_METABASE_PROXY =
  String(import.meta.env.VITE_METABASE_USE_PROXY || '').toLowerCase() === 'true' ||
  String(import.meta.env.VITE_METABASE_USE_PROXY || '').toLowerCase() === '1';
const METABASE_BASE_URL = USE_METABASE_PROXY
  ? '/api/metabase'
  : (import.meta.env.VITE_METABASE_BASE_URL || '');

/**
 * 两种方式二选一：
 * 1）直接把已获取的 Session Token 填到 METABASE_SESSION_TOKEN（推荐在后端生成再下发）
 * 2）或者填用户名/密码，前端先调用 /api/session 换取 token（仅在内网/测试环境建议这样做）
 */
const METABASE_SESSION_TOKEN = import.meta.env.VITE_METABASE_SESSION_TOKEN || ''; // TODO: 在 .env 中填写（推荐）

const METABASE_USERNAME = import.meta.env.VITE_METABASE_USERNAME || ''; // TODO: 在 .env 中填写（可选）
const METABASE_PASSWORD = import.meta.env.VITE_METABASE_PASSWORD || ''; // TODO: 在 .env 中填写（可选）

/**
 * 自动云化平均时长的数据查询配置：
 * - 对应界面：顶部云化 Tab 的“云化任务平均耗时”（以及你后续要扩展的曲线）
 * - 你只需要把 databaseId 和 SQL 填好
 */
const METABASE_DATABASE_ID_FOR_AUTOCLOUD = Number(import.meta.env.VITE_METABASE_AUTOCLOUD_DB_ID || 0); // TODO: 在 .env 中填写
// 注意：这里是 JS 字符串，不能再使用 SQL 里的反引号 ` 来包裹表名，否则会打断模板字符串。
const METABASE_SQL_AUTOCLOUD_AVG_TIME = `
SELECT
  ads_cloudgame_cloudzation_time_inc.dt AS dt,
  (AVG(ads_cloudgame_cloudzation_time_inc.all_time) / CASE WHEN 60.0 = 0 THEN NULL ELSE 60.0 END) AS expression
FROM
  ads_cloudgame_cloudzation_time_inc
WHERE
  ads_cloudgame_cloudzation_time_inc.dt >= DATE(DATE_ADD(NOW(6), INTERVAL -7 DAY))
  AND ads_cloudgame_cloudzation_time_inc.dt < DATE(NOW(6))
GROUP BY
  ads_cloudgame_cloudzation_time_inc.dt
ORDER BY
  ads_cloudgame_cloudzation_time_inc.dt DESC
`;

/**
 * 供应看板：客户下单路数（当日）
 * - database 固定 159（也可用 .env 覆盖）
 * - rows: [结算套餐ID, customer_id, name, resource_type, 常规订单, 弹性订单]
 */
const METABASE_DATABASE_ID_FOR_SUPPLY_ORDERS = Number(
  import.meta.env.VITE_METABASE_SUPPLY_ORDERS_DB_ID || 159,
);
const METABASE_SQL_SUPPLY_ORDERS_TODAY = `
SELECT
  coms_purchase_order_settlement_view.id AS id,
  coms_purchase_order_settlement_view.customer_id AS customer_id,
  coms_purchase_order_settlement_view.name AS name,
  coms_purchase_order_settlement_view.resource_type AS resource_type,
  SUM(coms_purchase_order_settlement_view.plan_month_quantity) AS regular_orders,
  SUM(coms_purchase_order_settlement_view.plan_day_quantity) AS elastic_orders
FROM
  coms_purchase_order_settlement_view
WHERE
  (
    (coms_purchase_order_settlement_view.customer_id <> 'CTEST' OR coms_purchase_order_settlement_view.customer_id IS NULL)
    AND coms_purchase_order_settlement_view.date >= DATE(NOW(6))
    AND coms_purchase_order_settlement_view.date < DATE(DATE_ADD(NOW(6), INTERVAL 1 DAY))
    AND coms_purchase_order_settlement_view.resource_type = 'x86'
    AND coms_purchase_order_settlement_view.unit = '路'
  )
GROUP BY
  coms_purchase_order_settlement_view.id,
  coms_purchase_order_settlement_view.customer_id,
  coms_purchase_order_settlement_view.name,
  coms_purchase_order_settlement_view.resource_type
ORDER BY
  coms_purchase_order_settlement_view.id ASC,
  coms_purchase_order_settlement_view.customer_id ASC,
  coms_purchase_order_settlement_view.name ASC,
  coms_purchase_order_settlement_view.resource_type ASC
`;

/**
 * 供应看板：客户下单路数（近 7 天，按天）
 * - database 固定 159（也可用 .env 覆盖）
 * - rows: [结算套餐ID, customer_id, name, resource_type, date, 常规订单, 弹性订单]
 */
const METABASE_DATABASE_ID_FOR_SUPPLY_ORDERS_7D = Number(
  import.meta.env.VITE_METABASE_SUPPLY_ORDERS_7D_DB_ID || 159,
);
const METABASE_SQL_SUPPLY_ORDERS_7D = `
SELECT
  coms_purchase_order_settlement_view.id AS id,
  coms_purchase_order_settlement_view.customer_id AS customer_id,
  coms_purchase_order_settlement_view.name AS name,
  coms_purchase_order_settlement_view.resource_type AS resource_type,
  coms_purchase_order_settlement_view.date AS date,
  sum(coms_purchase_order_settlement_view.plan_month_quantity) AS regular_orders,
  sum(coms_purchase_order_settlement_view.plan_day_quantity) AS elastic_orders
FROM
  coms_purchase_order_settlement_view
WHERE
  (
    (coms_purchase_order_settlement_view.customer_id <> 'CTEST' OR coms_purchase_order_settlement_view.customer_id IS NULL)
    AND coms_purchase_order_settlement_view.resource_type = 'x86'
    AND coms_purchase_order_settlement_view.unit = '路'
    AND coms_purchase_order_settlement_view.date >= date(date_add(now(6), INTERVAL -7 day))
    AND coms_purchase_order_settlement_view.date < date(now(6))
  )
GROUP BY
  coms_purchase_order_settlement_view.id,
  coms_purchase_order_settlement_view.customer_id,
  coms_purchase_order_settlement_view.name,
  coms_purchase_order_settlement_view.resource_type,
  coms_purchase_order_settlement_view.date
ORDER BY
  coms_purchase_order_settlement_view.id ASC,
  coms_purchase_order_settlement_view.customer_id ASC,
  coms_purchase_order_settlement_view.name ASC,
  coms_purchase_order_settlement_view.resource_type ASC,
  coms_purchase_order_settlement_view.date ASC
`;

/**
 * 供应看板：项目当前可用路数（分钟级快照）
 * - database 固定 131（也可用 .env 覆盖）
 * - rows: [project_id, project_name, count, available_count, unavailable_count]
 */
const METABASE_DATABASE_ID_FOR_SUPPLY_CURRENT = Number(
  import.meta.env.VITE_METABASE_SUPPLY_CURRENT_DB_ID || 131,
);
const METABASE_SQL_SUPPLY_CURRENT_ROUTES = `
SELECT
  game.dwd_cloudgame_game_vminfo_v2_inc.project_id AS project_id,
  game.dwd_cloudgame_game_vminfo_v2_inc.project_name AS project_name,
  count() AS total_count,
  CASE
    WHEN count() > 0 THEN sum(
      CASE
        WHEN (
          game.dwd_cloudgame_game_vminfo_v2_inc.vm_status = '1-外部调度'
          AND game.dwd_cloudgame_game_vminfo_v2_inc.os_state = '2-健康可用'
        ) THEN 1.0 ELSE 0.0
      END
    ) ELSE NULL
  END AS available_count,
  CASE
    WHEN count() > 0 THEN sum(
      CASE
        WHEN (
          (
            game.dwd_cloudgame_game_vminfo_v2_inc.vm_status <> '1-外部调度'
            OR game.dwd_cloudgame_game_vminfo_v2_inc.vm_status IS NULL
          )
          OR (
            game.dwd_cloudgame_game_vminfo_v2_inc.os_state <> '2-健康可用'
            OR game.dwd_cloudgame_game_vminfo_v2_inc.os_state IS NULL
          )
        ) THEN 1.0 ELSE 0.0
      END
    ) ELSE NULL
  END AS unavailable_count
FROM
  game.dwd_cloudgame_game_vminfo_v2_inc
WHERE
  (
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
  )
GROUP BY
  game.dwd_cloudgame_game_vminfo_v2_inc.project_id,
  game.dwd_cloudgame_game_vminfo_v2_inc.project_name
ORDER BY
  game.dwd_cloudgame_game_vminfo_v2_inc.project_id ASC,
  game.dwd_cloudgame_game_vminfo_v2_inc.project_name ASC
`;

/**
 * 供应看板：字节跳动项目当前供应（分钟级 uniq(g_instance_id)）
 * - database 默认 131（可用 .env 覆盖）
 * - rows: [project_id, project_name, fmt_ts, count]
 * - 前端会取最新一条（最大 fmt_ts）作为“当前路数”
 */
const METABASE_DATABASE_ID_FOR_SUPPLY_CURRENT_BYTEDANCE = Number(
  import.meta.env.VITE_METABASE_SUPPLY_CURRENT_BYTEDANCE_DB_ID || 131,
);
const METABASE_SQL_SUPPLY_CURRENT_ROUTES_BYTEDANCE = `
SELECT
  game.dwd_cloudgame_game_vminfo_v2_inc.project_id AS project_id,
  game.dwd_cloudgame_game_vminfo_v2_inc.project_name AS project_name,
  toStartOfMinute(toDateTime(game.dwd_cloudgame_game_vminfo_v2_inc.fmt_ts)) AS fmt_ts,
  uniq(game.dwd_cloudgame_game_vminfo_v2_inc.g_instance_id) AS count
FROM
  game.dwd_cloudgame_game_vminfo_v2_inc
WHERE
  (
    game.dwd_cloudgame_game_vminfo_v2_inc.project_id = '33'
    AND game.dwd_cloudgame_game_vminfo_v2_inc.arch = 'X86'
    AND game.dwd_cloudgame_game_vminfo_v2_inc.dt >= toDate((CAST(now() AS timestamp) + INTERVAL -7 day))
    AND game.dwd_cloudgame_game_vminfo_v2_inc.dt < toDate(now())
  )
GROUP BY
  game.dwd_cloudgame_game_vminfo_v2_inc.project_id,
  game.dwd_cloudgame_game_vminfo_v2_inc.project_name,
  toStartOfMinute(toDateTime(game.dwd_cloudgame_game_vminfo_v2_inc.fmt_ts))
ORDER BY
  game.dwd_cloudgame_game_vminfo_v2_inc.project_id ASC,
  game.dwd_cloudgame_game_vminfo_v2_inc.project_name ASC,
  toStartOfMinute(toDateTime(game.dwd_cloudgame_game_vminfo_v2_inc.fmt_ts)) ASC
`;

/**
 * 供应看板：项目供应路数近 7 天（按天汇总：max/avg）
 * - database 固定 131（也可用 .env 覆盖）
 * - rows: [project_id, project_name, fmt_ts(date), max, avg]
 */
const METABASE_DATABASE_ID_FOR_SUPPLY_7D = Number(
  import.meta.env.VITE_METABASE_SUPPLY_7D_DB_ID || 131,
);
const METABASE_SQL_SUPPLY_ROUTES_7D = `
SELECT
  source.project_id AS project_id,
  source.project_name AS project_name,
  toDate(source.fmt_ts) AS fmt_ts,
  max(source.count_2) AS max_v,
  avg(source.count_2) AS avg_v
FROM (
  SELECT
    game.dwd_cloudgame_game_vminfo_v2_inc.project_id AS project_id,
    game.dwd_cloudgame_game_vminfo_v2_inc.project_name AS project_name,
    toStartOfMinute(toDateTime(game.dwd_cloudgame_game_vminfo_v2_inc.fmt_ts)) AS fmt_ts,
    uniq(game.dwd_cloudgame_game_vminfo_v2_inc.g_instance_id) AS count,
    count() AS count_2
  FROM
    game.dwd_cloudgame_game_vminfo_v2_inc
  WHERE
    (
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
      AND game.dwd_cloudgame_game_vminfo_v2_inc.dt >= toDate((CAST(now() AS timestamp) + INTERVAL -7 day))
      AND game.dwd_cloudgame_game_vminfo_v2_inc.dt < toDate(now())
    )
  GROUP BY
    game.dwd_cloudgame_game_vminfo_v2_inc.project_id,
    game.dwd_cloudgame_game_vminfo_v2_inc.project_name,
    toStartOfMinute(toDateTime(game.dwd_cloudgame_game_vminfo_v2_inc.fmt_ts))
  ORDER BY
    game.dwd_cloudgame_game_vminfo_v2_inc.project_id ASC,
    game.dwd_cloudgame_game_vminfo_v2_inc.project_name ASC,
    toStartOfMinute(toDateTime(game.dwd_cloudgame_game_vminfo_v2_inc.fmt_ts)) ASC
) source
GROUP BY
  source.project_id,
  source.project_name,
  toDate(source.fmt_ts)
ORDER BY
  source.project_id ASC,
  source.project_name ASC,
  toDate(source.fmt_ts) ASC
`;

/**
 * 供应看板：字节跳动项目供应近 7 天（按天 max/avg）
 * - 你说明该项目需要走单独表/SQL，这里单独维护一份查询
 * - database 默认 131（如需要可用 .env 覆盖）
 *
 * 注意：此 SQL 会被用于覆盖 project_name 包含“字节跳动”的项目数据。
 */
const METABASE_DATABASE_ID_FOR_SUPPLY_7D_BYTEDANCE = Number(
  import.meta.env.VITE_METABASE_SUPPLY_7D_BYTEDANCE_DB_ID || 131,
);
const METABASE_SQL_SUPPLY_ROUTES_7D_BYTEDANCE = `
SELECT 
    source.project_id AS project_id,
    source.project_name AS project_name,
    toDate(source.fmt_ts) AS fmt_ts,
    MIN(source.count) AS min_v,
    MAX(source.count) AS max_v,
    AVG(source.count) AS avg_v
FROM (
    SELECT 
        g.project_id AS project_id,
        g.project_name AS project_name,
        toStartOfMinute(toDateTime(g.fmt_ts)) AS fmt_ts,
        uniq(g.g_instance_id) AS count
    FROM game.dwd_cloudgame_game_vminfo_v2_inc AS g
    WHERE g.project_id = '33'
      AND g.arch = 'X86'
      AND g.dt >= toDate(now() - INTERVAL 7 DAY)
      AND g.dt < toDate(now())
    GROUP BY 
        g.project_id, 
        g.project_name, 
        toStartOfMinute(toDateTime(g.fmt_ts))
    ORDER BY 
        g.project_id ASC, 
        g.project_name ASC, 
        toStartOfMinute(toDateTime(g.fmt_ts)) ASC
) AS source
GROUP BY 
    source.project_id, 
    source.project_name, 
    toDate(source.fmt_ts)
ORDER BY 
    source.project_id ASC, 
    source.project_name ASC, 
    toDate(source.fmt_ts) ASC
`;

// ---------------- 通用的 Metabase 调用封装 ----------------

async function getMetabaseSessionToken() {
  if (!METABASE_BASE_URL) {
    throw new Error('Metabase 配置未完成：请在 dashboardApi.js 中填写 METABASE_BASE_URL');
  }

  if (METABASE_SESSION_TOKEN) {
    return METABASE_SESSION_TOKEN;
  }

  if (!METABASE_USERNAME || !METABASE_PASSWORD) {
    throw new Error(
      'Metabase 配置未完成：请填写 METABASE_SESSION_TOKEN，或填写 METABASE_USERNAME / METABASE_PASSWORD 用于调用 /api/session',
    );
  }

  const url = `${METABASE_BASE_URL.replace(/\/$/, '')}/api/session`;

  const res = await fetchJson(url, {
    method: 'POST',
    body: {
      username: METABASE_USERNAME,
      password: METABASE_PASSWORD,
    },
  });

  if (!res || !res.id) {
    throw new Error('调用 Metabase /api/session 失败，未返回 session id');
  }

  return res.id;
}

async function queryMetabaseDataset({ sql, databaseId }) {
  if (!METABASE_BASE_URL) {
    throw new Error('Metabase 配置未完成：请在 dashboardApi.js 中填写 METABASE_BASE_URL');
  }

  if (!sql || !sql.trim()) {
    throw new Error('Metabase SQL 为空：请在 METABASE_SQL_AUTOCLOUD_AVG_TIME 中填写查询语句');
  }

  if (!databaseId) {
    throw new Error('Metabase databaseId 未配置：请在 METABASE_DATABASE_ID_FOR_AUTOCLOUD 中填写正确 ID');
  }

  const token = await getMetabaseSessionToken();
  const url = `${METABASE_BASE_URL.replace(/\/$/, '')}/api/dataset`;

  const payload = {
    database: databaseId,
    type: 'native',
    native: {
      query: sql,
    },
  };

  const data = await fetchJson(url, {
    method: 'POST',
    headers: {
      'X-Metabase-Session': token,
    },
    body: payload,
  });

  return data;
}

/**
 * 调用 Metabase，获取“自动云化平均时长”的 7 天序列数据。
 *
 * - 对应界面：
 *   - 云化 Tab 顶部 Summary 的数值部分（展示最新一天的平均耗时）
 *   - “查看近7天”趋势曲线（使用 rows 里的时间 + 耗时）
 *
 * 返回：
 * {
 *   valueMinutes: number;                 // 最新一天的平均耗时（分钟）
 *   trend: { date: string; value: number }[]  // 近 7 天曲线数据
 * }
 *
 * 你提供的接口返回示例结构：
 * {
 *   "data": {
 *     "rows": [
 *       ["2026-03-11T00:00:00+08:00", 12.29869281],
 *       ["2026-03-10T00:00:00+08:00", 12.18836478],
 *       ...
 *     ]
 *   }
 * }
 */
async function fetchAutoCloudSeriesFromMetabase() {
  const dataset = await queryMetabaseDataset({
    sql: METABASE_SQL_AUTOCLOUD_AVG_TIME,
    databaseId: METABASE_DATABASE_ID_FOR_AUTOCLOUD,
  });

  // Metabase /api/dataset 通常返回结构：
  // {
  //   "data": {
  //     "cols": [{ "name": "avg_duration_s", ... }],
  //     "rows": [[1234.56]]
  //   }
  // }
  if (!dataset || !dataset.data || !Array.isArray(dataset.data.rows)) {
    throw new Error('Metabase 返回结构异常：未找到 data.rows');
  }

  // 接口格式：data.rows = [ ["2026-03-11T00:00:00+08:00", 12.29869281], ["2026-03-10...", 12.18], ... ]
  // 每行：[日期 ISO 字符串, 当日平均耗时（分钟）]，可能按日期倒序或正序返回
  const rows = dataset.data.rows;
  if (!rows.length || !Array.isArray(rows[0])) {
    throw new Error('Metabase 查询结果为空：data.rows 长度为 0');
  }

  const parsed = rows.map((row) => {
    const dateStr = row[0];
    const avgMinutes = row[1];
    const iso = String(dateStr ?? '');
    const timeMs = Number.isNaN(Date.parse(iso)) ? null : Date.parse(iso);
    const value = typeof avgMinutes === 'number' && !Number.isNaN(avgMinutes) ? avgMinutes : Number(avgMinutes);
    const num = Number.isNaN(value) ? 0 : value;
    const dateLabel = iso.length >= 10 ? iso.slice(5, 10) : iso; // MM-DD
    return { date: dateLabel, value: num, _time: timeMs };
  }).filter((p) => p._time != null);

  if (!parsed.length) {
    throw new Error('Metabase 查询结果无有效日期数据');
  }

  // 按日期升序（左→右：从早到晚），与接口返回顺序无关
  parsed.sort((a, b) => a._time - b._time);

  const trend = parsed.map(({ date, value }) => ({ date, value }));
  // Summary 大数字取「近 7 天的平均值」，而不是最新一天
  const total = parsed.reduce((sum, item) => sum + item.value, 0);
  const avgAllDays = parsed.length ? total / parsed.length : 0;
  const valueMinutes = avgAllDays;

  return { valueMinutes, trend };
}

/**
 * 供应看板：拉取“客户真实下单路数（当日）”，并按项目ID汇总。
 *
 * 返回：
 * {
 *   byProject: Record<string, { regular: number; elastic: number; total: number }>
 *   unmapped: { settlementId: string; regular: number; elastic: number; total: number }[]
 * }
 */
export async function fetchSupplyOrdersTodayFromMetabase({ settlementIdToProjectId } = {}) {
  const dataset = await queryMetabaseDataset({
    sql: METABASE_SQL_SUPPLY_ORDERS_TODAY,
    databaseId: METABASE_DATABASE_ID_FOR_SUPPLY_ORDERS,
  });

  if (!dataset || !dataset.data || !Array.isArray(dataset.data.rows)) {
    throw new Error('Metabase 返回结构异常：未找到 data.rows');
  }

  const mapFn =
    typeof settlementIdToProjectId === 'function'
      ? settlementIdToProjectId
      : (id) => null;

  const normalizeToProjectIds = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
    return [String(v)].filter(Boolean);
  };

  const byProject = {};
  const bySettlement = {};

  for (const row of dataset.data.rows) {
    if (!Array.isArray(row)) continue;
    const settlementId = String(row[0] ?? '').trim();
    const regular = Number(row[4] ?? 0);
    const elastic = Number(row[5] ?? 0);
    const reg = Number.isFinite(regular) ? regular : 0;
    const ela = Number.isFinite(elastic) ? elastic : 0;
    const total = reg + ela;

    if (!settlementId) continue;

    const prev = bySettlement[settlementId] || { regular: 0, elastic: 0, total: 0 };
    bySettlement[settlementId] = {
      regular: prev.regular + reg,
      elastic: prev.elastic + ela,
      total: prev.total + total,
    };
  }

  const unmapped = [];
  for (const [settlementId, agg] of Object.entries(bySettlement)) {
    const projectIds = normalizeToProjectIds(mapFn(settlementId));
    if (!projectIds.length) {
      unmapped.push({ settlementId, ...agg });
      continue;
    }
    for (const projectId of projectIds) {
      const key = String(projectId);
      const prev = byProject[key] || { regular: 0, elastic: 0, total: 0 };
      byProject[key] = {
        regular: prev.regular + agg.regular,
        elastic: prev.elastic + agg.elastic,
        total: prev.total + agg.total,
      };
    }
  }

  return { byProject, unmapped };
}

/**
 * 供应看板：拉取“客户真实下单路数（近7天按天）”，并按项目ID汇总成时间序列。
 *
 * 返回：
 * {
 *   byProject: Record<string, { series: { date: string; value: number }[] }>
 *   unmapped: { settlementId: string; date: string; value: number }[]
 * }
 */
export async function fetchSupplyOrders7dFromMetabase({ settlementIdToProjectId } = {}) {
  const dataset = await queryMetabaseDataset({
    sql: METABASE_SQL_SUPPLY_ORDERS_7D,
    databaseId: METABASE_DATABASE_ID_FOR_SUPPLY_ORDERS_7D,
  });

  if (!dataset || !dataset.data || !Array.isArray(dataset.data.rows)) {
    throw new Error('Metabase 返回结构异常：未找到 data.rows');
  }

  const mapFn =
    typeof settlementIdToProjectId === 'function'
      ? settlementIdToProjectId
      : () => null;

  const normalizeToProjectIds = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
    return [String(v)].filter(Boolean);
  };

  const byProjectByDate = {};
  const unmapped = [];

  for (const row of dataset.data.rows) {
    if (!Array.isArray(row)) continue;
    const settlementId = String(row[0] ?? '').trim();
    const dateRaw = row[4];
    const iso = String(dateRaw ?? '').trim();
    const dateLabel = iso.length >= 10 ? iso.slice(5, 10) : iso; // MM-DD
    const regular = Number(row[5] ?? 0);
    const elastic = Number(row[6] ?? 0);
    const reg = Number.isFinite(regular) ? regular : 0;
    const ela = Number.isFinite(elastic) ? elastic : 0;
    const total = reg + ela;
    if (!settlementId || !dateLabel) continue;

    const projectIds = normalizeToProjectIds(mapFn(settlementId));
    if (!projectIds.length) {
      unmapped.push({ settlementId, date: dateLabel, value: total });
      continue;
    }
    for (const projectId of projectIds) {
      const pid = String(projectId);
      if (!byProjectByDate[pid]) byProjectByDate[pid] = {};
      byProjectByDate[pid][dateLabel] = (byProjectByDate[pid][dateLabel] || 0) + total;
    }
  }

  const byProject = {};
  for (const [pid, dateMap] of Object.entries(byProjectByDate)) {
    const series = Object.entries(dateMap)
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
    byProject[pid] = { series };
  }

  return { byProject, unmapped };
}

/**
 * 供应看板：拉取“项目当前真实路数”，按 project_id 返回（project_id 为你维护的 biz 项目ID）。
 *
 * 返回：
 * {
 *   byProject: Record<string, { projectName: string; total: number; available: number; unavailable: number }>
 * }
 */
export async function fetchSupplyCurrentRoutesFromMetabase() {
  const dataset = await queryMetabaseDataset({
    sql: METABASE_SQL_SUPPLY_CURRENT_ROUTES,
    databaseId: METABASE_DATABASE_ID_FOR_SUPPLY_CURRENT,
  });

  if (!dataset || !dataset.data || !Array.isArray(dataset.data.rows)) {
    throw new Error('Metabase 返回结构异常：未找到 data.rows');
  }

  const byProject = {};
  for (const row of dataset.data.rows) {
    if (!Array.isArray(row)) continue;
    const projectId = String(row[0] ?? '').trim();
    if (!projectId) continue;
    const projectName = String(row[1] ?? '').trim();
    const total = Number(row[2] ?? 0);
    const available = Number(row[3] ?? 0);
    const unavailable = Number(row[4] ?? 0);
    byProject[projectId] = {
      projectName,
      total: Number.isFinite(total) ? total : 0,
      available: Number.isFinite(available) ? available : 0,
      unavailable: Number.isFinite(unavailable) ? unavailable : 0,
    };
  }

  return { byProject };
}

/**
 * 供应看板：字节跳动项目“当前供应路数”（取最新分钟）
 *
 * 返回：
 * { projectId: string; projectName: string; value: number } | null
 */
export async function fetchSupplyCurrentRoutesBytedanceFromMetabase() {
  const dataset = await queryMetabaseDataset({
    sql: METABASE_SQL_SUPPLY_CURRENT_ROUTES_BYTEDANCE,
    databaseId: METABASE_DATABASE_ID_FOR_SUPPLY_CURRENT_BYTEDANCE,
  });

  if (!dataset || !dataset.data || !Array.isArray(dataset.data.rows)) {
    throw new Error('Metabase 返回结构异常：未找到 data.rows');
  }

  // rows: [project_id, project_name, fmt_ts(minute), count]
  let latest = null;
  let latestTs = null;
  for (const row of dataset.data.rows) {
    if (!Array.isArray(row)) continue;
    const projectId = String(row[0] ?? '').trim();
    if (!projectId) continue;
    const projectName = String(row[1] ?? '').trim();
    const tsRaw = row[2];
    const ts = Date.parse(String(tsRaw ?? ''));
    const val = Number(row[3] ?? NaN);
    const num = Number.isFinite(val) ? val : null;
    if (num == null) continue;

    if (latestTs == null || (Number.isFinite(ts) && ts > latestTs)) {
      latestTs = Number.isFinite(ts) ? ts : latestTs;
      latest = { projectId, projectName, value: num };
    }
  }

  return latest;
}

/**
 * 供应看板：拉取“近7天供应路数（按天 max/avg）”，按 project_id 返回。
 *
 * 返回：
 * {
 *   byProject: Record<string, { projectName: string; seriesMax: { date: string; value: number }[]; seriesAvg: { date: string; value: number }[] }>
 * }
 */
export async function fetchSupplyRoutes7dFromMetabase() {
  const dataset = await queryMetabaseDataset({
    sql: METABASE_SQL_SUPPLY_ROUTES_7D,
    databaseId: METABASE_DATABASE_ID_FOR_SUPPLY_7D,
  });

  if (!dataset || !dataset.data || !Array.isArray(dataset.data.rows)) {
    throw new Error('Metabase 返回结构异常：未找到 data.rows');
  }

  const byProject = {};
  for (const row of dataset.data.rows) {
    if (!Array.isArray(row)) continue;
    const projectId = String(row[0] ?? '').trim();
    if (!projectId) continue;
    const projectName = String(row[1] ?? '').trim();
    const dateRaw = row[2];
    const iso = String(dateRaw ?? '').trim();
    const dateLabel = iso.length >= 10 ? iso.slice(5, 10) : iso; // MM-DD
    const maxV = Number(row[3] ?? NaN);
    const avgV = Number(row[4] ?? NaN);
    const maxNum = Number.isFinite(maxV) ? maxV : null;
    const avgNum = Number.isFinite(avgV) ? avgV : null;

    if (!byProject[projectId]) {
      byProject[projectId] = { projectName, seriesMax: [], seriesAvg: [] };
    } else if (!byProject[projectId].projectName && projectName) {
      byProject[projectId].projectName = projectName;
    }

    if (dateLabel) {
      if (typeof maxNum === 'number') byProject[projectId].seriesMax.push({ date: dateLabel, value: maxNum });
      if (typeof avgNum === 'number') byProject[projectId].seriesAvg.push({ date: dateLabel, value: avgNum });
    }
  }

  return { byProject };
}

/**
 * 供应看板：字节跳动项目近7天供应（按天 max/avg）
 * 返回结构与 fetchSupplyRoutes7dFromMetabase 一致。
 */
export async function fetchSupplyRoutes7dBytedanceFromMetabase() {
  const dataset = await queryMetabaseDataset({
    sql: METABASE_SQL_SUPPLY_ROUTES_7D_BYTEDANCE,
    databaseId: METABASE_DATABASE_ID_FOR_SUPPLY_7D_BYTEDANCE,
  });

  if (!dataset || !dataset.data || !Array.isArray(dataset.data.rows)) {
    throw new Error('Metabase 返回结构异常：未找到 data.rows');
  }

  const byProject = {};
  for (const row of dataset.data.rows) {
    if (!Array.isArray(row)) continue;
    const projectId = String(row[0] ?? '').trim();
    if (!projectId) continue;
    const projectName = String(row[1] ?? '').trim();
    const dateRaw = row[2];
    const iso = String(dateRaw ?? '').trim();
    const dateLabel = iso.length >= 10 ? iso.slice(5, 10) : iso; // MM-DD
    const maxV = Number(row[4] ?? NaN);
    const avgV = Number(row[5] ?? NaN);
    const maxNum = Number.isFinite(maxV) ? maxV : null;
    const avgNum = Number.isFinite(avgV) ? avgV : null;

    if (!byProject[projectId]) {
      byProject[projectId] = { projectName, seriesMax: [], seriesAvg: [] };
    }

    if (dateLabel) {
      if (typeof maxNum === 'number') byProject[projectId].seriesMax.push({ date: dateLabel, value: maxNum });
      if (typeof avgNum === 'number') byProject[projectId].seriesAvg.push({ date: dateLabel, value: avgNum });
    }
  }

  return { byProject };
}

/**
 * 【项目筛选】项目列表（支持多选）
 * - **对应界面**：顶部“项目筛选”多选按钮组
 * - **建议接口**：GET /api/projects
 * - **返回结构（示例）**：
 *   ["项目A","项目B","项目C"]
 */
export async function fetchProjectOptions() {
  // TODO: 改成你自己的接口
  // const url = buildUrl('/api/projects');
  // const data = await fetchJson(url);
  // return data;
  throw new Error('fetchProjectOptions() 未接入接口：请在 src/api/dashboardApi.js 填写。');
}

/**
 * 【顶部核心看板】Summary + 趋势曲线
 * - **对应界面**：页面最上方的大卡片（指标值 + 右侧曲线），以及“查看近7天”抽屉数据
 * - **建议接口**：GET /api/dashboard/summary?tab=cloud&timeRange=24h&projects=项目A,项目B
 *
 * - **入参说明**：
 *   - tab: 'cloud' | 'scheduling' | 'health'
 *   - timeRange: '24h' | '7d' | '30d'（目前只在 cloud 使用切换，其它 tab 仍可支持）
 *   - projects: string[]（多选项目）
 *
 * - **返回结构（示例）**：
 * {
 *   "label": "云化任务平均耗时",
 *   "value": "1250s",
 *   "color": "#10b981",
 *   "trend": [{"date":"0:00","value":123}, ...],
 *   "sevenDayTrend": [{"date":"03-01","value":123}, ...]
 * }
 */
export async function fetchTabSummary({ tab, timeRange, projects }) {
  // 云化 Tab：示例实现 —— 从 Metabase 取“自动云化平均时长”
  if (tab === 'cloud') {
    const { valueMinutes, trend } = await fetchAutoCloudSeriesFromMetabase();

    // 返回结构会和前端内置的 summary 合并，所以只需要关心业务字段即可
    // 同时给 24h/7d 都赋值为同一组 7 天数据，这样默认 24h 时右侧曲线也显示真实数据
    return {
      label: '云化任务平均耗时',
      value: `${valueMinutes.toFixed(1)}min`,
      trends: {
        '24h': trend,
        '7d': trend,
        '30d': trend,
      },
      sevenDayTrend: trend,
    };
  }

  // 其它 Tab：保留占位，按需接入
  // const url = buildUrl(`/api/dashboard/summary?tab=${encodeURIComponent(tab)}&timeRange=${encodeURIComponent(timeRange)}&projects=${encodeURIComponent(projects.join(','))}`);
  // const data = await fetchJson(url);
  // return data;
  throw new Error('当前 tab 的 fetchTabSummary() 尚未接入接口。');
}

/**
 * 【任务流水线】阶段列表（每行 stage）
 * - **对应界面**：下面“任务流水线”列表（每个阶段行，包括：平均耗时、成功率、异常分布等）
 * - **建议接口**：GET /api/dashboard/stages?tab=cloud&timeRange=24h&projects=...
 *
 * - **返回结构（示例）**：Stage[]
 * [
 *   {
 *     "id": "auto-cloud",
 *     "project": "项目A",
 *     "name": "自动云化任务",
 *     "avgTime": 1250,
 *     "successRate": 98.5,
 *     "note": "xxxx",
 *     "timeTrend": [{"date":"0:00","value":123}, ...],
 *     "timeTrendByRange": { "24h":[...], "7d":[...], "30d":[...] }, // 可选：支持云化时间维度切换
 *     "successTrend": [{"date":"0:00","value":98.6}, ...],
 *
 *     // 下面两个字段用于“查看详情”抽屉
 *     "rooms": [ ... ] ,          // 机房分组统计
 *     "gameDetails": [ ... ]      // 游戏维度统计（仅 game-save-31-pc 用）
 *   }
 * ]
 */
export async function fetchTabStages({ tab, timeRange, projects }) {
  // TODO: 改成你自己的接口
  // const url = buildUrl(`/api/dashboard/stages?tab=${encodeURIComponent(tab)}&timeRange=${encodeURIComponent(timeRange)}&projects=${encodeURIComponent(projects.join(','))}`);
  // const data = await fetchJson(url);
  // return data;
  throw new Error('fetchTabStages() 未接入接口：请在 src/api/dashboardApi.js 填写。');
}

/**
 * 【一键拉取当前 tab 全量数据】（推荐你优先实现这个，前端改动最少）
 * - **对应界面**：当前 tab 的全部区域
 * - **建议接口**：GET /api/dashboard/snapshot?tab=cloud&timeRange=24h&projects=...
 * - **返回结构（示例）**：
 * {
 *   "projects": ["项目A","项目B"], // 可选：也可不返回
 *   "summary": { ...见 fetchTabSummary 返回... },
 *   "stages":  [ ...见 fetchTabStages 返回... ]
 * }
 */
export async function fetchDashboardSnapshot({ tab, timeRange, projects }) {
  // 你可以只实现 snapshot，然后在 ResourceDashboard 里不再调用 summary/stages 的单独接口
  const url = buildUrl(
    `/api/dashboard/snapshot?tab=${encodeURIComponent(tab)}&timeRange=${encodeURIComponent(timeRange)}&projects=${encodeURIComponent((projects || []).join(','))}`,
  );
  return await fetchJson(url);
}

