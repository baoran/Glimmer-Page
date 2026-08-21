import { createHash } from "node:crypto";
import { runArbitrationAgent } from "./agents/arbitration-agent.mjs";
import { runDataAgent } from "./agents/data-agent.mjs";
import { runFundamentalAgent } from "./agents/fundamental-agent.mjs";
import { runMarketAgent } from "./agents/market-agent.mjs";
import { runNewsAgent } from "./agents/news-agent.mjs";
import { runRiskAgent } from "./agents/risk-agent.mjs";
import { runTechnicalAgent } from "./agents/technical-agent.mjs";
import { rounded, SWARM_POLICY, SWARM_SCHEMA_VERSION, SWARM_VERSION } from "./shared.mjs";

export function buildSwarmReview({ stock, vector, amplitude, market, news, sourceStatus, formalScore, horizon, generatedAt, trainingEligible = true }) {
  const agents = {
    data: runDataAgent({ stock, sourceStatus }),
    technical: runTechnicalAgent({ stock, vector }),
    fundamental: runFundamentalAgent({ stock, vector }),
    market: runMarketAgent({ market, vector }),
    news: runNewsAgent({ stock, news }),
    risk: runRiskAgent({ stock, amplitude }),
  };
  const input = {
    tradeDate: market.tradeDate, horizonId: horizon.id, secid: stock.secid, sourceStatus,
    formalScore, vector: Object.fromEntries(Object.entries(vector).map(([id, value]) => [id, Math.round(value)])),
    featureSnapshot: { change: stock.change, turnoverRate: stock.turnoverRate, volumeRatio: stock.volumeRatio, pe: stock.pe, marketCap: stock.marketCap, turnover: stock.turnover, amplitude: rounded(amplitude, 4) },
    newsEvidence: news.filter((item) => item.title.includes(stock.name) || item.title.includes(stock.code)).slice(0, 3).map((item) => item.title),
  };
  return {
    schemaVersion: SWARM_SCHEMA_VERSION, swarmVersion: SWARM_VERSION, generatedAt,
    dataCutoffTradeDate: market.tradeDate, formalModelVersion: "horizon-vector-v2", formalScoreRef: formalScore,
    policy: SWARM_POLICY, trainingEligible, agents,
    arbitration: runArbitrationAgent({ agents, formalScore }),
    auditTrail: { inputHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"), sourceStatus, nonInterference: true },
  };
}

export function buildSwarmSummary(predictions) {
  const reviews = predictions.map((item) => item.swarmReview).filter(Boolean);
  const verdictCount = { support: 0, neutral: 0, challenge: 0 };
  reviews.forEach((review) => { verdictCount[review.arbitration.verdict] += 1; });
  const highDisagreementCases = predictions.filter((item) => item.swarmReview?.arbitration.disagreement.level === "high").map((item) => ({ predictionId: item.id, code: item.code, name: item.name, horizonId: item.horizonId, spread: item.swarmReview.arbitration.disagreement.spread }));
  return {
    swarmVersion: SWARM_VERSION, totalPredictions: predictions.length, reviewedCount: reviews.length,
    coverageRate: predictions.length ? rounded(reviews.length / predictions.length, 4) : 0,
    verdictCount, averageConsensusScore: reviews.length ? rounded(reviews.reduce((sum, item) => sum + item.arbitration.score, 0) / reviews.length, 2) : 0,
    highDisagreementCases, nonInterference: true,
  };
}

export function buildSwarmReflection(summary) {
  if (!summary?.reviewedCount) return { status: "not-run", overview: "该研究日尚未启用 Agent Swarm 监督层。", conflicts: "无监督记录。", policy: SWARM_POLICY };
  return {
    status: "reviewed",
    overview: `Swarm 已复核 ${summary.reviewedCount}/${summary.totalPredictions} 个候选：支持 ${summary.verdictCount.support}、中性 ${summary.verdictCount.neutral}、挑战 ${summary.verdictCount.challenge}。`,
    conflicts: summary.highDisagreementCases.length ? `${summary.highDisagreementCases.length} 个候选存在高分歧，已标记人工复核。` : "本日没有达到高分歧阈值的候选。",
    policy: SWARM_POLICY,
  };
}
