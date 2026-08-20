import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "site", "data");
const FORECAST_PATH = resolve(ROOT, "forecasts.json");
const REPLAY_MODEL = "historical-replay-price-volume-v1";
const REPLAY_DAYS = 10;
const UNIVERSE_SIZE = 240;
const EAST_KLINE = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const TENCENT_KLINE = "https://web.ifzq.gtimg.cn/appstock/app/kline/kline";
const HEADERS = { Accept: "application/json,text/plain,*/*", Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" };
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const peak = (value, ideal, radius) => clamp(100 - Math.abs(value - ideal) / Math.max(radius, .001) * 100);
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : 0; };
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 500);
    }
  }
  throw lastError;
}

const eastSecid = (secid) => `${secid.startsWith("sh") ? "1" : "0"}.${secid.slice(2)}`;

async function fetchKlines(secid, limit = 48, stock = null) {
  const query = new URLSearchParams({ param: `${secid},day,2026-05-01,2050-01-01,${limit}` });
  const payload = await fetchJson(`${TENCENT_KLINE}?${query}`);
  const rawRows = payload.data?.[secid]?.day ?? [];
  const shares = stock?.marketCap > 0 && stock?.price > 0 ? stock.marketCap / stock.price : 0;
  return rawRows.map((fields, index) => {
    const [date, openText, closeText, highText, lowText, volumeText] = fields;
    const open = Number(openText); const close = Number(closeText); const high = Number(highText); const low = Number(lowText); const volume = Number(volumeText);
    const previousClose = Number(rawRows[index - 1]?.[2] ?? open);
    const changeAmount = close - previousClose;
    const change = previousClose > 0 ? changeAmount / previousClose * 100 : 0;
    const amplitude = previousClose > 0 ? (high - low) / previousClose * 100 : 0;
    const volumeShares = volume * 100;
    return { date, open, close, high, low, volume, amount: volumeShares * close, amplitude, change, changeAmount, turnoverRate: shares > 0 ? volumeShares / shares * 100 : 0 };
  }).filter((row) => row.date && row.close > 0);
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try { results[index] = await worker(items[index], index); }
      catch (error) { console.warn(`历史日线跳过 ${items[index].code}：${error.message}`); results[index] = null; }
    }
  }));
  return results;
}

function newsEvidence(stock, news) {
  const direct = news.filter((item) => item.title.includes(stock.name) || item.title.includes(stock.code)).slice(0, 3);
  return {
    direct: direct.map((item) => ({ title: item.title, source: item.source, category: item.category })),
    market: news.slice(0, 3).map((item) => ({ title: item.title, source: item.source, category: item.category })),
    summary: direct.length ? `历史归档中发现 ${direct.length} 条标题级直接关联资讯。` : news.length ? "历史资讯未发现标题级直接关联，只保留市场级情境。" : "该日期没有可用的历史新闻归档，不补写或推断新闻依据。",
  };
}

function rowVector(rows, index, marketChange) {
  const row = rows[index];
  const previous = rows.slice(Math.max(0, index - 5), index);
  if (previous.length < 5) return null;
  const fiveDayReturn = (row.close / previous[0].close - 1) * 100;
  const volumeRatio = row.volume / Math.max(1, average(previous.map((item) => item.volume)));
  const volatility = Math.sqrt(average(previous.map((item) => item.change ** 2)));
  const closePosition = row.high > row.low ? (row.close - row.low) / (row.high - row.low) : .5;
  return {
    vector: {
      momentum: clamp(peak(fiveDayReturn, 4, 14) * .52 + peak(row.change, 2.5, 8) * .28 + closePosition * 20),
      participation: clamp(peak(volumeRatio, 1.6, 3.5) * .55 + peak(row.turnoverRate, 5, 18) * .45),
      liquidity: peak(Math.log10(Math.max(1, row.amount)), 9.6, 2.3),
      valuation: 50,
      stability: clamp(peak(row.amplitude, 2.5, 10) * .62 + peak(volatility, 2, 8) * .38),
      context: clamp(50 + marketChange * 10, 25, 78),
    },
    featureSnapshot: { change: row.change, turnoverRate: row.turnoverRate, volumeRatio, pe: 0, marketCap: 0, turnover: row.amount, amplitude: row.amplitude, fiveDayReturn, volatility },
  };
}

