import { researchResult, rounded } from "../shared.mjs";

export function runResearchMarketAgent({ market, vector }) {
  const changes = market.indices.map((item) => item.change);
  const positive = changes.filter((value) => value > 0).length;
  return researchResult("market", "市场 Agent · 研究 v2", vector.context, .55,
    [`市场情境 ${Math.round(vector.context)}`, `${positive}/${changes.length} 个核心指数上涨`],
    ["当前仍复用正式 context，缺少独立市场状态序列"],
    market.indices.slice(0, 5).map((item) => `${item.name} ${rounded(item.change, 2)}%`), []);
}
