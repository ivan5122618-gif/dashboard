// 结算套餐ID -> 项目ID 映射（供应看板用）
// 你后续把表格里的映射补全/替换这里即可。
// key/value 都建议用 string，避免数字精度/前导 0 问题。

export const SETTLEMENT_ID_TO_PROJECT_ID = {
  SPFLNTMT: '33',
  SPVVINT4: '400',
  SPF9GCZB: '400',
  SPR9EP7R: '33',
  SPWPND37: '10106',
  SP2Y4L54: '76',
  SP9TC9NB: '23',
  SPB9RZ2X: '23',
  SPR5IKKW: '23',
  SP4KAIHX: '23',
  SP8O53XW: '57',
  SP7KHG0R: '69',
  SP493DS4: '71',
  SPFOQ08I: '68',
  SPN8DQV8: '77',
  SP1Z623M: '42',
  SP6OOYFE: '10125',
  // 结算套餐 -> 对应多个项目（订单需要同时计入这些项目）
};

export function projectIdsFromSettlementId(settlementId) {
  const key = String(settlementId ?? '').trim();
  if (!key) return null;
  const raw = SETTLEMENT_ID_TO_PROJECT_ID[key];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  return [String(raw)];
}

export function getAllMappedProjectIds() {
  const all = Object.values(SETTLEMENT_ID_TO_PROJECT_ID).flatMap((v) => (Array.isArray(v) ? v : [v]));
  return Array.from(new Set(all.filter(Boolean).map((x) => String(x))));
}

// 保留旧的单项目接口：如果一个结算套餐映射多个项目，这里只取第一个。
export function projectIdFromSettlementId(settlementId) {
  const ids = projectIdsFromSettlementId(settlementId) || [];
  return ids.length ? ids[0] : null;
}
