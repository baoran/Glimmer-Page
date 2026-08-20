import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "site", "data");
const EAST_LIST = "https://82.push2.eastmoney.com/api/qt/clist/get";
const SINA_LIST = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";
const SINA_SECTORS = "https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php";
const TENCENT_QUOTES = "https://qt.gtimg.cn/q=";
const THS_SECTORS = "https://q.10jqka.com.cn/thshy/index/field/199112/order/desc";
const STOCK_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const HEADERS = { Accept: "application/json,text/plain,*/*", Referer: "https://finance.sina.com.cn/stock/", "User-Agent": "Mozilla/5.0" };
const TENCENT_HEADERS = { ...HEADERS, Referer: "https://gu.qq.com/" };
const THS_HEADERS = { ...HEADERS, Referer: "https://q.10jqka.com.cn/" };
const INDEXES = [
  ["1.000001", "sh000001", "上证指数", "000001"], ["0.399001", "sz399001", "深证成指", "399001"],
  ["0.399006", "sz399006", "创业板指", "399006"], ["1.000300", "sh000300", "沪深300", "000300"], ["1.000688", "sh000688", "科创50", "000688"],
];
const FORECAST_MODEL_VERSION = "horizon-vector-v2";
const FORECAST_HORIZONS = [
  { id: "week", label: "一周", sessions: 5, weights: { momentum: .25, participation: .25, liquidity: .16, valuation: .08, stability: .12, context: .14 } },
  { id: "two-weeks", label: "两周", sessions: 10, weights: { momentum: .22, participation: .22, liquidity: .16, valuation: .12, stability: .14, context: .14 } },
  { id: "month", label: "一个月", sessions: 20, weights: { momentum: .18, participation: .18, liquidity: .17, valuation: .18, stability: .16, context: .13 } },
  { id: "quarter", label: "三个月", sessions: 60, weights: { momentum: .13, participation: .13, liquidity: .19, valuation: .24, stability: .20, context: .11 } },
  { id: "half-year", label: "六个月", sessions: 120, weights: { momentum: .10, participation: .10, liquidity: .20, valuation: .27, stability: .23, context: .10 } },
  { id: "year", label: "一年", sessions: 250, weights: { momentum: .08, participation: .08, liquidity: .22, valuation: .30, stability: .24, context: .08 } },
];
const VECTOR_DIMENSIONS = [
  { id: "momentum", label: "价格动能", description: "当日涨跌幅及过热惩罚" },
  { id: "participation", label: "交易参与", description: "量比与换手率的活跃程度" },
  { id: "liquidity", label: "流动性", description: "成交额和市值承载能力" },
  { id: "valuation", label: "估值约束", description: "正市盈率区间的相对吸引力" },
  { id: "stability", label: "波动稳定", description: "日内振幅与规模稳定性" },
  { id: "context", label: "情境修正", description: "指数广度、市场强弱与个股过热风险" },
];
const relevant = /A股|沪深|上证|深证|创业板|科创|北交所|股票|个股|涨停|跌停|股价|收盘|板块|上市|回购|业绩|证券|ETF|成交额|市值|公司|概念|资金|主力/;
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const clean = (value = "") => value.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const peak = (value, ideal, radius) => clamp(100 - Math.abs(value - ideal) / radius * 100);
const rise = (value, min, max) => clamp((value - min) / Math.max(max - min, .001) * 100);
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : 0; };

async function json(url, headers = HEADERS) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

async function text(url, headers = HEADERS, encoding = "utf-8") {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return new TextDecoder(encoding).decode(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

const settledError = (result) => result.status === "rejected" ? String(result.reason?.message ?? result.reason) : "返回数据不完整";

function eastUrl({ page = 1, size = 500, fs = STOCK_FS, sort = "f12" } = {}) {
  const query = new URLSearchParams({ pn: String(page), pz: String(size), po: "1", np: "1", fltt: "2", invt: "2", fid: sort, fs, fields: "f2,f3,f4,f5,f6,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f124" });
  return `${EAST_LIST}?${query}`;
}

function mapStock(row) {
  const code = String(row.f12 ?? "");
  const prefix = code.startsWith("4") || code.startsWith("8") ? "bj" : n(row.f13) === 1 ? "sh" : "sz";
  return {
    name: String(row.f14 ?? "—"), code, secid: `${prefix}${code}`,
    price: n(row.f2), change: n(row.f3), changeAmount: n(row.f4), volume: n(row.f5) * 100,
    turnover: n(row.f6), turnoverRate: n(row.f8), volumeRatio: n(row.f10), pe: n(row.f9),
    high: n(row.f15), low: n(row.f16), open: n(row.f17), previousClose: n(row.f18),
    marketCap: n(row.f20), floatMarketCap: n(row.f21),
  };
}

async function fetchStocks() {
  const first = await json(eastUrl());
  const total = n(first.data?.total);
  const pages = Math.ceil(total / 500);
  const rows = [...(first.data?.diff ?? [])];
  for (const group of chunks(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2), 4)) {
    const payloads = await Promise.all(group.map((page) => json(eastUrl({ page }))));
    rows.push(...payloads.flatMap((payload) => payload.data?.diff ?? []));
  }
  return rows.map(mapStock).filter((stock) => stock.code && stock.price > 0);
}

async function fetchIndices() {
  const query = new URLSearchParams({ fltt: "2", invt: "2", secids: INDEXES.map(([secid]) => secid).join(","), fields: "f2,f3,f4,f5,f12,f13,f14,f15,f16,f17,f18,f124" });
  const payload = await json(`https://push2.eastmoney.com/api/qt/ulist.np/get?${query}`);
  const rows = payload.data?.diff ?? [];
  const indices = INDEXES.flatMap(([eastId, secid, name, code]) => {
    const row = rows.find((item) => `${item.f13}.${item.f12}` === eastId);
    return row ? [{ name, code, secid, price: n(row.f2), changeAmount: n(row.f4), change: n(row.f3), volume: n(row.f5) * 100, high: n(row.f15), low: n(row.f16), open: n(row.f17), previousClose: n(row.f18) }] : [];
  });
  const stamp = Math.max(...rows.map((row) => n(row.f124)));
  const tradeDate = stamp > 0 ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(stamp * 1000)) : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  return { indices, tradeDate };
}

