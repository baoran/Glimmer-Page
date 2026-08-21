import { clamp, researchResult, rounded } from "../shared.mjs";

export function runResearchRiskAgent({ stock, amplitude }) {
  let safety = 80;
  const warnings = [];
  const deduct = (condition, points, message) => { if (condition && points > 0) { safety -= points; warnings.push(message); } };
  deduct(amplitude > 4, Math.min(25, (amplitude - 4) * 4), "振幅高于 4%，提高波动风险折扣");
  deduct(stock.change > 5, Math.min(15, (stock.change - 5) * 4), "单日涨幅高于 5%，提高反转/过热折扣");
  deduct(stock.volumeRatio > 3, Math.min(10, (stock.volumeRatio - 3) * 4), "量比高于 3，异常参与可能放大尾部风险");
  deduct(stock.pe > 50, Math.min(12, (stock.pe - 50) * .25), "PE 高于 50 倍，估值缓冲偏低");
  deduct(stock.marketCap < 1e10, 10, "总市值低于 100 亿元，规模与流动性风险较高");
  deduct(stock.turnover < 3e8, Math.min(8, (1 - stock.turnover / 3e8) * 8), "成交额低于 3 亿元，交易承载较弱");
  safety = clamp(safety);
  return researchResult("risk", "风险 Agent · 研究 v2", safety, .78,
    [warnings.length ? `触发 ${warnings.length} 类风险折扣` : "未触发研究 v2 风险折扣", `安全余量 ${rounded(safety)}`], warnings,
    [`振幅 ${rounded(amplitude, 2)}%`, `成交额 ${rounded(stock.turnover / 1e8, 2)} 亿元`, `市值 ${rounded(stock.marketCap / 1e8)} 亿元`],
    ["amihud-2002", "ang-et-al-2006", "liu-et-al-2019"], { support: 68, challenge: 45 });
}
