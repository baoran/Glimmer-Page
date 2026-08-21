import { strict as assert } from "node:assert";
import { buildResearchSwarmReview, RESEARCH_SWARM_VERSION } from "./lib/forecast-swarm-research-v2.mjs";
import { buildSwarmReview } from "./lib/forecast-swarm.mjs";

const generatedAt = "2026-08-21T08:10:00.000Z";
const market = { tradeDate: "2026-08-21", indices: [{ name: "上证指数", change: .4 }, { name: "深证成指", change: .8 }, { name: "创业板指", change: 1.1 }] };
const horizon = { id: "week", sessions: 5 };
const vector = { momentum: 72, participation: 68, liquidity: 75, valuation: 80, stability: 70, context: 66 };
const stock = { secid: "1.600000", code: "600000", name: "测试股", price: 10, change: 2.5, turnoverRate: 4, volumeRatio: 1.5, pe: 18, marketCap: 5e10, turnover: 8e8, high: 10.3, low: 9.8, previousClose: 9.76 };
const args = { stock, vector, amplitude: 5.1, market, news: [], sourceStatus: "live", formalScore: 72, horizon, generatedAt };

const v1 = buildSwarmReview({ ...args, trainingEligible: true });
assert.equal(v1.formalScoreRef, 72);
assert.equal(v1.arbitration.nonInterference, true);

const v2 = buildResearchSwarmReview(args);
assert.equal(v2.swarmVersion, RESEARCH_SWARM_VERSION);
assert.equal(v2.formalScoreRef, 72);
assert.equal(v2.shadowOnly, true);
assert.equal(v2.trainingEligible, false);
assert.equal(v2.agents.news.confidence, 0, "无直接新闻必须完全回归中性");
assert.equal(v2.agents.technical.confidence, .62);
assert.equal(v2.arbitration.nonInterference, true);
assert.equal(v2.auditTrail.inputHash.length, 64);

const longHorizon = buildResearchSwarmReview({ ...args, horizon: { id: "year", sessions: 250 } });
assert.equal(longHorizon.agents.technical.confidence, .38, "单日技术代理在长周期必须降置信度");
assert.equal(longHorizon.agents.fundamental.confidence, .48, "长周期基本面代理可获得相对更高但仍受限的置信度");

const riskyStock = { ...stock, change: 8.5, volumeRatio: 5, pe: 100, marketCap: 5e9, turnover: 1e8, high: 11.5, low: 9.5 };
const risky = buildResearchSwarmReview({ ...args, stock: riskyStock, amplitude: 15 });
assert.equal(risky.agents.risk.verdict, "challenge");
assert.equal(risky.arbitration.verdict, "challenge", "风险 Agent 质疑必须触发 shadow 仲裁硬质疑");

const inconsistentStock = { ...stock, price: 12, high: 11, low: 10 };
const inconsistent = buildResearchSwarmReview({ ...args, stock: inconsistentStock, sourceStatus: "partial" });
assert.equal(inconsistent.agents.data.verdict, "challenge");
assert.equal(inconsistent.arbitration.verdict, "challenge", "数据质量质疑必须触发 shadow 仲裁硬质疑");

console.log("Swarm 测试通过：v1 非干预、v2 shadow 隔离、无新闻收缩、周期置信度、风险与数据硬质疑均符合契约。");
