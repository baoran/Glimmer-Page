import { clamp, researchResult, rounded } from "../shared.mjs";

const FIELDS = ["price", "change", "turnoverRate", "volumeRatio", "pe", "marketCap", "turnover", "high", "low", "previousClose"];

export function runResearchDataAgent({ stock, sourceStatus }) {
  const valid = FIELDS.filter((key) => Number.isFinite(stock[key])).length;
  const completeness = valid / FIELDS.length * 100;
  const sourceScore = sourceStatus === "live" ? 100 : sourceStatus === "partial" ? 60 : 0;
  const checks = [stock.price > 0, stock.previousClose > 0, stock.high >= stock.low, stock.high >= stock.price, stock.low <= stock.price, stock.turnover > 0, stock.marketCap > 0];
  const consistency = checks.filter(Boolean).length / checks.length * 100;
  const impossibleQuote = stock.high < stock.low || stock.price > stock.high || stock.price < stock.low;
  const rawScore = completeness * .60 + sourceScore * .25 + consistency * .15;
  const score = impossibleQuote ? Math.min(rawScore, 55) : sourceStatus === "stale" ? Math.min(rawScore, 40) : rawScore;
  return researchResult("data", "数据 Agent · 研究 v2", score, clamp(score / 100 * .95, 0, .95),
    [`字段完整率 ${rounded(completeness)}%`, `业务一致性 ${checks.filter(Boolean).length}/${checks.length}`, `来源状态 ${sourceStatus}`],
    [sourceStatus !== "live" ? "非 live 来源触发质量折扣" : "", impossibleQuote ? "出现不可能的 OHLC/价格关系，质量分硬性封顶" : consistency < 100 ? "价格或规模字段存在一致性异常" : ""],
    [`观察价 ${stock.price}`, `最高/最低 ${stock.high}/${stock.low}`, `成交额 ${rounded(stock.turnover / 1e8, 2)} 亿元`], [], { support: 80, challenge: 60 });
}