async function fetchSectors() {
  const payload = await json(eastUrl({ size: 100, fs: "m:90+t:2", sort: "f3" }));
  return (payload.data?.diff ?? []).map((row) => ({ name: String(row.f14 ?? "—"), code: String(row.f12 ?? ""), price: n(row.f2), change: n(row.f3), turnover: n(row.f6) }));
}

async function fetchSinaStocks(previousStocks) {
  const previous = new Map(previousStocks.map((stock) => [stock.secid, stock]));
  const rows = [];
  for (let start = 1; start <= 72; start += 8) {
    const pages = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const query = new URLSearchParams({ page: String(start + index), num: "100", sort: "symbol", asc: "1", node: "hs_a", symbol: "", _s_r_a: "page" });
      return JSON.parse(await text(`${SINA_LIST}?${query}`, HEADERS, "gbk"));
    }));
    rows.push(...pages.flat());
    if (pages.some((page) => page.length < 100)) break;
  }
  const stocks = [...new Map(rows.map((row) => [String(row.symbol ?? ""), row])).values()].map((row) => {
    const secid = String(row.symbol ?? "");
    const old = previous.get(secid) ?? {};
    const livePrice = n(row.trade);
    return {
      name: String(row.name ?? old.name ?? "—"), code: String(row.code ?? old.code ?? ""), secid,
      price: livePrice > 0 ? livePrice : n(old.price), change: livePrice > 0 ? n(row.changepercent) : n(old.change), changeAmount: livePrice > 0 ? n(row.pricechange) : n(old.changeAmount),
      volume: n(row.volume, old.volume), turnover: n(row.amount, old.turnover), turnoverRate: n(row.turnoverratio, old.turnoverRate), volumeRatio: n(old.volumeRatio), pe: n(row.per, old.pe),
      high: n(row.high) || n(old.high), low: n(row.low) || n(old.low), open: n(row.open) || n(old.open), previousClose: n(row.settlement) || n(old.previousClose),
      marketCap: n(row.mktcap) > 0 ? n(row.mktcap) * 1e4 : n(old.marketCap), floatMarketCap: n(row.nmc) > 0 ? n(row.nmc) * 1e4 : n(old.floatMarketCap),
    };
  }).filter((stock) => stock.code);
  if (stocks.length < 3000) throw new Error(`新浪行情仅返回 ${stocks.length} 只股票`);
  return stocks;
}

function parseTencentQuotes(payload) {
  return [...payload.matchAll(/v_([^=]+)="([^"]*)";/g)].flatMap((match) => {
    const fields = match[2].split("~");
    if (fields.length < 50 || !fields[2]) return [];
    const turnoverParts = String(fields[35] ?? "").split("/");
    return [{
      secid: match[1], name: fields[1], code: fields[2], price: n(fields[3]), previousClose: n(fields[4]), open: n(fields[5]),
      volume: n(fields[36] || fields[6]) * 100, turnover: n(turnoverParts[2], n(fields[37]) * 1e4), turnoverRate: n(fields[38]), pe: n(fields[39]),
      changeAmount: n(fields[31]), change: n(fields[32]), high: n(fields[33]), low: n(fields[34]), volumeRatio: n(fields[49]),
      marketCap: n(fields[44]) * 1e8, floatMarketCap: n(fields[45]) * 1e8, stamp: String(fields[30] ?? ""),
    }];
  });
}

async function fetchTencentQuoteRows(symbols) {
  const rows = [];
  const batches = chunks([...new Set(symbols.filter(Boolean))], 80);
  for (const group of chunks(batches, 6)) {
    const payloads = await Promise.all(group.map((batch) => text(`${TENCENT_QUOTES}${batch.join(",")}`, TENCENT_HEADERS, "gbk")));
    rows.push(...payloads.flatMap(parseTencentQuotes));
  }
  return rows;
}

async function enrichStocksWithTencent(stocks) {
  const rows = await fetchTencentQuoteRows(stocks.map((stock) => stock.secid));
  const quotes = new Map(rows.map((row) => [row.secid, row]));
  let updated = 0;
  const items = stocks.map((stock) => {
    const quote = quotes.get(stock.secid);
    if (!quote || quote.price <= 0) return stock;
    updated += 1;
    const { stamp, ...liveQuote } = quote;
    return { ...stock, ...liveQuote, name: quote.name || stock.name, code: quote.code || stock.code, marketCap: quote.marketCap || stock.marketCap, floatMarketCap: quote.floatMarketCap || stock.floatMarketCap, volumeRatio: quote.volumeRatio || stock.volumeRatio };
  });
  if (updated < 3000) throw new Error(`腾讯行情仅更新 ${updated} 只股票`);
  const stamp = rows.map((row) => row.stamp).filter((value) => /^\d{8}/.test(value)).sort().at(-1) ?? "";
  return { items, tradeDate: stamp ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` : "" };
}

async function fetchTencentIndices() {
  const rows = await fetchTencentQuoteRows(INDEXES.map(([, secid]) => secid));
  const quotes = new Map(rows.map((row) => [row.secid, row]));
  const indices = INDEXES.flatMap(([, secid, name, code]) => {
    const row = quotes.get(secid);
    return row && row.price > 0 ? [{ name, code, secid, price: row.price, changeAmount: row.changeAmount, change: row.change, volume: row.volume, high: row.high, low: row.low, open: row.open, previousClose: row.previousClose }] : [];
  });
  if (indices.length < 3) throw new Error(`腾讯行情仅返回 ${indices.length} 个指数`);
  const stamp = rows.map((row) => row.stamp).filter((value) => /^\d{8}/.test(value)).sort().at(-1) ?? "";
  return { indices, tradeDate: stamp ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` : "" };
}

function parseThsSectors(payload) {
  const body = payload.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].flatMap((match) => {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => clean(cell[1]));
    const code = match[1].match(/thshy\/detail\/code\/(\d+)/)?.[1] ?? "";
    return cells.length >= 9 && code ? [{ name: cells[1], code, price: n(cells[8]), change: n(cells[2]), turnover: n(cells[4]) * 1e8 }] : [];
  });
}