function chooseForDate(universe, date, horizon, marketChange, news) {
  const candidates = universe.flatMap(({ stock, rows }) => {
    const index = rows.findIndex((row) => row.date === date);
    if (index < 5) return [];
    const factor = rowVector(rows, index, marketChange);
    const row = rows[index];
    if (!factor || row.close < 3 || row.change <= -5 || row.change >= 9.7 || row.turnoverRate <= .2 || row.turnoverRate >= 25 || row.amount < 5e7) return [];
    const weightedScore = Object.entries(horizon.weights).reduce((sum, [id, weight]) => sum + factor.vector[id] * weight, 0);
    return [{ stock, row, ...factor, score: clamp(weightedScore) }];
  }).sort((a, b) => b.score - a.score || b.row.amount - a.row.amount).slice(0, 5);

  return candidates.map((item, rank) => {
    const contributions = Object.entries(horizon.weights).map(([id, weight]) => ({ id, label: ({ momentum: "价格动能", participation: "交易参与", liquidity: "流动性", valuation: "估值占位", stability: "波动稳定", context: "市场情境" })[id], score: Math.round(item.vector[id]), weight, contribution: Number((item.vector[id] * weight).toFixed(2)) })).sort((a, b) => b.contribution - a.contribution);
    const top = contributions.slice(0, 3);
    return {
      id: `${date}:${REPLAY_MODEL}:${horizon.id}:${item.stock.secid}`, horizonId: horizon.id, rank: rank + 1,
      secid: item.stock.secid, code: item.stock.code, name: item.stock.name, score: Math.round(item.score), entryPrice: item.row.close,
      entryCloseDate: date, entryBasis: "历史未复权收盘观察价", modelVersion: REPLAY_MODEL,
      vector: Object.fromEntries(Object.entries(item.vector).map(([id, value]) => [id, Math.round(value)])),
      featureSnapshot: item.featureSnapshot, effectiveWeights: horizon.weights,
      reasons: [
        `${top[0].label} ${top[0].score}，贡献 ${top[0].contribution.toFixed(1)} 分`,
        `近 5 日收益 ${item.featureSnapshot.fiveDayReturn.toFixed(2)}%，当日涨幅 ${item.row.change.toFixed(2)}%`,
        `历史量比 ${item.featureSnapshot.volumeRatio.toFixed(2)}、换手率 ${item.row.turnoverRate.toFixed(2)}%`,
      ],
      risks: ["历史回放使用当前流动股票池，存在幸存者与样本选择偏差", "历史接口不含当日 PE 与市值，估值维度固定为中性 50"],
      analysis: {
        thesis: `${horizon.label}历史回放中，该股在可见的日线量价数据里综合排名靠前，主要贡献来自${top.slice(0, 2).map((factor) => factor.label).join("与")}。`,
        contributions, news: newsEvidence(item.stock, news),
        experience: { sampleSize: 0, status: "replay-only", note: "历史回放结果与正式前向经验池完全隔离，不参与未来权重校准。" },
      },
      replay: { universe: `2026-08-20 当前高流动性股票前 ${UNIVERSE_SIZE} 只`, pointInTimeUniverse: false, priceAdjustment: "不复权" },
    };
  });
}

