import { agentResult, rounded } from "../shared.mjs";

export const FUNDAMENTAL_AGENT_ID = "fundamental";

export function runFundamentalAgent({ stock, vector }) {
  const score = vector.valuation * .70 + vector.liquidity * .30;
  return agentResult(FUNDAMENTAL_AGENT_ID, score, .46,
    [`估值约束 ${Math.round(vector.valuation)}`, `规模与流动性支撑 ${Math.round(vector.liquidity)}`],
    ["当前快照缺少盈利增长、资产负债和现金流，不能视为完整基本面结论", stock.pe > 60 ? "市盈率偏高，对盈利预期变化敏感" : ""],
    [`市盈率 ${rounded(stock.pe, 1)} 倍`, `总市值 ${rounded(stock.marketCap / 1e8, 0)} 亿元`]);
}
