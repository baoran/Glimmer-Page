import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const path = resolve(process.cwd(), "site", "data", "forecasts.json");
const data = JSON.parse(await readFile(path, "utf8"));
const fail = (message) => { throw new Error(`预测数据校验失败：${message}`); };

if (data.contentVersion !== 1) fail("contentVersion 必须为 1");
if (!data.model?.version || !Array.isArray(data.model.dimensions) || data.model.dimensions.length < 5) fail("模型或向量定义缺失");
if (!Array.isArray(data.horizons) || data.horizons.length !== 6) fail("必须配置六个预测周期");
if (!Array.isArray(data.runs) || !data.runs.length) fail("预测日志为空");
if (!Array.isArray(data.tracking) || !Array.isArray(data.reports) || !data.reports.length) fail("追踪或日报为空");

const horizonIds = new Set(data.horizons.map((item) => item.id));
const dimensionIds = data.model.dimensions.map((item) => item.id);
const predictionIds = new Set();
for (const run of data.runs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(run.asOfTradeDate)) fail(`运行日期无效：${run.asOfTradeDate}`);
  for (const horizon of data.horizons) {
    const picks = run.predictions.filter((item) => item.horizonId === horizon.id);
    if (picks.length !== 5) fail(`${run.runId} 的 ${horizon.label} 不是 5 只股票`);
    if (new Set(picks.map((item) => item.secid)).size !== 5) fail(`${run.runId} 的 ${horizon.label} 存在重复股票`);
  }
  for (const prediction of run.predictions) {
    if (predictionIds.has(prediction.id)) fail(`预测 ID 重复：${prediction.id}`);
    predictionIds.add(prediction.id);
    if (!horizonIds.has(prediction.horizonId)) fail(`未知周期：${prediction.horizonId}`);
    if (!(prediction.entryPrice > 0) || !(prediction.score >= 0 && prediction.score <= 99)) fail(`价格或评分无效：${prediction.id}`);
    if (dimensionIds.some((id) => !Number.isFinite(prediction.vector?.[id]))) fail(`向量不完整：${prediction.id}`);
    if (!Array.isArray(prediction.reasons) || !prediction.reasons.length || !Array.isArray(prediction.risks)) fail(`解释不完整：${prediction.id}`);
    if (!prediction.analysis?.thesis || prediction.analysis.contributions?.length !== dimensionIds.length) fail(`选择依据分析不完整：${prediction.id}`);
    if (!prediction.analysis.news?.summary || !prediction.analysis.experience?.note) fail(`新闻或经验依据缺失：${prediction.id}`);
  }
}

const trackingIds = new Set(data.tracking.map((item) => item.predictionId));
for (const id of predictionIds) if (!trackingIds.has(id)) fail(`缺少追踪记录：${id}`);
for (const item of data.tracking) {
  if (!predictionIds.has(item.predictionId)) fail(`追踪记录没有对应预测：${item.predictionId}`);
  if (!["active", "matured", "missing-price"].includes(item.status)) fail(`未知追踪状态：${item.status}`);
}
if (data.audit?.predictionCount !== predictionIds.size) fail("审计计数与实际预测数不一致");
for (const report of data.reports) {
  if (!report.contextReview?.market || !report.contextReview?.news) fail(`市场资讯复盘缺失：${report.tradeDate}`);
  if (!["market", "news", "model", "next"].every((key) => report.reflection?.[key])) fail(`每日三省不完整：${report.tradeDate}`);
}

console.log(`预测数据校验通过：${data.runs.length} 个交易日，${predictionIds.size} 个预测，${data.tracking.filter((item) => item.status === "matured").length} 个已到期。`);
