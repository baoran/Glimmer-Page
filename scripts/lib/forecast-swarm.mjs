import { createHash } from "node:crypto";

export const SWARM_VERSION = "forecast-supervision-swarm-v1";
export const SWARM_SCHEMA_VERSION = 1;
export const SWARM_POLICY = "只读监督层：复核正式六维 Vector，不修改候选、分数、排名或历史日志。";

export const SWARM_AGENT_DEFINITIONS = [
  { id: "data", label: "数据 Agent", responsibility: "检查行情字段、来源状态和输入完整性" },
  { id: "technical", label: "技术 Agent", responsibility: "复核动能、交易参与和波动稳定" },
  { id: "fundamental", label: "基本面 Agent", responsibility: "依据当时可得估值与规模数据做约束判断" },
  { id: "market", label: "市场 Agent", responsibility: "评估指数广度和市场情境是否顺风" },
  { id: "news", label: "新闻 Agent", responsibility: "核验标题级直接证据、情绪与相关性" },
  { id: "risk", label: "风险 Agent", responsibility: "主动寻找过热、波动、估值和流动性反证" },
  { id: "arbitration", label: "仲裁 Agent", responsibility: "汇总分歧并给出只读监督结论" },
];

const AGENT_VERSION = "deterministic-rule-v1";
const AGENT_WEIGHTS = { data: .15, technical: .25, fundamental: .15, market: .15, news: .10, risk: .20 };
const POSITIVE_NEWS = /增长|利好|增持|回购|上涨|突破|获批|中标|扭亏|超预期|创新高/;
const NEGATIVE_NEWS = /下跌|风险|减持|亏损|处罚|调查|退市|暴跌|违约|终止|不及预期/;
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const rounded = (value, digits = 0) => Number(value.toFixed(digits));
const verdictFor = (score, support = 65, challenge = 45) => score >= support ? "support" : score < challenge ? "challenge" : "neutral";
const definition = (id) => SWARM_AGENT_DEFINITIONS.find((item) => item.id === id);

function result(id, score, confidence, signals, warnings, evidence, thresholds) {
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

function dataAgent(stock, sourceStatus) {
  const fields = ["price", "change", "turnoverRate", "volumeRatio", "pe", "marketCap", "turnover", "high", "low", "previousClose"];
  const valid = fields.filter((key) => Number.isFinite(stock[key])).length;
  const completeness = valid / fields.length;
  const sourceScore = sourceStatus === "live" ? 100 : sourceStatus === "partial" ? 72 : 35;
  const score = completeness * 70 + sourceScore * .30;
  return result("data", score, sourceStatus === "live" ? .96 : .68,
    [`${valid}/${fields.length} 个必需行情字段有效`, `核心来源状态：${sourceStatus}`],
    [sourceStatus !== "live" ? "行情来源并非全量实时，监督置信度已降低" : ""],
    [`观察价 ${stock.price}`, `成交额 ${rounded(stock.turnover / 1e8, 2)} 亿元`, `总市值 ${rounded(stock.marketCap / 1e8, 2)} 亿元`]);
}

function technicalAgent(stock, vector) {
  const score = vector.momentum * .40 + vector.participation * .35 + vector.stability * .25;
  return result("technical", score, .84,
    [`价格动能 ${Math.round(vector.momentum)}`, `交易参与 ${Math.round(vector.participation)}`, `波动稳定 ${Math.round(vector.stability)}`],
    [stock.change > 6 ? "单日涨幅偏高，动量可能伴随回撤" : "", stock.volumeRatio > 3.5 ? "量比快速放大，持续性需要后续成交验证" : ""],
    [`当日涨跌 ${rounded(stock.change, 2)}%`, `量比 ${rounded(stock.volumeRatio, 2)}`, `换手率 ${rounded(stock.turnoverRate, 2)}%`]);
}

function fundamentalAgent(stock, vector) {
  const score = vector.valuation * .70 + vector.liquidity * .30;
  return result("fundamental", score, .46,
    [`估值约束 ${Math.round(vector.valuation)}`, `规模与流动性支撑 ${Math.round(vector.liquidity)}`],
    ["当前快照缺少盈利增长、资产负债和现金流，不能视为完整基本面结论", stock.pe > 60 ? "市盈率偏高，对盈利预期变化敏感" : ""],
    [`市盈率 ${rounded(stock.pe, 1)} 倍`, `总市值 ${rounded(stock.marketCap / 1e8, 0)} 亿元`]);
}

function marketAgent(market, vector) {
  const changes = market.indices.map((item) => item.change);
  const positive = changes.filter((value) => value > 0).length;
  return result("market", vector.context, .78,
    [`市场情境 ${Math.round(vector.context)}`, `${positive}/${changes.length} 个核心指数上涨`],
    [vector.context < 45 ? "市场广度或个股过热惩罚对候选不利" : ""],
    market.indices.slice(0, 5).map((item) => `${item.name} ${rounded(item.change, 2)}%`));
}

function newsAgent(stock, news) {
  const direct = news.filter((item) => item.title.includes(stock.name) || item.title.includes(stock.code));
  const positive = direct.filter((item) => POSITIVE_NEWS.test(item.title)).length;
  const negative = direct.filter((item) => NEGATIVE_NEWS.test(item.title)).length;
  const score = direct.length ? clamp(50 + positive * 12 - negative * 15) : 50;
  return result("news", score, direct.length ? Math.min(.82, .48 + direct.length * .1) : .25,
    [direct.length ? `发现 ${direct.length} 条标题级直接关联资讯` : "未发现标题级直接关联资讯", positive ? `正向关键词 ${positive} 条` : "", negative ? `风险关键词 ${negative} 条` : ""],
    [!direct.length ? "仅有市场级新闻，保持中性且不推断个股利好" : "", "标题关键词不等同于公告全文或事件影响判断"],
    (direct.length ? direct : news.slice(0, 2)).map((item) => `${item.source} · ${item.title}`));
}

function riskAgent(stock, amplitude) {
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
  return result("risk", safety, .82, signals, warnings,
    [`日内振幅 ${rounded(amplitude, 2)}%`, `涨跌幅 ${rounded(stock.change, 2)}%`, `市盈率 ${rounded(stock.pe, 1)} 倍`], { support: 70, challenge: 50 });
}

function arbitrate(agents, formalScore) {
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
    agentId: "arbitration", label: definition("arbitration").label, version: AGENT_VERSION,
    verdict, score: rounded(consensus), confidence: rounded(confidence, 2), actionTag,
    disagreement: { spread: rounded(spread), level: spread >= 35 ? "high" : spread >= 20 ? "medium" : "low" },
    signals: [`监督共识 ${rounded(consensus)} 分`, `与正式 Vector ${formalScore} 分并列记录，不参与重排`],
    warnings: spread >= 35 ? [`专业 Agent 分歧较高：${disagreements.join("、")}`] : [],
    evidence: entries.map(([id, weight]) => `${definition(id).label} 权重 ${rounded(weight * 100)}% · ${agents[id].score} 分`),
    nonInterference: true,
  };
}

export function buildSwarmReview({ stock, vector, amplitude, market, news, sourceStatus, formalScore, horizon, generatedAt, trainingEligible = true }) {
  const agents = {
    data: dataAgent(stock, sourceStatus),
    technical: technicalAgent(stock, vector),
    fundamental: fundamentalAgent(stock, vector),
    market: marketAgent(market, vector),
    news: newsAgent(stock, news),
    risk: riskAgent(stock, amplitude),
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
    policy: SWARM_POLICY, trainingEligible, agents, arbitration: arbitrate(agents, formalScore),
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
