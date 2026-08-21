import { researchResult, rounded } from "../shared.mjs";

export function runResearchFundamentalAgent({ stock, vector, horizon }) {
  const score = vector.valuation * .85 + vector.liquidity * .15;
  const confidence = horizon.sessions >= 60 ? .48 : .32;
  return researchResult("fundamental", "基本面 Agent · 研究 v2", score, confidence,
    [`价值代理 ${Math.round(vector.valuation)}`, `规模/流动性代理 ${Math.round(vector.liquidity)}`],
    ["仅有 PE 与规模代理，缺少账面市值比、盈利能力和投资因子", stock.pe > 50 ? "PE 超过 50 倍，估值证据偏弱" : ""],
    [`PE ${rounded(stock.pe, 1)} 倍`, `总市值 ${rounded(stock.marketCap / 1e8)} 亿元`, `周期 ${horizon.sessions} 个交易日`],
    ["liu-et-al-2019"]);
}
