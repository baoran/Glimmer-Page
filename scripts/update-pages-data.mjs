import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "site", "data");
const EAST_LIST = "https://82.push2.eastmoney.com/api/qt/clist/get";
const SINA_LIST = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";
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
const relevant = /A股|沪深|上证|深证|创业板|科创|北交所|股票|个股|涨停|跌停|股价|收盘|板块|上市|回购|业绩|证券|ETF|成交额|市值|公司|概念|资金|主力/;
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const clean = (value = "") => value.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

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
    catch (error) { console.warn(`同花顺板块不可用：${error.message}`); sectorRows = previousDaily.sectors ?? []; sectorSource = "缓存"; }
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
  const nextHistory = [today, ...history.filter((x) => x.date !== daily.tradeDate)].slice(0, 60);
  await Promise.all([
    writeFile(resolve(ROOT, "daily.json"), `${JSON.stringify(daily)}\n`),
    writeFile(resolve(ROOT, "stocks.json"), `${JSON.stringify({ tradeDate: daily.tradeDate, generatedAt, items: stocks })}\n`),
    writeFile(archivePath, `${JSON.stringify(nextArchive)}\n`),
    writeFile(historyPath, `${JSON.stringify(nextHistory)}\n`),
  ]);
  console.log(`微光 Pages 数据已更新：${daily.tradeDate}，${stocks.length} 只股票，${news.length} 条资讯，${daily.recommendations.length} 种战法；指数 ${marketSource}，个股 ${stockSource}，板块 ${sectorSource}，资讯 ${dataStatus.newsSource}`);
  if (dataStatus.status === "stale") {
    console.error(`::error title=行情更新失败::指数 ${marketSource}，个股 ${stockSource}；页面已保留最近缓存。`);
    process.exitCode = 2;
  } else if (dataStatus.status === "partial") {
    console.warn(`::warning title=部分行情使用缓存::板块数据源 ${sectorSource}。`);
  }
}

await main();