function markPrediction(prediction, cutoffDate, allDates, historyBySecid, horizonSessions) {
  const start = allDates.indexOf(prediction.entryCloseDate);
  const cutoff = allDates.indexOf(cutoffDate);
  const rows = historyBySecid.get(prediction.secid) ?? [];
  const rowByDate = new Map(rows.map((row) => [row.date, row]));
  const currentDate = allDates[Math.max(start, cutoff)];
  const currentRow = rowByDate.get(currentDate);
  const elapsedSessions = Math.max(0, cutoff - start);
  if (!currentRow) return { predictionId: prediction.id, horizonId: prediction.horizonId, status: "missing-price", elapsedSessions, lastDate: cutoffDate };
  const currentReturn = (currentRow.close / prediction.entryPrice - 1) * 100;
  if (elapsedSessions >= horizonSessions) {
    const exitDate = allDates[start + horizonSessions];
    const exitRow = rowByDate.get(exitDate);
    if (!exitRow) return { predictionId: prediction.id, horizonId: prediction.horizonId, status: "missing-price", elapsedSessions, lastDate: cutoffDate };
    const returnPct = (exitRow.close / prediction.entryPrice - 1) * 100;
    return { predictionId: prediction.id, horizonId: prediction.horizonId, status: "matured", elapsedSessions: horizonSessions, lastDate: exitDate, lastPrice: exitRow.close, returnPct, exitCloseDate: exitDate, exitPrice: exitRow.close, outcome: returnPct > 0 ? "win" : returnPct < 0 ? "loss" : "flat" };
  }
  return { predictionId: prediction.id, horizonId: prediction.horizonId, status: "active", elapsedSessions, lastDate: cutoffDate, lastPrice: currentRow.close, returnPct: currentReturn };
}

function buildReport(date, replayRuns, horizons, indexRows, archiveByDate, allDates, historyBySecid) {
  const runs = replayRuns.filter((run) => run.asOfTradeDate <= date);
  const predictionById = new Map(runs.flatMap((run) => run.predictions.map((prediction) => [prediction.id, prediction])));
  const horizonById = new Map(horizons.map((horizon) => [horizon.id, horizon]));
  const marks = [...predictionById.values()].map((prediction) => markPrediction(prediction, date, allDates, historyBySecid, horizonById.get(prediction.horizonId).sessions));
  const byHorizon = horizons.map((horizon) => {
    const items = marks.filter((item) => item.horizonId === horizon.id);
    const active = items.filter((item) => item.status === "active");
    const matured = items.filter((item) => item.status === "matured");
    return { horizonId: horizon.id, active: active.length, positiveActive: active.filter((item) => item.returnPct > 0).length, averageFloatingReturnPct: average(active.map((item) => item.returnPct)), maturedToday: matured.filter((item) => item.exitCloseDate === date).length, matured: matured.length, wins: matured.filter((item) => item.outcome === "win").length, winRate: matured.length ? matured.filter((item) => item.outcome === "win").length / matured.length : 0, averageRealizedReturnPct: average(matured.map((item) => item.returnPct)), vectorAverages: {} };
  });
  const active = marks.filter((item) => item.status === "active");
  const matured = marks.filter((item) => item.status === "matured");
  const maturedToday = matured.filter((item) => item.exitCloseDate === date);
  const indexToday = indexRows.flatMap(({ name, rows }) => { const row = rows.find((item) => item.date === date); return row ? [{ name, change: row.change }] : []; }).sort((a, b) => b.change - a.change);
  const news = archiveByDate.get(date) ?? [];
  const positivePattern = /增长|利好|增持|回购|上涨|突破|获批|中标|扭亏|超预期|创新高/;
  const negativePattern = /下跌|风险|减持|亏损|处罚|调查|退市|暴跌|违约|终止|不及预期/;
  const returnValues = matured.map((item) => item.returnPct);
  const reflection = {
    market: `历史核心指数平均 ${average(indexToday.map((item) => item.change)).toFixed(2)}%，${indexToday.filter((item) => item.change > 0).length}/${indexToday.length} 个上涨；领涨为${indexToday[0]?.name ?? "—"}。`,
    news: news.length ? `历史归档含 ${news.length} 条资讯，已做标题级辅助核验。` : "该日没有已归档资讯，回放不补写新闻结论。",
    model: maturedToday.length ? `该日有 ${maturedToday.length} 个回放样本到期，正收益 ${maturedToday.filter((item) => item.outcome === "win").length} 个。` : "该日尚无回放样本到期，只有在途表现。",
    next: "回放用于体验和检查格式；因股票池非时点化、估值缺失，结果不进入正式模型经验池。",
  };
  return {
    tradeDate: date, generatedAt: new Date().toISOString(), sourceStatus: "historical-replay", isHistoricalReplay: true, newPredictionCount: 30,
    activeCount: active.length, maturedTodayCount: maturedToday.length, missingPriceCount: marks.filter((item) => item.status === "missing-price").length,
    summary: { positiveActiveRate: active.length ? active.filter((item) => item.returnPct > 0).length / active.length : 0, averageFloatingReturnPct: average(active.map((item) => item.returnPct)), cumulativeMatured: matured.length, cumulativeWinRate: matured.length ? matured.filter((item) => item.outcome === "win").length / matured.length : 0, cumulativeAverageReturnPct: average(returnValues), cumulativeMedianReturnPct: median(returnValues) },
    byHorizon,
    narrative: [`当日生成 30 个历史回放候选，每周期 5 只。`, `截至当日有 ${active.length} 个回放样本观察中，平均浮动 ${average(active.map((item) => item.returnPct)).toFixed(2)}%。`, maturedToday.length ? `当日到期 ${maturedToday.length} 个，正收益 ${maturedToday.filter((item) => item.outcome === "win").length} 个。` : "当日暂无到期样本。", "回放未使用未来价格选股，但股票池取自当前流动股票，不能视为严谨的无偏回测。"],
    contextReview: { market: { averageIndexChange: average(indexToday.map((item) => item.change)), positiveIndices: indexToday.filter((item) => item.change > 0).length, totalIndices: indexToday.length, leadingIndex: indexToday[0] ?? null, laggingIndex: indexToday.at(-1) ?? null, leadingSectors: [] }, news: { count: news.length, positiveSignals: news.filter((item) => positivePattern.test(item.title)).length, negativeSignals: news.filter((item) => negativePattern.test(item.title)).length, categories: [], headlines: news.slice(0, 5).map((item) => ({ title: item.title, source: item.source, category: item.category, heat: item.heat })), note: news.length ? "来自仓库已有历史新闻归档。" : "无归档，不补写。" } },
    reflection,
    experience: Object.fromEntries(horizons.map((horizon) => [horizon.id, { sampleSize: 0, status: "replay-only", adjustments: {}, note: "与正式经验池隔离。" }])),
  };
}

