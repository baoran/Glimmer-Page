export const RESEARCH_SWARM_VERSION = "forecast-supervision-swarm-research-v2";
export const RESEARCH_SWARM_SCHEMA_VERSION = 1;
export const RESEARCH_AGENT_VERSION = "research-prior-v2";
export const RESEARCH_SWARM_POLICY = "研究支撑的影子监督层：只并行记录，不修改正式 Vector、v1 监督、候选、分数或排名。";

export const RESEARCH_PARAMETER_EVIDENCE = {
  level: "E1-R",
  label: "文献支撑的工程先验",
  validated: false,
  shadowOnly: true,
  statement: "参数方向参考同行评议文献和 A 股研究，但精确权重与阈值尚未由 Glimmer point-in-time 样本外验证。",
  documentation: "docs/agents/research-grounded-v2.md",
};

export const RESEARCH_AGENT_WEIGHTS = { technical: .25, fundamental: .25, market: .15, news: .05, risk: .30 };
export const RESEARCH_REFERENCES = [
  { id: "jegadeesh-titman-1993", doi: "10.1111/j.1540-6261.1993.tb04702.x", topic: "3–12 个月动量" },
  { id: "naughton-et-al-2008", doi: "10.1016/j.pacfin.2007.10.001", topic: "中国市场动量与成交量" },
  { id: "liu-et-al-2019", doi: "10.1016/j.jfineco.2019.03.008", topic: "中国市场规模与价值" },
  { id: "amihud-2002", doi: "10.1016/S1386-4181(01)00024-6", topic: "非流动性与收益" },
  { id: "ang-et-al-2006", doi: "10.1111/j.1540-6261.2006.00836.x", topic: "高特质波动与低平均收益" },
  { id: "tetlock-2007", doi: "10.1111/j.1540-6261.2007.01232.x", topic: "媒体悲观与价格压力" },
  { id: "loughran-mcdonald-2011", doi: "10.1111/j.1540-6261.2010.01625.x", topic: "金融文本专用词典" },
];

export const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
export const rounded = (value, digits = 0) => Number(value.toFixed(digits));
export const verdictFor = (score, support = 65, challenge = 45) => score >= support ? "support" : score < challenge ? "challenge" : "neutral";
export const shrinkToNeutral = (score, confidence) => 50 + confidence * (score - 50);

export function researchResult(id, label, score, confidence, signals, warnings, evidence, references, thresholds) {
  return {
    agentId: id, label, version: RESEARCH_AGENT_VERSION,
    verdict: verdictFor(score, thresholds?.support, thresholds?.challenge),
    score: rounded(clamp(score)), confidence: rounded(clamp(confidence, 0, 1), 2),
    signals: signals.filter(Boolean).slice(0, 3), warnings: warnings.filter(Boolean).slice(0, 3),
    evidence: evidence.filter(Boolean).slice(0, 5), referenceIds: references,
  };
}
