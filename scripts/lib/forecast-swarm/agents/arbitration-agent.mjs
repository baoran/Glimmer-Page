import { AGENT_VERSION, AGENT_WEIGHTS, definition, rounded } from "../shared.mjs";

export const ARBITRATION_AGENT_ID = "arbitration";

export function runArbitrationAgent({ agents, formalScore }) {
  const entries = Object.entries(AGENT_WEIGHTS);
  const consensus = entries.reduce((sum, [id, weight]) => sum + agents[id].score * weight, 0);
  const confidence = entries.reduce((sum, [id, weight]) => sum + agents[id].confidence * weight, 0);
  const scores = entries.map(([id]) => agents[id].score);
  const spread = Math.max(...scores) - Math.min(...scores);
  const hardChallenge = ["data", "risk"].some((id) => agents[id].verdict === "challenge");
  const verdict = hardChallenge || consensus < 48 ? "challenge" : consensus >= 65 ? "support" : "neutral";
  const actionTag = verdict === "challenge" ? "risk-review" : spread >= 35 ? "manual-review" : verdict === "support" ? "research-support" : "observe";
  const disagreements = entries
    .map(([id]) => agents[id])
    .sort((a, b) => Math.abs(b.score - consensus) - Math.abs(a.score - consensus))
    .slice(0, 2)
    .map((agent) => `${agent.label} ${agent.score} 分`);
  return {
    agentId: ARBITRATION_AGENT_ID, label: definition(ARBITRATION_AGENT_ID).label, version: AGENT_VERSION,
    verdict, score: rounded(consensus), confidence: rounded(confidence, 2), actionTag,
    disagreement: { spread: rounded(spread), level: spread >= 35 ? "high" : spread >= 20 ? "medium" : "low" },
    signals: [`监督共识 ${rounded(consensus)} 分`, `与正式 Vector ${formalScore} 分并列记录，不参与重排`],
    warnings: spread >= 35 ? [`专业 Agent 分歧较高：${disagreements.join("、")}`] : [],
    evidence: entries.map(([id, weight]) => `${definition(id).label} 权重 ${rounded(weight * 100)}% · ${agents[id].score} 分`),
    nonInterference: true,
  };
}
