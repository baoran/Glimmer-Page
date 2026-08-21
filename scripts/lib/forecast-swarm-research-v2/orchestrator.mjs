import { createHash } from "node:crypto";
import { runResearchArbitrationAgent } from "./agents/arbitration-agent.mjs";
import { runResearchDataAgent } from "./agents/data-agent.mjs";
import { runResearchFundamentalAgent } from "./agents/fundamental-agent.mjs";
import { runResearchMarketAgent } from "./agents/market-agent.mjs";
import { runResearchNewsAgent } from "./agents/news-agent.mjs";
import { runResearchRiskAgent } from "./agents/risk-agent.mjs";
import { runResearchTechnicalAgent } from "./agents/technical-agent.mjs";
import { RESEARCH_PARAMETER_EVIDENCE, RESEARCH_REFERENCES, RESEARCH_SWARM_POLICY, RESEARCH_SWARM_SCHEMA_VERSION, RESEARCH_SWARM_VERSION, rounded } from "./shared.mjs";

export function buildResearchSwarmReview({ stock, vector, amplitude, market, news, sourceStatus, formalScore, horizon, generatedAt }) {
  const agents = {
    data: runResearchDataAgent({ stock, sourceStatus }),
    technical: runResearchTechnicalAgent({ stock, vector, horizon }),
    fundamental: runResearchFundamentalAgent({ stock, vector, horizon }),
    market: runResearchMarketAgent({ market, vector }),
    news: runResearchNewsAgent({ stock, news }),
    risk: runResearchRiskAgent({ stock, amplitude }),
  };
  const input = {
    tradeDate: market.tradeDate, horizonId: horizon.id, secid: stock.secid, sourceStatus, formalScore,
    vector: Object.fromEntries(Object.entries(vector).map(([id, value]) => [id, Math.round(value)])),
    featureSnapshot: { change: stock.change, turnoverRate: stock.turnoverRate, volumeRatio: stock.volumeRatio, pe: stock.pe, marketCap: stock.marketCap, turnover: stock.turnover, amplitude: rounded(amplitude, 4) },
    newsEvidence: news.filter((item) => item.title.includes(stock.name) || item.title.includes(stock.code)).slice(0, 3).map((item) => item.title),
  };
  return {
    schemaVersion: RESEARCH_SWARM_SCHEMA_VERSION, swarmVersion: RESEARCH_SWARM_VERSION, generatedAt,
    dataCutoffTradeDate: market.tradeDate, formalModelVersion: "horizon-vector-v2", formalScoreRef: formalScore,
    policy: RESEARCH_SWARM_POLICY, parameterEvidence: RESEARCH_PARAMETER_EVIDENCE,
    trainingEligible: false, shadowOnly: true, agents,
    arbitration: runResearchArbitrationAgent({ agents, formalScore }),
    auditTrail: { inputHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"), sourceStatus, nonInterference: true },
  };
}

export function buildResearchSwarmSummary(predictions) {
  const reviews = predictions.map((item) => item.shadowSwarmReviews?.[RESEARCH_SWARM_VERSION]).filter(Boolean);
  const verdictCount = { support: 0, neutral: 0, challenge: 0 };
  reviews.forEach((review) => { verdictCount[review.arbitration.verdict] += 1; });
  return {
    swarmVersion: RESEARCH_SWARM_VERSION, totalPredictions: predictions.length, reviewedCount: reviews.length,
    coverageRate: predictions.length ? rounded(reviews.length / predictions.length, 4) : 0, verdictCount,
    averageConsensusScore: reviews.length ? rounded(reviews.reduce((sum, item) => sum + item.arbitration.score, 0) / reviews.length, 2) : 0,
    highDisagreementCases: predictions.filter((item) => item.shadowSwarmReviews?.[RESEARCH_SWARM_VERSION]?.arbitration.disagreement.level === "high").map((item) => ({ predictionId: item.id, code: item.code, horizonId: item.horizonId })),
    nonInterference: true, shadowOnly: true, trainingEligible: false,
  };
}

export const RESEARCH_SWARM_DEFINITION = {
  version: RESEARCH_SWARM_VERSION, schemaVersion: RESEARCH_SWARM_SCHEMA_VERSION,
  label: "文献支撑影子监督 v2", policy: RESEARCH_SWARM_POLICY, parameterEvidence: RESEARCH_PARAMETER_EVIDENCE,
  nonInterference: true, shadowOnly: true, trainingEligible: false, references: RESEARCH_REFERENCES,
};