async function fetchThsSectors() {
  const first = await text(`${THS_SECTORS}/page/1/ajax/1/`, THS_HEADERS, "gbk");
  const pages = Math.max(1, n(first.match(/page_info">\d+\/(\d+)/)?.[1], 1));
  const payloads = [first];
  for (let page = 2; page <= pages; page += 1) payloads.push(await text(`${THS_SECTORS}/page/${page}/ajax/1/`, THS_HEADERS, "gbk"));
  const rows = payloads.flatMap(parseThsSectors);
  if (rows.length < 50) throw new Error(`同花顺仅返回 ${rows.length} 个行业板块`);
  return rows;
}

async function fetchSinaSectors() {
  const payload = await text(SINA_SECTORS, HEADERS, "gbk");
  const encoded = payload.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/)?.[1];
  if (!encoded) throw new Error("新浪行业板块响应格式异常");
  const rows = Object.values(JSON.parse(encoded)).flatMap((value) => {
    const fields = String(value).split(",");
    return fields.length >= 8 ? [{ code: fields[0], name: fields[1], price: n(fields[3]), change: n(fields[5]), turnover: n(fields[7]) }] : [];
  }).sort((a, b) => b.change - a.change);
  if (rows.length < 30) throw new Error(`新浪财经仅返回 ${rows.length} 个行业板块`);
  return rows;
}

const category = (title) => /公司|业绩|回购|增持|减持|重组|上市|公告/.test(title) ? "公司" : /政策|央行|证监|监管|国务院|交易所/.test(title) ? "政策" : /板块|行业|科技|消费|医药|金融|能源|芯片|人工智能|概念/.test(title) ? "行业" : "市场";

async function clsNews(tradeDate) {
  const payload = await json(`https://www.cls.cn/api/cache?name=telegraph&rn=60&lastTime=${Math.floor(Date.now() / 1000)}`, { ...HEADERS, Referer: "https://www.cls.cn/telegraph" });
  return (payload.data?.roll_data ?? []).flatMap((row, i) => {
    const title = clean(row.title || row.brief || row.content);
    if (!title || (!relevant.test(title) && !(row.stock_list?.length))) return [];
    const publishedAt = new Date(n(row.ctime) * 1000).toISOString();
    const heat = Math.min(99, 52 + (row.level === "A" ? 18 : 8) + (publishedAt.startsWith(tradeDate) ? 8 : 0) + Math.min(18, Math.log10(Math.max(10, n(row.reading_num))) * 4));
    return [{ id: `cls-${row.id ?? i}`, title, source: "财联社", category: category(title), url: `https://www.cls.cn/detail/${row.id}`, publishedAt, heat: Math.round(heat) }];
  });
}

async function sinaNews(tradeDate) {
  const urls = [9, 10, 3].map((tag) => `https://zhibo.sina.com.cn/api/zhibo/feed?callback=&page=1&page_size=50&zhibo_id=152&tag_id=${tag}&dire=f&dpc=1`);
  const payloads = await Promise.all(urls.map((url) => json(url, { ...HEADERS, Referer: "https://finance.sina.com.cn/7x24/" })));
  const rows = payloads.flatMap((p) => p.result?.data?.feed?.list ?? []).filter((row, i, all) => all.findIndex((item) => item.id === row.id) === i);
  return rows.flatMap((row, i) => {
    const title = clean(row.rich_text).replace(/^【([^】]+)】\s*/, "$1：");
    const tags = row.tag?.map((tag) => tag.name ?? "") ?? [];
    if (!title || (!relevant.test(title) && !tags.includes("A股") && !tags.includes("公司"))) return [];
    let url = "https://finance.sina.com.cn/7x24/";
    try { url = JSON.parse(row.ext ?? "{}").docurl || url; } catch {}
    const publishedAt = row.create_time ? new Date(`${row.create_time.replace(" ", "T")}+08:00`).toISOString() : new Date().toISOString();
    const heat = Math.min(99, 48 + (tags.includes("A股") ? 18 : 0) + (tags.includes("焦点") ? 14 : 0) + (row.create_time?.startsWith(tradeDate) ? 8 : 0));
    return [{ id: `sina-${row.id ?? i}`, title, source: "新浪财经", category: category(title), url, publishedAt, heat }];
  });
}

async function thsNews(tradeDate) {
  const payload = await json("https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=60", { ...HEADERS, Referer: "https://news.10jqka.com.cn/" });
  return (payload.data?.list ?? []).flatMap((row, i) => {
    const title = clean(row.title || row.digest);
    const tags = row.tags?.map((tag) => tag.name ?? "") ?? [];
    if (!title || (!relevant.test(title) && !tags.includes("A股"))) return [];
    const publishedAt = new Date(n(row.ctime) * 1000).toISOString();
    const heat = Math.min(96, 51 + (tags.includes("A股") ? 20 : 0) + (publishedAt.startsWith(tradeDate) ? 9 : 0) + (relevant.test(title) ? 8 : 0));
    return [{ id: `ths-${row.id ?? row.seq ?? i}`, title, source: "同花顺", category: category(title), url: row.url || "https://news.10jqka.com.cn/", publishedAt, heat }];
  });
}

async function fetchNews(tradeDate) {
  const settled = await Promise.allSettled([clsNews(tradeDate), sinaNews(tradeDate), thsNews(tradeDate)]);
  const unique = settled.flatMap((r) => r.status === "fulfilled" ? r.value : []).filter((item, i, all) => all.findIndex((x) => x.title.slice(0, 36) === item.title.slice(0, 36)) === i).sort((a, b) => b.heat - a.heat);
  const selected = [];
  for (const source of ["财联社", "新浪财经", "同花顺"]) selected.push(...unique.filter((item) => item.source === source).slice(0, 9));
  for (const item of unique) if (selected.length < 30 && !selected.some((x) => x.id === item.id)) selected.push(item);
  return selected.sort((a, b) => b.heat - a.heat).slice(0, 30);
}

const band = (v, min, max, idealMin, idealMax, weight) => v < min || v > max ? 0 : v >= idealMin && v <= idealMax ? weight : v < idealMin ? weight * (v - min) / Math.max(idealMin - min, .001) : weight * (max - v) / Math.max(max - idealMax, .001);
function choose(stocks) {
  const eligible = stocks.filter((s) => !/^(N|C|\*?ST|退)/i.test(s.name) && s.price >= 3 && s.change > .3 && s.change < 9.6 && s.turnoverRate > .5 && s.turnoverRate < 22 && s.volumeRatio > 1 && s.volumeRatio < 6 && s.pe > 0 && s.pe < 120 && s.marketCap > 3e9 && s.turnover > 2e8);
  const core = (s) => band(s.change,.3,9.6,1.5,6.5,24)+band(s.volumeRatio,1,6,1.25,3,20)+band(s.turnoverRate,.5,22,2,12,16)+band(s.pe,1,120,8,45,14)+band(Math.log10(s.turnover),8.3,11.2,9,10.5,16)+band(Math.log10(s.marketCap),9.4,13,10,12,10);
  const strategies = [
    ["放量突破", (s) => s.volumeRatio >= 1.5 && s.change >= 2 && s.change <= 9, (s) => s.volumeRatio*4+s.change, (s) => `量比 ${s.volumeRatio.toFixed(2)}，价格与量能同步向上`],
    ["低估值强势", (s) => s.pe <= 30 && s.change >= .5 && s.change <= 6, (s) => 30-s.pe+s.change*2, (s) => `市盈率 ${s.pe.toFixed(1)}，兼顾估值与当日强度`],
    ["趋势延续", (s) => s.change >= 1 && s.change <= 4.5 && s.volumeRatio >= 1.05 && s.volumeRatio <= 2.8 && s.marketCap >= 8e9, (s) => s.change*3+Math.log10(s.marketCap), (s) => `涨幅 ${s.change.toFixed(2)}%，处于温和趋势区间`],
    ["高换手博弈", (s) => s.turnoverRate >= 6 && s.turnoverRate <= 18 && s.change >= 1 && s.change <= 8, (s) => s.turnoverRate+s.volumeRatio*2, (s) => `换手率 ${s.turnoverRate.toFixed(2)}%，筹码交换充分`],
    ["资金关注", (s) => s.turnover >= 1.5e9 && s.change >= .5 && s.change <= 7 && s.marketCap >= 1e10, (s) => Math.log10(s.turnover)*4+s.change, (s) => `成交额 ${(s.turnover/1e8).toFixed(1)} 亿，资金参与度较高`],
    ["中小盘弹性", (s) => s.marketCap >= 3e9 && s.marketCap <= 3e10 && s.change >= 1 && s.change <= 7 && s.volumeRatio >= 1.2, (s) => s.change*2+s.volumeRatio*3-Math.log10(s.marketCap), (s) => `总市值 ${(s.marketCap/1e8).toFixed(0)} 亿，具备相对弹性`],
  ];
  const used = new Set();
  return strategies.flatMap(([style, test, bonus, rationale]) => {
    const stock = eligible.filter((s) => !used.has(s.secid) && test(s)).sort((a,b) => core(b)+bonus(b)-core(a)-bonus(a))[0];
    if (!stock) return [];
    used.add(stock.secid);
    return [{ ...stock, style, score: Math.min(99, Math.max(65, Math.round(core(stock)+bonus(stock)*.35))), reasons: [rationale(stock), `量比 ${stock.volumeRatio.toFixed(2)}、换手率 ${stock.turnoverRate.toFixed(2)}%`, `成交额 ${(stock.turnover/1e8).toFixed(1)} 亿`], risks: [stock.change > 6.5 ? "短线涨幅偏高" : "次日动能可能衰减"] }];
  });
}

function marketContextScore(market) {
  const changes = market.indices.map((item) => item.change);
  const breadth = changes.filter((value) => value > 0).length / Math.max(1, changes.length);
  return clamp(50 + average(changes) * 8 + (breadth - .5) * 24, 20, 82);
}

function stockVector(stock, marketContext) {
  const amplitude = stock.previousClose > 0 ? (stock.high - stock.low) / stock.previousClose * 100 : 10;
  const closePosition = stock.high > stock.low ? (stock.price - stock.low) / (stock.high - stock.low) : .5;
  const logTurnover = Math.log10(Math.max(1, stock.turnover));
  const logMarketCap = Math.log10(Math.max(1, stock.marketCap));
  const momentum = peak(stock.change, 3.2, 6.2) * .72 + clamp(closePosition * 100) * .28;
  const participation = peak(stock.volumeRatio, 1.8, 4.2) * .55 + peak(stock.turnoverRate, 5.5, 17) * .45;
  const liquidity = peak(logTurnover, 9.65, 2.2) * .62 + peak(logMarketCap, 11.15, 2.6) * .38;
  const valuation = stock.pe > 0 ? peak(stock.pe, 22, 98) : 0;
  const stability = peak(amplitude, 2.5, 10) * .66 + rise(logMarketCap, 9.4, 12.8) * .34;
  const overheatPenalty = Math.max(0, stock.change - 6) * 4 + Math.max(0, stock.volumeRatio - 3.5) * 3;
  return {
    vector: {
      momentum: clamp(momentum), participation: clamp(participation), liquidity: clamp(liquidity),
      valuation: clamp(valuation), stability: clamp(stability), context: clamp(marketContext - overheatPenalty),
    },
    amplitude,
  };
}

function forecastReasons(stock, vector, weights) {
  const descriptions = {
    momentum: `价格动能 ${Math.round(vector.momentum)}：当日涨幅 ${stock.change.toFixed(2)}%`,
    participation: `交易参与 ${Math.round(vector.participation)}：量比 ${stock.volumeRatio.toFixed(2)}、换手 ${stock.turnoverRate.toFixed(2)}%`,
    liquidity: `流动性 ${Math.round(vector.liquidity)}：成交额 ${(stock.turnover / 1e8).toFixed(1)} 亿`,
    valuation: `估值约束 ${Math.round(vector.valuation)}：市盈率 ${stock.pe.toFixed(1)} 倍`,
    stability: `波动稳定 ${Math.round(vector.stability)}：总市值 ${(stock.marketCap / 1e8).toFixed(0)} 亿`,
    context: `情境修正 ${Math.round(vector.context)}：结合当日指数广度与过热惩罚`,
  };
  return Object.keys(weights).sort((a, b) => vector[b] * weights[b] - vector[a] * weights[a]).slice(0, 3).map((key) => descriptions[key]);
}

function buildExperienceProfiles(previous, tradeDate) {
  const predictionById = new Map((previous.runs ?? []).flatMap((run) => run.predictions.map((item) => [item.id, item])));
  const matured = (previous.tracking ?? []).filter((item) => item.status === "matured" && item.exitCloseDate < tradeDate)
    .flatMap((item) => { const prediction = predictionById.get(item.predictionId); return prediction?.modelVersion === FORECAST_MODEL_VERSION ? [{ prediction, tracking: item }] : []; });
  return Object.fromEntries(FORECAST_HORIZONS.map((horizon) => {
    const samples = matured.filter((item) => item.prediction.horizonId === horizon.id);
    const overallWinRate = samples.length ? samples.filter((item) => item.tracking.outcome === "win").length / samples.length : 0;
    const adjustments = Object.fromEntries(VECTOR_DIMENSIONS.map(({ id }) => {
      const high = samples.filter((item) => item.prediction.vector[id] >= 70);
      const highWinRate = high.length ? high.filter((item) => item.tracking.outcome === "win").length / high.length : overallWinRate;
      const adjustment = samples.length >= 20 && high.length >= 5 ? clamp((highWinRate - overallWinRate) * .08, -.03, .03) : 0;
      return [id, adjustment];
    }));
    const rawWeights = Object.fromEntries(Object.entries(horizon.weights).map(([id, weight]) => [id, weight * (1 + adjustments[id])]));
    const totalWeight = Object.values(rawWeights).reduce((sum, value) => sum + value, 0);
    const effectiveWeights = Object.fromEntries(Object.entries(rawWeights).map(([id, weight]) => [id, weight / totalWeight]));
    return [horizon.id, {
      sampleSize: samples.length, overallWinRate, adjustments, effectiveWeights,
      status: samples.length >= 20 ? "calibrated" : "warming-up",
      note: samples.length >= 20 ? `使用 ${samples.length} 个已到期历史样本做上限 3% 的温和校准。` : `仅有 ${samples.length} 个已到期样本，未达到 20 个门槛，沿用基础权重。`,
    }];
  }));
}

function newsEvidence(stock, news) {
  const direct = news.filter((item) => item.title.includes(stock.name) || item.title.includes(stock.code)).slice(0, 3);
  const market = news.slice(0, 3);
  return {
    direct: direct.map((item) => ({ title: item.title, source: item.source, category: item.category })),
    market: market.map((item) => ({ title: item.title, source: item.source, category: item.category })),
    summary: direct.length
      ? `当日标题级检索发现 ${direct.length} 条直接关联资讯，作为辅助证据而非单独买入理由。`
      : "当日聚合资讯未发现标题级直接关联；只采用市场级新闻作为情境，不推断个股利好。",
  };
}

function selectionAnalysis(stock, vector, weights, horizon, news, experience) {
  const contributions = VECTOR_DIMENSIONS.map(({ id, label }) => ({
    id, label, score: Math.round(vector[id]), weight: weights[id], contribution: vector[id] * weights[id],
  })).sort((a, b) => b.contribution - a.contribution);
  const strongest = contributions.slice(0, 2).map((item) => item.label).join("与");
  return {
    thesis: `${horizon.label}周期更看重${horizon.sessions <= 10 ? "价格动能和交易参与" : horizon.sessions >= 120 ? "估值、流动性和稳定性" : "动能与基本约束的平衡"}；该股的主要贡献来自${strongest}。`,
    contributions: contributions.map((item) => ({ ...item, weight: Number(item.weight.toFixed(4)), contribution: Number(item.contribution.toFixed(2)) })),
    news: newsEvidence(stock, news), experience: { sampleSize: experience.sampleSize, status: experience.status, note: experience.note },
  };
}

function forecastRisks(stock, amplitude) {
  const risks = [];
  if (stock.change > 6) risks.push("当日涨幅偏高，存在回撤风险");
  if (stock.volumeRatio > 3.5) risks.push("量能短时放大，持续性待验证");
  if (stock.pe > 60) risks.push("估值偏高，对预期变化敏感");
  if (amplitude > 7) risks.push("日内振幅较大");
  if (stock.marketCap < 1e10) risks.push("中小市值波动与流动性风险较高");
  if (!risks.length) risks.push("单日截面不能替代连续行情与基本面研究");
  return risks.slice(0, 2);
}

function chooseHorizonStocks(stocks, market, horizon, news, experience) {
  const eligible = stocks.filter((stock) => !/^(N|C|\*?ST|退)/i.test(stock.name)
    && stock.price >= 3 && stock.change > -2 && stock.change < 9.6 && stock.turnoverRate > .3 && stock.turnoverRate < 22
    && stock.volumeRatio >= .6 && stock.volumeRatio < 6 && stock.pe > 0 && stock.pe < 120 && stock.marketCap > 3e9 && stock.turnover > 8e7);
  const context = marketContextScore(market);
  const weights = experience.effectiveWeights;
  return eligible.map((stock) => {
    const { vector, amplitude } = stockVector(stock, context);
    const weightedScore = Object.entries(weights).reduce((sum, [key, weight]) => sum + vector[key] * weight, 0);
    const horizonPenalty = horizon.sessions <= 10 ? Math.max(0, 1 - stock.change) * 2.5 : Math.max(0, stock.change - 7) * .9;
    return { stock, vector, amplitude, score: clamp(weightedScore - horizonPenalty, 0, 99) };
  }).sort((a, b) => b.score - a.score || b.stock.turnover - a.stock.turnover).slice(0, 5).map((candidate, index) => {
    const { stock, vector, amplitude, score } = candidate;
    return {
      id: `${market.tradeDate}:${FORECAST_MODEL_VERSION}:${horizon.id}:${stock.secid}`, horizonId: horizon.id, rank: index + 1,
      secid: stock.secid, code: stock.code, name: stock.name, score: Math.round(score), entryPrice: stock.price,
      entryCloseDate: market.tradeDate, entryBasis: "当日收盘观察价", modelVersion: FORECAST_MODEL_VERSION,
      vector: Object.fromEntries(Object.entries(vector).map(([key, value]) => [key, Math.round(value)])),
      featureSnapshot: {
        change: stock.change, turnoverRate: stock.turnoverRate, volumeRatio: stock.volumeRatio, pe: stock.pe,
        marketCap: stock.marketCap, turnover: stock.turnover, amplitude: Number(amplitude.toFixed(4)),
      },
      effectiveWeights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number(value.toFixed(4))])),
      reasons: forecastReasons(stock, vector, weights), risks: forecastRisks(stock, amplitude),
      analysis: selectionAnalysis(stock, vector, weights, horizon, news, experience),
    };
  });
}

