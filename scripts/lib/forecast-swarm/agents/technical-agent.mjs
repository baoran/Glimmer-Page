import { agentResult, rounded } from "../shared.mjs";

export const TECHNICAL_AGENT_ID = "technical";

export function runTechnicalAgent({ stock, vector }) {
  const score = vector.momentum * .40 + vector.participation * .35 + vector.stability * .25;
  return agentResult(TECHNICAL_AGENT_ID, score, .84,
    [`价格动能 ${Math.round(vector.momentum)}`, `交易参与 ${Math.round(vector.participation)}`, `波动稳定 ${Math.round(vector.stability)}`],
    [stock.change > 6 ? "单日涨幅偏高，动量可能伴随回撤" : "", stock.volumeRatio > 3.5 ? "量比快速放大，持续性需要后续成交验证" : ""],
    [`当日涨跌 ${rounded(stock.change, 2)}%`, `量比 ${rounded(stock.volumeRatio, 2)}`, `换手率 ${rounded(stock.turnoverRate, 2)}%`]);
}
