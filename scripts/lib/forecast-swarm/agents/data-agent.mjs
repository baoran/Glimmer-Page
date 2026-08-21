import { agentResult, rounded } from "../shared.mjs";

export const DATA_AGENT_ID = "data";
export const REQUIRED_MARKET_FIELDS = ["price", "change", "turnoverRate", "volumeRatio", "pe", "marketCap", "turnover", "high", "low", "previousClose"];

export function runDataAgent({ stock, sourceStatus }) {
  const valid = REQUIRED_MARKET_FIELDS.filter((key) => Number.isFinite(stock[key])).length;
  const completeness = valid / REQUIRED_MARKET_FIELDS.length;
  const sourceScore = sourceStatus === "live" ? 100 : sourceStatus === "partial" ? 72 : 35;
  const score = completeness * 70 + sourceScore * .30;
  return agentResult(DATA_AGENT_ID, score, sourceStatus === "live" ? .96 : .68,
    [`${valid}/${REQUIRED_MARKET_FIELDS.length} 个必需行情字段有效`, `核心来源状态：${sourceStatus}`],
    [sourceStatus !== "live" ? "行情来源并非全量实时，监督置信度已降低" : ""],
    [`观察价 ${stock.price}`, `成交额 ${rounded(stock.turnover / 1e8, 2)} 亿元`, `总市值 ${rounded(stock.marketCap / 1e8, 2)} 亿元`]);
}