function buildDailyContextReview(market, sectors, news) {
  const sortedIndices = [...market.indices].sort((a, b) => b.change - a.change);
  const sortedSectors = [...sectors].sort((a, b) => b.change - a.change);
  const positivePattern = /增长|利好|增持|回购|上涨|突破|获批|中标|扭亏|超预期|创新高/;
  const negativePattern = /下跌|风险|减持|亏损|处罚|调查|退市|暴跌|违约|终止|不及预期/;
  const positiveNews = news.filter((item) => positivePattern.test(item.title)).length;
  const negativeNews = news.filter((item) => negativePattern.test(item.title)).length;
  const categories = [...new Set(news.map((item) => item.category))].map((categoryName) => ({ category: categoryName, count: news.filter((item) => item.category === categoryName).length })).sort((a, b) => b.count - a.count);
  return {
    market: {
      averageIndexChange: average(market.indices.map((item) => item.change)),
      positiveIndices: market.indices.filter((item) => item.change > 0).length,
      totalIndices: market.indices.length,
      leadingIndex: sortedIndices[0] ? { name: sortedIndices[0].name, change: sortedIndices[0].change } : null,
      laggingIndex: sortedIndices.at(-1) ? { name: sortedIndices.at(-1).name, change: sortedIndices.at(-1).change } : null,
      leadingSectors: sortedSectors.slice(0, 3).map((item) => ({ name: item.name, change: item.change })),
    },
    news: {
      count: news.length, positiveSignals: positiveNews, negativeSignals: negativeNews, categories,
      headlines: news.slice(0, 5).map((item) => ({ title: item.title, source: item.source, category: item.category, heat: item.heat })),
      note: "新闻情绪仅按标题关键词做辅助归类，不等同于事件利好或利空判断。",
    },
  };
}

