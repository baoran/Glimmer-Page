import { RESEARCH_AGENT_VERSION, RESEARCH_AGENT_WEIGHTS, rounded, shrinkToNeutral } from "../shared.mjs";

export function runResearchArbitrationAgent({ agents, formalScore }) {
  const adjustedScores = Object.fromEntries(Object.keys(RESEARCH_AGENT_WEIGHTS).map((id) => [id, shrinkToNeutral(agents[id].score, agents[id].confidence)]));
  const consensus = Object.entries(RESEARCH_AGENT_WEIGHTS).reduce((sum, [id, weight]) => sum + adjustedScores[id] * weight, 0);
  const confidence = Object.entries(RESEARCH_AGENT_WEIGHTS).reduce((sum, [id, weight]) => sum + agents[id].confidence * weight, 0);
  const scores = Object.values(adjustedScores);
  const spread = Math.max(...scores) - Math.min(...scores);
  const hardChallenge = agents.data.verdict === "challenge" || agents.risk.verdict === "challenge";
  const verdict = hardChallenge || consensus < 45 ? "challenge" : consensus >= 68 ? "support" : "neutral";
  const actionTag = verdict === "challenge" ? "shadow-risk-review" : spread >= 30 ? "shadow-manual-review" : verdict === "support" ? "shadow-support" : "shadow-observe";
  return {
    agentId: "arbitration", label: "仲裁 Agent · 研究 v2", version: RESEARCH_AGENT_VERSION,
    verdict, score: rounded(consensus), confidence: rounded(confidence, 2), actionTag,
    adjustedScores: Object.fromEntries(Object.entries(adjustedScores).map(([id, value]) => [id, rounded(value, 2)])),
    disagreement: { spread: rounded(spread), level: spread >= 30 ? "high" : spread >= 18 ? "medium" : "low" },
    signals: [`置信度收缩后的影子共识 ${rounded(consensus)} 分`, `正式 Vector ${formalScore} 分仅作引用`],
    warnings: ["研究 v2 未经 Glimmer 样本外验证，只能并行观察", spread >= 30 ? "置信度调整后仍存在高分歧" : ""].filter(Boolean),
    evidence: Object.entries(RESEARCH_AGENT_WEIGHTS).map(([id, weight]) => `${id} 权重 ${rounded(weight * 100)}% · 原始 ${agents[id].score} · 收缩 ${rounded(adjustedScores[id], 1)}`),
    referenceIds: [], nonInterference: true, shadowOnly: true,
  };
}
