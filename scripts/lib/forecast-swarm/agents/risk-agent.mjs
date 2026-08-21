import { agentResult, clamp, rounded } from "../shared.mjs";

export const RISK_AGENT_ID = "risk";

export function runRiskAgent({ stock, amplitude }) {
  let safety = 88;
  const signals = [];
  const warnings = [];
  if (stock.change > 6) { safety -= Math.min(22, (stock.change - 6) * 6); warnings.push("单日涨幅超过 6%，存在过热回撤风险"); }
  if (stock.volumeRatio > 3.5) { safety -= Math.min(15, (stock.volumeRatio - 3.5) * 5); warnings.push("量比异常放大，持续性待验证"); }
  if (stock.pe > 60) { safety -= Math.min(18, (stock.pe - 60) * .3); warnings.push("估值偏高，对预期变化敏感"); }
  if (amplitude > 7) { safety -= Math.min(20, (amplitude - 7) * 3); warnings.push("日内振幅较大"); }
  if (stock.marketCap < 1e10) { safety -= 12; warnings.push("中小市值的流动性和波动风险较高"); }
  if (!warnings.length) signals.push("未触发主要过热、振幅或规模风险阈值");
  signals.push(`安全余量评分 ${Math.round(clamp(safety))}`);
  return agentResult(RISK_AGENT_ID, safety, .82, signals, warnings,
    [`日内振幅 ${rounded(amplitude, 2)}%`, `涨跌幅 ${rounded(stock.change, 2)}%`, `市盈率 ${rounded(stock.pe, 1)} 倍`], { support: 70, challenge: 50 });
}