function buildForecastData(previous, stocks, market, sectors, news, generatedAt, dataStatus, canCreateRun) {
  const old = previous?.contentVersion === 1 ? previous : {};
  const tradingDates = [...new Set([...(old.tradingDates ?? []), ...(canCreateRun ? [market.tradeDate] : [])])].sort().slice(-420);
  let runs = Array.isArray(old.runs) ? old.runs : [];
  const hasToday = runs.some((run) => run.asOfTradeDate === market.tradeDate && run.modelVersion === FORECAST_MODEL_VERSION);
  const previousTodayReport = (old.reports ?? []).find((item) => item.tradeDate === market.tradeDate);
  let newPredictionCount = previousTodayReport?.newPredictionCount ?? 0;
  const experienceProfiles = buildExperienceProfiles(old, market.tradeDate);
  if (canCreateRun && !hasToday) {
    const predictions = FORECAST_HORIZONS.flatMap((horizon) => chooseHorizonStocks(stocks, market, horizon, news, experienceProfiles[horizon.id]));
    newPredictionCount = predictions.length;
    runs = [{ runId: `${market.tradeDate}:${FORECAST_MODEL_VERSION}`, asOfTradeDate: market.tradeDate, generatedAt, modelVersion: FORECAST_MODEL_VERSION, sourceStatus: dataStatus.status, experienceProfiles, predictions }, ...runs];
  }
  runs = runs.slice(0, 420);
  const previousTracking = new Map((old.tracking ?? []).map((item) => [item.predictionId, item]));
  const priceBySecid = new Map(stocks.map((stock) => [stock.secid, stock.price]));
  const horizonById = new Map(FORECAST_HORIZONS.map((item) => [item.id, item]));
  const dateIndex = new Map(tradingDates.map((date, index) => [date, index]));
  const tracking = runs.flatMap((run) => run.predictions.map((prediction) => {
    const prior = previousTracking.get(prediction.id);
    if (prior?.status === "matured") return prior;
    const currentPrice = priceBySecid.get(prediction.secid);
    const elapsedSessions = Math.max(0, (dateIndex.get(market.tradeDate) ?? 0) - (dateIndex.get(prediction.entryCloseDate) ?? 0));
    if (!currentPrice) return { predictionId: prediction.id, horizonId: prediction.horizonId, status: "missing-price", elapsedSessions, lastDate: market.tradeDate };
    const returnPct = (currentPrice / prediction.entryPrice - 1) * 100;
    const horizon = horizonById.get(prediction.horizonId);
    if (elapsedSessions >= horizon.sessions) return {
      predictionId: prediction.id, horizonId: prediction.horizonId, status: "matured", elapsedSessions,
      lastDate: market.tradeDate, lastPrice: currentPrice, returnPct, exitCloseDate: market.tradeDate,
      exitPrice: currentPrice, outcome: returnPct > 0 ? "win" : returnPct < 0 ? "loss" : "flat",
    };
    return { predictionId: prediction.id, horizonId: prediction.horizonId, status: "active", elapsedSessions, lastDate: market.tradeDate, lastPrice: currentPrice, returnPct };
  }));
  const predictionById = new Map(runs.flatMap((run) => run.predictions.map((item) => [item.id, item])));
  const modelTracking = tracking.filter((item) => predictionById.get(item.predictionId)?.modelVersion === FORECAST_MODEL_VERSION);
  const byHorizon = FORECAST_HORIZONS.map((horizon) => {
    const items = modelTracking.filter((item) => item.horizonId === horizon.id);
    const active = items.filter((item) => item.status === "active");
    const matured = items.filter((item) => item.status === "matured");
    const maturedToday = matured.filter((item) => item.exitCloseDate === market.tradeDate);
    const currentRun = runs.find((run) => run.asOfTradeDate === market.tradeDate && run.modelVersion === FORECAST_MODEL_VERSION);
    const todayPredictions = (currentRun?.predictions ?? []).filter((item) => item.horizonId === horizon.id);
    return {
      horizonId: horizon.id, active: active.length, positiveActive: active.filter((item) => item.returnPct > 0).length,
      averageFloatingReturnPct: average(active.map((item) => item.returnPct)), maturedToday: maturedToday.length,
      matured: matured.length, wins: matured.filter((item) => item.outcome === "win").length,
      winRate: matured.length ? matured.filter((item) => item.outcome === "win").length / matured.length : 0,
      averageRealizedReturnPct: average(matured.map((item) => item.returnPct)),
      vectorAverages: Object.fromEntries(VECTOR_DIMENSIONS.map(({ id }) => [id, average(todayPredictions.map((item) => item.vector[id]))])),
    };
  });
  const active = modelTracking.filter((item) => item.status === "active");
  const matured = modelTracking.filter((item) => item.status === "matured");
  const maturedToday = matured.filter((item) => item.exitCloseDate === market.tradeDate);
  const bestActive = [...byHorizon].filter((item) => item.active).sort((a, b) => b.averageFloatingReturnPct - a.averageFloatingReturnPct)[0];
  const narrative = [
    newPredictionCount ? `本交易日按六个持有周期记录 ${newPredictionCount} 个前向观察样本，每个周期 5 只。` : "本交易日未创建新预测，继续追踪既有样本。",
    active.length ? `当前 ${active.length} 个样本处于观察期，${active.filter((item) => item.returnPct > 0).length} 个暂为正收益，平均浮动 ${average(active.map((item) => item.returnPct)).toFixed(2)}%。` : "当前暂无处于观察期的历史样本。",
    maturedToday.length ? `今日到期 ${maturedToday.length} 个，正收益 ${maturedToday.filter((item) => item.outcome === "win").length} 个，平均收益 ${average(maturedToday.map((item) => item.returnPct)).toFixed(2)}%。` : "今日暂无到期样本；真实胜率需等待对应交易日周期结束后形成。",
    bestActive ? `当前浮动表现相对较好的周期为${horizonById.get(bestActive.horizonId).label}，平均 ${bestActive.averageFloatingReturnPct.toFixed(2)}%；该数值尚未到期，不代表最终结果。` : "模型仍处于前向积累阶段，不使用未来数据回填历史结论。",
  ];
  if (!canCreateRun) narrative.push("本次核心行情使用缓存，已暂停新增样本，避免污染验证日志。");
  const contextReview = buildDailyContextReview(market, sectors, news);
  const calibratedHorizons = Object.values(experienceProfiles).filter((item) => item.status === "calibrated").length;
  const reflection = {
    market: `指数平均 ${contextReview.market.averageIndexChange.toFixed(2)}%，${contextReview.market.positiveIndices}/${contextReview.market.totalIndices} 个核心指数上涨；领涨为${contextReview.market.leadingIndex?.name ?? "—"}。`,
    news: `复核 ${contextReview.news.count} 条资讯，标题关键词中正向 ${contextReview.news.positiveSignals} 条、风险类 ${contextReview.news.negativeSignals} 条；仅作为市场情境。`,
    model: maturedToday.length ? `今日新增 ${maturedToday.length} 个到期样本，结果已进入经验池，但从下一交易日才允许参与校准。` : "今日没有新增到期样本，模型不因在途浮盈或浮亏调整权重。",
    next: calibratedHorizons ? `${calibratedHorizons} 个周期达到经验门槛，下一交易日继续采用有界校准权重。` : "各周期尚未积累至少 20 个到期样本，下一交易日继续使用基础权重，避免小样本过拟合。",
  };
  const report = {
    tradeDate: market.tradeDate, generatedAt, sourceStatus: dataStatus.status, newPredictionCount,
    activeCount: active.length, maturedTodayCount: maturedToday.length,
    missingPriceCount: tracking.filter((item) => item.status === "missing-price").length,
    summary: {
      positiveActiveRate: active.length ? active.filter((item) => item.returnPct > 0).length / active.length : 0,
      averageFloatingReturnPct: average(active.map((item) => item.returnPct)),
      cumulativeMatured: matured.length, cumulativeWinRate: matured.length ? matured.filter((item) => item.outcome === "win").length / matured.length : 0,
      cumulativeAverageReturnPct: average(matured.map((item) => item.returnPct)), cumulativeMedianReturnPct: median(matured.map((item) => item.returnPct)),
    },
    byHorizon, narrative, contextReview, reflection,
    experience: Object.fromEntries(FORECAST_HORIZONS.map((horizon) => [horizon.id, {
      sampleSize: experienceProfiles[horizon.id].sampleSize, status: experienceProfiles[horizon.id].status,
      adjustments: experienceProfiles[horizon.id].adjustments, note: experienceProfiles[horizon.id].note,
    }])),
  };
  const reports = [report, ...(old.reports ?? []).filter((item) => item.tradeDate !== market.tradeDate)].slice(0, 420);
  return {
    contentVersion: 1, generatedAt, latestTradeDate: market.tradeDate,
    model: {
      version: FORECAST_MODEL_VERSION, label: "多周期向量评分 v2", dimensions: VECTOR_DIMENSIONS,
      principle: "只使用预测生成时可见的收盘截面；到期样本从下一交易日起做有界经验校准；日志产生后不回改。",
      limitation: "这是规则排序和前向验证，不是上涨保证；新闻仅做标题级情境分析，暂不包含连续历史、财报质量、公告全文和可成交价格。",
    },
    horizons: FORECAST_HORIZONS.map(({ weights, ...item }) => ({ ...item, weights })), tradingDates, runs, tracking, reports,
    audit: { predictionCount: [...predictionById].length, retentionTradingDays: 420, entryBasis: "预测日收盘观察价", outcomeRule: "第 N 个后续有效收盘价相对观察价大于 0" },
  };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function main() {
  await mkdir(ROOT, { recursive: true });
  const previousDaily = await readJson(resolve(ROOT, "daily.json"), {});
  const previousStocks = await readJson(resolve(ROOT, "stocks.json"), {});
  const [marketResult, stocksResult, sectorsResult] = await Promise.allSettled([fetchIndices(), fetchStocks(), fetchSectors()]);
  let marketSource = "东方财富";
  let stockSource = "东方财富";
  let sectorSource = "东方财富";
  let market = marketResult.status === "fulfilled" && marketResult.value.indices.length >= 3 ? marketResult.value : null;
  let stocks = stocksResult.status === "fulfilled" && stocksResult.value.length >= 3000 ? stocksResult.value : null;
  let sectorRows = sectorsResult.status === "fulfilled" && sectorsResult.value.length >= 12 ? sectorsResult.value : null;

  if (!market) {
    console.warn(`东方财富指数不可用：${settledError(marketResult)}；切换腾讯行情。`);
    try { market = await fetchTencentIndices(); marketSource = "腾讯行情"; }
    catch (error) { console.warn(`腾讯指数不可用：${error.message}`); market = { tradeDate: previousDaily.tradeDate, indices: previousDaily.indices ?? [] }; marketSource = "缓存"; }
  }
  if (!stocks) {
    console.warn(`东方财富个股不可用：${settledError(stocksResult)}；切换新浪财经。`);
    try {
      stocks = await fetchSinaStocks(previousStocks.items ?? []);
      stockSource = "新浪财经";
      try {
        const enriched = await enrichStocksWithTencent(stocks);
        stocks = enriched.items;
        stockSource = "新浪财经 + 腾讯行情";
        if (!market.tradeDate && enriched.tradeDate) market.tradeDate = enriched.tradeDate;
      } catch (error) { console.warn(`腾讯个股增强不可用：${error.message}`); }
    } catch (error) { console.warn(`新浪个股不可用：${error.message}`); stocks = previousStocks.items ?? []; stockSource = "缓存"; }
  }
  if (!sectorRows) {
    console.warn(`东方财富板块不可用：${settledError(sectorsResult)}；切换同花顺行业。`);
    try { sectorRows = await fetchThsSectors(); sectorSource = "同花顺"; }
    catch (error) {
      console.warn(`同花顺板块不可用：${error.message}；切换新浪行业。`);
      try { sectorRows = await fetchSinaSectors(); sectorSource = "新浪财经"; }
      catch (backupError) { console.warn(`新浪板块不可用：${backupError.message}`); sectorRows = previousDaily.sectors ?? []; sectorSource = "缓存"; }
    }
  }
  if (stocks.length < 3000 || market.indices.length < 3) throw new Error("行情数据不完整，停止覆盖 Pages 数据");
  const sectors = sectorSource !== "缓存" ? [...sectorRows.slice(0, 8), ...sectorRows.slice(-4).reverse()] : sectorRows;
  const newsResult = await Promise.allSettled([fetchNews(market.tradeDate)]);
  const newsLive = newsResult[0].status === "fulfilled" && newsResult[0].value.length >= 5;
  const news = newsLive ? newsResult[0].value : (previousDaily.news ?? []);
  const generatedAt = new Date().toISOString();
  const essentialLive = marketSource !== "缓存" && stockSource !== "缓存";
  const dataStatus = {
    status: !essentialLive ? "stale" : sectorSource === "缓存" ? "partial" : "live",
    marketSource, stockSource, sectorSource, newsSource: newsLive ? "实时" : "缓存",
  };
  const daily = {
    contentVersion: 1, tradeDate: market.tradeDate, generatedAt, indices: market.indices, sectors,
    totalStocks: stocks.length, recommendations: choose(stocks), news,
    summary: { averageIndexChange: market.indices.reduce((sum, x) => sum + x.change, 0) / market.indices.length, positiveIndices: market.indices.filter((x) => x.change > 0).length, topSector: sectors[0]?.name ?? "—" },
    dataStatus,
  };
  const archivePath = resolve(ROOT, "archive.json");
  const archive = await readJson(archivePath, []);
  const nextArchive = [{ tradeDate: daily.tradeDate, generatedAt, news }, ...archive.filter((x) => x.tradeDate !== daily.tradeDate)].slice(0, 30);
  const historyPath = resolve(ROOT, "history.json");
  const history = await readJson(historyPath, []);
  const today = { date: daily.tradeDate, stocks: stocks.map((s) => [s.secid, s.price, s.change]) };
  const nextHistory = [today, ...history.filter((x) => x.date !== daily.tradeDate)].slice(0, 260);
  const forecastsPath = resolve(ROOT, "forecasts.json");
  const previousForecasts = await readJson(forecastsPath, {});
  const forecasts = buildForecastData(previousForecasts, stocks, market, sectors, news, generatedAt, dataStatus, essentialLive);
  await Promise.all([
    writeFile(resolve(ROOT, "daily.json"), `${JSON.stringify(daily)}\n`),
    writeFile(resolve(ROOT, "stocks.json"), `${JSON.stringify({ tradeDate: daily.tradeDate, generatedAt, items: stocks })}\n`),
    writeFile(archivePath, `${JSON.stringify(nextArchive)}\n`),
    writeFile(historyPath, `${JSON.stringify(nextHistory)}\n`),
    writeFile(forecastsPath, `${JSON.stringify(forecasts)}\n`),
  ]);
  console.log(`微光 Pages 数据已更新：${daily.tradeDate}，${stocks.length} 只股票，${news.length} 条资讯，${daily.recommendations.length} 种战法，${forecasts.runs[0]?.predictions.length ?? 0} 个周期预测；指数 ${marketSource}，个股 ${stockSource}，板块 ${sectorSource}，资讯 ${dataStatus.newsSource}`);
  if (dataStatus.status === "stale") {
    console.error(`::error title=行情更新失败::指数 ${marketSource}，个股 ${stockSource}；页面已保留最近缓存。`);
    process.exitCode = 2;
  } else if (dataStatus.status === "partial") {
    console.warn(`::warning title=部分行情使用缓存::板块数据源 ${sectorSource}。`);
  }
}

await main();
