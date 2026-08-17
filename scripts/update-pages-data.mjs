import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "site", "data");
const SINA = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center";
const HEADERS = { Accept: "application/json,text/plain,*/*", Referer: "https://finance.sina.com.cn/stock/", "User-Agent": "Mozilla/5.0" };
const INDEXES = [
  ["sh000001", "上证指数", "000001"], ["sz399001", "深证成指", "399001"],
  ["sz399006", "创业板指", "399006"], ["sh000300", "沪深300", "000300"], ["sh000688", "科创50", "000688"],
];
const relevant = /A股|沪深|上证|深证|创业板|科创|北交所|股票|个股|涨停|跌停|股价|收盘|板块|上市|回购|业绩|证券|ETF|成交额|市值|公司|概念|资金|主力/;
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const clean = (value = "") => value.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

async function json(url, headers = HEADERS) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

function mapStock(row) {
  return {
    name: String(row.name ?? "—"), code: String(row.code ?? ""), secid: String(row.symbol ?? ""),
    price: n(row.trade), change: n(row.changepercent), changeAmount: n(row.pricechange), volume: n(row.volume),
    turnover: n(row.amount), turnoverRate: n(row.turnoverratio), volumeRatio: 0, pe: n(row.per),
    high: n(row.high), low: n(row.low), open: n(row.open), previousClose: n(row.settlement),
    marketCap: n(row.mktcap) * 10000, floatMarketCap: n(row.nmc) * 10000,
  };
}

async function fetchStocks() {
  const total = n(await json(`${SINA}.getHQNodeStockCount?node=hs_a`));
  const pages = Math.ceil(total / 100);
  const rows = [];
  for (const group of chunks(Array.from({ length: pages }, (_, i) => i + 1), 8)) {
    const payloads = await Promise.all(group.map((page) => json(`${SINA}.getHQNodeData?page=${page}&num=100&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page`)));
    rows.push(...payloads.flat());
  }
  const stocks = rows.map(mapStock).filter((stock) => stock.secid);
  const ratios = new Map();
  for (const group of chunks(stocks.map((stock) => stock.secid), 450)) {
    const response = await fetch(`https://qt.gtimg.cn/q=${group.join(",")}`, { headers: { ...HEADERS, Referer: "https://gu.qq.com/" } });
    if (!response.ok) continue;
    const text = await response.text();
    for (const match of text.matchAll(/v_([a-z]{2}\d{6})="([^"]*)"/g)) ratios.set(match[1], n(match[2].split("~")[49]));
  }
  return stocks.map((stock) => ({ ...stock, volumeRatio: ratios.get(stock.secid) ?? 0 }));
}

async function fetchIndices() {
  const response = await fetch(`https://qt.gtimg.cn/q=${INDEXES.map(([symbol]) => symbol).join(",")}`, { headers: { ...HEADERS, Referer: "https://gu.qq.com/" } });
  if (!response.ok) throw new Error("指数接口不可用");
  const text = await response.text();
  let tradeDate = "";
  const indices = INDEXES.flatMap(([symbol, name, code]) => {
    const raw = text.match(new RegExp(`v_${symbol}="([^"]*)"`))?.[1];
    if (!raw) return [];
    const f = raw.split("~");
    const stamp = f[30]?.slice(0, 8);
    if (!tradeDate && /^\d{8}$/.test(stamp)) tradeDate = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
    return [{ name, code, secid: symbol, price: n(f[3]), changeAmount: n(f[31]), change: n(f[32]), volume: n(f[37]) * 10000, high: n(f[33]), low: n(f[34]), open: n(f[5]), previousClose: n(f[4]) }];
  });
  return { indices, tradeDate: tradeDate || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()) };
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
  const market = await fetchIndices();
  const [stocks, sectorsRaw, news] = await Promise.all([
    fetchStocks(),
    json(`${SINA}.getHQNodeData?page=1&num=100&sort=changepercent&asc=0&node=hs_s&symbol=&_s_r_a=page`),
    fetchNews(market.tradeDate),
  ]);
  if (stocks.length < 3000 || market.indices.length < 3) throw new Error("行情数据不完整，停止覆盖 Pages 数据");
  const sectorRows = sectorsRaw.map((row) => ({ name: String(row.name ?? "—"), code: String(row.code ?? ""), price: n(row.trade), change: n(row.changepercent), turnover: n(row.amount) }));
  const sectors = [...sectorRows.slice(0, 8), ...sectorRows.slice(-4).reverse()];
  const generatedAt = new Date().toISOString();
  const daily = {
    contentVersion: 1, tradeDate: market.tradeDate, generatedAt, indices: market.indices, sectors,
    totalStocks: stocks.length, recommendations: choose(stocks), news,
    summary: { averageIndexChange: market.indices.reduce((sum, x) => sum + x.change, 0) / market.indices.length, positiveIndices: market.indices.filter((x) => x.change > 0).length, topSector: sectors[0]?.name ?? "—" },
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
  console.log(`微光 Pages 数据已更新：${daily.tradeDate}，${stocks.length} 只股票，${news.length} 条资讯，${daily.recommendations.length} 种战法`);
}

await main();
