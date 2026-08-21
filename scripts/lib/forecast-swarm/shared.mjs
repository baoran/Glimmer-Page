export const SWARM_VERSION = "forecast-supervision-swarm-v1";
export const SWARM_SCHEMA_VERSION = 1;
export const SWARM_POLICY = "只读监督层：复核正式六维 Vector，不修改候选、分数、排名或历史日志。";
export const AGENT_VERSION = "deterministic-rule-v1";
export const PARAMETER_EVIDENCE = {
  level: "E1",
  label: "人工工程先验",
  validated: false,
  statement: "公式、权重、阈值和置信度用于建立可审计基线，不来自论文、行业标准或历史拟合，尚未通过充分样本外验证。",
  documentation: "docs/agents/parameter-provenance.md",
};

export const SWARM_AGENT_DEFINITIONS = [
  { id: "data", label: "数据 Agent", responsibility: "检查行情字段、来源状态和输入完整性" },
  { id: "technical", label: "技术 Agent", responsibility: "复核动能、交易参与和波动稳定" },
  { id: "fundamental", label: "基本面 Agent", responsibility: "依据当时可得估值与规模数据做约束判断" },
  { id: "market", label: "市场 Agent", responsibility: "评估指数广度和市场情境是否顺风" },
  { id: "news", label: "新闻 Agent", responsibility: "核验标题级直接证据、情绪与相关性" },
  { id: "risk", label: "风险 Agent", responsibility: "主动寻找过热、波动、估值和流动性反证" },
  { id: "arbitration", label: "仲裁 Agent", responsibility: "汇总分歧并给出只读监督结论" },
];

export const AGENT_WEIGHTS = { data: .15, technical: .25, fundamental: .15, market: .15, news: .10, risk: .20 };
export const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
export const rounded = (value, digits = 0) => Number(value.toFixed(digits));
export const verdictFor = (score, support = 65, challenge = 45) => score >= support ? "support" : score < challenge ? "challenge" : "neutral";
export const definition = (id) => SWARM_AGENT_DEFINITIONS.find((item) => item.id === id);

export function agentResult(id, score, confidence, signals, warnings, evidence, thresholds) {
  return {
    agentId: id,
    label: definition(id).label,
    version: AGENT_VERSION,
    verdict: verdictFor(score, thresholds?.support, thresholds?.challenge),
    score: rounded(clamp(score)),
    confidence: rounded(clamp(confidence, 0, 1), 2),
    signals: signals.filter(Boolean).slice(0, 3),
    warnings: warnings.filter(Boolean).slice(0, 3),
    evidence: evidence.filter(Boolean).slice(0, 5),
  };
}
