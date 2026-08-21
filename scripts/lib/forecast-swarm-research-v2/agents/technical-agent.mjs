import { researchResult, rounded } from "../shared.mjs";

export function runResearchTechnicalAgent({ stock, vector, horizon }) {
  const score = vector.momentum * .45 + vector.participation * .20 + vector.stability * .35;
  const confidence = horizon.sessions <= 10 ? .62 : horizon.sessions <= 20 ? .52 : .38;
  return researchResult("technical", "技术 Agent · 研究 v2", score, confidence,
    [`动能 ${Math.round(vector.momentum)}，但当前主要是单日代理`, `交易参与 ${Math.round(vector.participation)}`, `稳定性 ${Math.round(vector.stability)}`],
    [horizon.sessions >= 60 ? "单日截面对长周期解释力有限，已降低置信度" : "", stock.change > 5 ? "涨幅超过 5%，警惕短期过热而非持续动量" : ""],
    [`当日涨跌 ${rounded(stock.change, 2)}%`, `量比 ${rounded(stock.volumeRatio, 2)}`, `周期 ${horizon.sessions} 个交易日`],
    ["jegadeesh-titman-1993", "naughton-et-al-2008"]);
}