async function main() {
  const [forecasts, stocksData, archive] = await Promise.all([
    readJson(FORECAST_PATH, null), readJson(resolve(ROOT, "stocks.json"), null), readJson(resolve(ROOT, "archive.json"), []),
  ]);
  if (!forecasts?.horizons?.length || !stocksData?.items?.length) throw new Error("请先生成正式预测和股票快照");
  const latestDate = forecasts.latestTradeDate;
  const liquidUniverse = stocksData.items.filter((stock) => !/^(N|C|\*?ST|退)/i.test(stock.name) && stock.price >= 3 && stock.turnover > 1e8).sort((a, b) => b.turnover - a.turnover).slice(0, UNIVERSE_SIZE);
  console.log(`抓取 ${liquidUniverse.length} 只当前高流动股票的历史日线…`);
  const histories = await mapConcurrent(liquidUniverse, 5, async (stock) => ({ stock, rows: await fetchKlines(stock.secid, 48, stock) }));
  const universe = histories.filter((item) => item?.rows.length >= 20);
  if (universe.length < 100) throw new Error(`历史行情仅获得 ${universe.length} 只，停止回填`);

  const indexSpecs = [["上证指数", "sh000001"], ["深证成指", "sz399001"], ["创业板指", "sz399006"], ["沪深300", "sh000300"], ["科创50", "sh000688"]];
  const indexRows = await Promise.all(indexSpecs.map(async ([name, secid]) => ({ name, rows: await fetchKlines(secid) })));
  const allDates = indexRows[0].rows.map((row) => row.date).filter((date) => date <= latestDate);
  const latestIndex = allDates.indexOf(latestDate);
  const replayDates = allDates.slice(Math.max(0, latestIndex - REPLAY_DAYS), latestIndex);
  if (replayDates.length !== REPLAY_DAYS) throw new Error(`只能获得 ${replayDates.length} 个历史交易日`);
  const archiveByDate = new Map(archive.map((day) => [day.tradeDate, day.news]));
  const marketChangeByDate = new Map(allDates.map((date) => [date, average(indexRows.flatMap(({ rows }) => rows.find((row) => row.date === date)?.change ?? []))]));

  const replayRuns = replayDates.map((date) => {
    const news = archiveByDate.get(date) ?? [];
    const predictions = forecasts.horizons.flatMap((horizon) => chooseForDate(universe, date, horizon, marketChangeByDate.get(date) ?? 0, news));
    if (predictions.length !== 30) throw new Error(`${date} 只生成 ${predictions.length} 个候选`);
    return { runId: `${date}:${REPLAY_MODEL}`, asOfTradeDate: date, generatedAt: new Date().toISOString(), modelVersion: REPLAY_MODEL, sourceStatus: "historical-replay", predictions, replayMetadata: { purpose: "体验前两周运行格式与短周期结果", universeSize: universe.length, universeBasis: "从 2026-08-20 当前股票快照中按成交额选取", pointInTimeUniverse: false, factors: "历史未复权 OHLCV、成交额、换手率；估值固定中性", trainingEligible: false } };
  });

  const historyBySecid = new Map(universe.map(({ stock, rows }) => [stock.secid, rows]));
  const horizonById = new Map(forecasts.horizons.map((horizon) => [horizon.id, horizon]));
  const replayTracking = replayRuns.flatMap((run) => run.predictions.map((prediction) => markPrediction(prediction, latestDate, allDates, historyBySecid, horizonById.get(prediction.horizonId).sessions)));
  const replayReports = replayDates.map((date) => buildReport(date, replayRuns, forecasts.horizons, indexRows, archiveByDate, allDates, historyBySecid));
  const nonReplayRuns = forecasts.runs.filter((run) => run.modelVersion !== REPLAY_MODEL);
  const nonReplayIds = new Set(nonReplayRuns.flatMap((run) => run.predictions.map((prediction) => prediction.id)));
  const next = {
    ...forecasts,
    generatedAt: new Date().toISOString(),
    tradingDates: [...new Set([...allDates, ...(forecasts.tradingDates ?? [])])].sort().slice(-420),
    runs: [...nonReplayRuns, ...replayRuns].sort((a, b) => b.asOfTradeDate.localeCompare(a.asOfTradeDate)),
    tracking: [...forecasts.tracking.filter((item) => nonReplayIds.has(item.predictionId)), ...replayTracking],
    reports: [...forecasts.reports.filter((report) => !replayDates.includes(report.tradeDate)), ...replayReports].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)),
    backtestPreview: { modelVersion: REPLAY_MODEL, dates: replayDates, universeSize: universe.length, generatedAt: new Date().toISOString(), trainingEligible: false, limitations: ["股票池由当前高流动股票反推，存在幸存者和样本选择偏差", "历史接口缺少当日 PE 与市值，估值维度固定为 50", "仅已有归档日期包含新闻，其余日期不会补写新闻", "结果只用于体验界面与检查流程，不与正式前向胜率混合"] },
  };
  next.audit = { ...next.audit, predictionCount: next.runs.reduce((sum, run) => sum + run.predictions.length, 0), replayPredictionCount: replayTracking.length };
  await writeFile(FORECAST_PATH, `${JSON.stringify(next)}\n`);
  const matured = replayTracking.filter((item) => item.status === "matured");
  console.log(`历史回放已生成：${replayDates[0]} 至 ${replayDates.at(-1)}，${replayRuns.length} 天，${replayTracking.length} 个候选，${matured.length} 个到期样本。`);
}

await main();
