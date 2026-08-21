import { agentResult, rounded } from "../shared.mjs";

export const MARKET_AGENT_ID = "market";

export function runMarketAgent({ market, vector }) {
  const changes = market.indices.map((item) => item.change);
  const positive = changes.filter((value) => value > 0).length;
  return agentResult(MARKET_AGENT_ID, vector.context, .78,
    [`市场情境 ${Math.round(vector.context)}`, `${positive}/${changes.length} 个核心指数上涨`],
    [vector.context < 45 ? "市场广度或个股过热惩罚对候选不利" : ""],
    market.indices.slice(0, 5).map((item) => `${item.name} ${rounded(item.change, 2)}%`));
}
