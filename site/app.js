const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const signed = (value, digits = 2) => `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(digits)}`;
const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "";
const compact = (value) => { const n = Math.abs(Number(value || 0)); const s = value < 0 ? "-" : ""; return n >= 1e12 ? `${s}${(n / 1e12).toFixed(2)}万亿` : n >= 1e8 ? `${s}${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${s}${(n / 1e4).toFixed(1)}万` : `${Number(value || 0).toFixed(0)}`; };
const dateText = (value) => { const [y, m, d] = value.split("-"); return `${y}年${Number(m)}月${Number(d)}日`; };
const dateChip = (value) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short", timeZone: "Asia/Shanghai" }).format(new Date(`${value}T00:00:00+08:00`)).replaceAll("/", ".");
const timeText = (value) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value));
const safeUrl = (value) => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : "#"; } catch { return "#"; } };
const bars = (seed, rising) => { let h = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0); return Array.from({ length: 9 }, (_, i) => { h = (h * 9301 + 49297) % 233280; return Math.min(96, Math.round(25 + h / 233280 * 45 + (rising ? i : 8 - i) * 3)); }); };
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = { daily: null, archive: [], stocks: [], history: [], newsDate: "", newsSource: "全部", query: "", sort: "change", descending: true, market: "all", priceRange: "all", capRange: "all", peRange: "all", activity: "all", page: 1 };

function setView(view) {
  $$(".view").forEach((node) => node.classList.toggle("active", node.id === view));
  $$("nav [data-view]").forEach((node) => {
    const active = node.dataset.view === view;
    node.classList.toggle("active", active);
    if (active) node.setAttribute("aria-current", "page"); else node.removeAttribute("aria-current");
  });
  history.replaceState(null, "", view === "overview" ? location.pathname : `#${view}`);
  scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
}

function renderOverview() {
  const { daily } = state;
  const indexRank = [...daily.indices].sort((a, b) => b.change - a.change);
  const sectorRank = [...daily.sectors].sort((a, b) => b.change - a.change);
  const leadingIndex = indexRank[0];
  const laggingIndex = indexRank[indexRank.length - 1];
  const leadingSector = sectorRank[0];
  const laggingSector = sectorRank[sectorRank.length - 1];
  const indexAmplitude = (item) => item.previousClose ? (item.high - item.low) / item.previousClose * 100 : 0;
  const widestIndex = daily.indices.reduce((best, item) => indexAmplitude(item) > indexAmplitude(best) ? item : best, daily.indices[0]);
  const sectorFloor = Math.min(...sectorRank.map((item) => item.change));
  const sectorCeiling = Math.max(...sectorRank.map((item) => item.change));
  const sectorStrength = (value) => sectorCeiling === sectorFloor ? 50 : 12 + (value - sectorFloor) / (sectorCeiling - sectorFloor) * 88;
  const dataStatus = daily.dataStatus ?? { status: "live", marketSource: "行情", stockSource: "行情", sectorSource: "行情", newsSource: "实时" };
  document.body.classList.toggle("data-stale", dataStatus.status === "stale");
  document.body.classList.toggle("data-partial", dataStatus.status === "partial");
  $("#trade-date").textContent = `${dateText(daily.tradeDate)} · 收盘数据`;
  $("#hero-date").textContent = daily.tradeDate.replaceAll("-", " · ");
  $("#generated-at").textContent = `生成 ${timeText(daily.generatedAt)}`;
  $("#data-status").textContent = dataStatus.status === "stale" ? "行情更新异常 · 当前显示最近缓存" : dataStatus.status === "partial" ? "部分数据使用缓存" : dataStatus.marketSource === "东方财富" && dataStatus.stockSource === "东方财富" ? "行情实时更新" : "行情实时 · 备用源已接管";
  $("#data-status").title = `指数：${dataStatus.marketSource}；个股：${dataStatus.stockSource}；板块：${dataStatus.sectorSource}；资讯：${dataStatus.newsSource}`;
  $("#summary").innerHTML = `
    <article data-index="01"><span>核心指数红盘</span><b>${daily.summary.positiveIndices}<small> / ${daily.indices.length}</small></b><em>市场广度</em></article>
    <article data-index="02"><span>指数平均涨跌</span><b class="${tone(daily.summary.averageIndexChange)}">${signed(daily.summary.averageIndexChange)}<small>%</small></b><em>等权口径</em></article>
    <article data-index="03"><span>领涨指数</span><b class="text">${esc(leadingIndex.name)}</b><em class="${tone(leadingIndex.change)}">${signed(leadingIndex.change)}%</em></article>
    <article data-index="04"><span>领跌指数</span><b class="text">${esc(laggingIndex.name)}</b><em class="${tone(laggingIndex.change)}">${signed(laggingIndex.change)}%</em></article>
    <article data-index="05"><span>最强板块</span><b class="text">${esc(leadingSector.name)}</b><em class="${tone(leadingSector.change)}">${signed(leadingSector.change)}%</em></article>
    <article data-index="06"><span>最弱板块</span><b class="text">${esc(laggingSector.name)}</b><em class="${tone(laggingSector.change)}">${signed(laggingSector.change)}%</em></article>
    <article data-index="07"><span>最大指数振幅</span><b>${indexAmplitude(widestIndex).toFixed(2)}<small>%</small></b><em>${esc(widestIndex.name)}</em></article>
    <article data-index="08"><span>A股股票总数</span><b>${daily.totalStocks}<small> 只</small></b><em>沪深北市场</em></article>`;
  $("#indices").innerHTML = daily.indices.map((item) => `<article class="index"><div class="index-head"><span>${esc(item.name)}<small>${esc(item.code)}</small></span><span class="index-change ${tone(item.change)}">${signed(item.change)}%</span></div><div class="index-price"><b>${item.price.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</b><small class="${tone(item.changeAmount)}">${signed(item.changeAmount)}</small></div><div class="bars ${item.change < 0 ? "negative" : ""}" aria-hidden="true">${bars(item.code, item.change >= 0).map((height) => `<i style="height:${height}%"></i>`).join("")}</div><div class="index-foot"><span>今开<b>${item.open.toFixed(2)}</b></span><span>最高<b>${item.high.toFixed(2)}</b></span><span>最低<b>${item.low.toFixed(2)}</b></span><span>昨收<b>${item.previousClose.toFixed(2)}</b></span><span>振幅<b>${indexAmplitude(item).toFixed(2)}%</b></span><span>成交量<b>${compact(item.volume)}</b></span></div></article>`).join("");
  $("#sectors").innerHTML = sectorRank.map((item, index) => `<article class="sector ${index > 7 ? "lag" : ""}"><div class="sector-head"><b>${String(index + 1).padStart(2, "0")}</b><small>${index > 7 ? "弱势观察" : "活跃板块"}</small></div><h3>${esc(item.name)}<small class="sector-code">${esc(item.code)}</small></h3><div class="sector-value"><b>${item.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</b><span class="${tone(item.change)}">${signed(item.change)}%</span></div><div class="sector-meter" aria-hidden="true"><i style="width:${sectorStrength(item.change).toFixed(1)}%"></i></div><p>成交额 <b>${compact(item.turnover)}</b></p></article>`).join("");
}

function renderNews() {
  const days = state.archive.length ? state.archive : [{ tradeDate: state.daily.tradeDate, news: state.daily.news }];
  if (!state.newsDate) state.newsDate = days[0]?.tradeDate || state.daily.tradeDate;
  const day = days.find((item) => item.tradeDate === state.newsDate) || days[0];
  const sources = ["全部", ...new Set((day?.news || []).map((item) => item.source))];
  if (!sources.includes(state.newsSource)) state.newsSource = "全部";
  const news = (day?.news || []).filter((item) => state.newsSource === "全部" || item.source === state.newsSource);
  $("#news-dates").innerHTML = days.map((item) => `<button data-date="${esc(item.tradeDate)}" class="${item.tradeDate === state.newsDate ? "active" : ""}" aria-pressed="${item.tradeDate === state.newsDate}"><b>${dateChip(item.tradeDate)}</b><small>${item.news.length} 条</small></button>`).join("");
  $("#news-sources").innerHTML = sources.map((source) => `<button data-source="${esc(source)}" class="${source === state.newsSource ? "active" : ""}" aria-pressed="${source === state.newsSource}">${esc(source)}</button>`).join("");
  $("#news-day").textContent = `${dateText(day.tradeDate)} · ${state.newsSource === "全部" ? "全网热门" : state.newsSource}`;
  $("#news-count").textContent = `收录 ${news.length} 条`;
  $("#news-list").innerHTML = news.length ? news.map((item, index) => `<a class="news-item" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer"><span class="news-rank">${String(index + 1).padStart(2, "0")}</span><div><p class="news-meta"><b>${esc(item.category)}</b>${esc(item.source)} · ${timeText(item.publishedAt)}</p><h3>${esc(item.title)}</h3></div><span class="heat"><i style="width:${Math.max(0, Math.min(100, item.heat))}%"></i>热度 ${item.heat}</span><span class="news-link-arrow" aria-hidden="true">↗</span></a>`).join("") : `<div class="empty">当前日期或来源暂无资讯。</div>`;
}

function filteredStocks() {
  const term = state.query.trim().toLowerCase();
  const marketOf = (item) => {
    if (item.secid.startsWith("bj") || /^(4|8|92)/.test(item.code)) return "bj";
    if (/^(688|689)/.test(item.code)) return "star";
    if (/^(300|301)/.test(item.code)) return "chinext";
    if (item.secid.startsWith("sh") || /^6/.test(item.code)) return "sh-main";
    return "sz-main";
  };
  const inPriceRange = (price) => state.priceRange === "all" || (state.priceRange === "under-10" && price < 10) || (state.priceRange === "10-30" && price >= 10 && price < 30) || (state.priceRange === "30-100" && price >= 30 && price < 100) || (state.priceRange === "over-100" && price >= 100);
  const inCapRange = (cap) => state.capRange === "all" || (state.capRange === "under-5b" && cap < 5e9) || (state.capRange === "5b-20b" && cap >= 5e9 && cap < 2e10) || (state.capRange === "20b-100b" && cap >= 2e10 && cap < 1e11) || (state.capRange === "over-100b" && cap >= 1e11);
  const inPeRange = (pe) => state.peRange === "all" || (state.peRange === "loss" && pe <= 0) || (state.peRange === "0-20" && pe > 0 && pe <= 20) || (state.peRange === "20-50" && pe > 20 && pe <= 50) || (state.peRange === "over-50" && pe > 50);
  const matchesActivity = (item) => state.activity === "all" || (state.activity === "rise-3" && item.change >= 3) || (state.activity === "fall-3" && item.change <= -3) || (state.activity === "turnover-5" && item.turnoverRate >= 5) || (state.activity === "volume-ratio-1" && item.volumeRatio >= 1) || (state.activity === "amount-1b" && item.turnover >= 1e9);
  const sortValue = (item) => state.sort === "amplitude" ? (item.previousClose ? (item.high - item.low) / item.previousClose * 100 : 0) : item[state.sort];
  const direction = state.descending ? -1 : 1;
  return state.stocks
    .filter((item) => (!term || item.name.toLowerCase().includes(term) || item.code.includes(term)) && (state.market === "all" || marketOf(item) === state.market) && inPriceRange(item.price) && inCapRange(item.marketCap) && inPeRange(item.pe) && matchesActivity(item))
    .sort((a, b) => {
      if (state.sort === "name") return a.name.localeCompare(b.name, "zh-CN") * direction;
      if (state.sort === "code") return a.code.localeCompare(b.code, "zh-CN", { numeric: true }) * direction;
      return (Number(sortValue(a) || 0) - Number(sortValue(b) || 0)) * direction || a.code.localeCompare(b.code, "zh-CN", { numeric: true });
    });
}

function renderStocks() {
  const rows = filteredStocks();
  const perPage = 50;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  state.page = Math.min(state.page, pages);
  const visible = rows.slice((state.page - 1) * perPage, state.page * perPage);
  const hasFilters = Boolean(state.query) || [state.market, state.priceRange, state.capRange, state.peRange, state.activity].some((value) => value !== "all");
  $("#stock-total").textContent = hasFilters ? `筛选 ${rows.length.toLocaleString("zh-CN")} 只 · 全市场 ${state.stocks.length.toLocaleString("zh-CN")} 只` : `覆盖沪深北 A 股 ${state.stocks.length.toLocaleString("zh-CN")} 只`;
  $("#stock-filter-count").textContent = hasFilters ? `当前 ${rows.length.toLocaleString("zh-CN")} 只` : `全部 ${state.stocks.length.toLocaleString("zh-CN")} 只`;
  $("#stock-clear").disabled = !hasFilters;
  $("#stock-rows").innerHTML = visible.length ? visible.map((item, index) => `<tr><td>${String((state.page - 1) * perPage + index + 1).padStart(2, "0")}</td><td><button class="stock-name" data-secid="${esc(item.secid)}"><b>${esc(item.name)}</b><small>${esc(item.code)} · 查看历史</small></button></td><td>${item.price.toFixed(2)}</td><td class="${tone(item.change)}">${signed(item.change)}%</td><td>${item.turnoverRate.toFixed(2)}%</td><td>${item.volumeRatio ? item.volumeRatio.toFixed(2) : "—"}</td><td>${item.pe > 0 ? item.pe.toFixed(1) : "亏损"}</td><td>${compact(item.marketCap)}</td><td>${compact(item.turnover)}</td></tr>`).join("") : `<tr class="stock-empty"><td colspan="9">没有符合当前条件的股票，请调整筛选条件。</td></tr>`;
  $("#page-label").textContent = `${state.page} / ${pages}`;
  $("#prev").disabled = state.page === 1; $("#next").disabled = state.page === pages;
}

function showHistory(secid) {
  const stock = state.stocks.find((item) => item.secid === secid);
  if (!stock) return;
  const rows = state.history.flatMap((day) => { const hit = day.stocks.find((item) => item[0] === secid); return hit ? [{ date: day.date, price: hit[1], change: hit[2] }] : []; });
  const panel = $("#history-panel"); panel.hidden = false;
  panel.innerHTML = `<div class="history-top"><div><p>GITHUB DAILY HISTORY</p><h3>${esc(stock.name)} <small>${esc(stock.code)}</small></h3></div><strong>${stock.price.toFixed(2)}</strong><span class="${tone(stock.change)}">${signed(stock.change)}%</span><button id="history-close" aria-label="关闭">×</button></div><div class="history-body">${rows.length ? rows.map((row) => `<div class="history-day"><small>${esc(row.date)}</small><b>${Number(row.price).toFixed(2)}</b><span class="${tone(row.change)}">${signed(row.change)}%</span></div>`).join("") : "<p>历史快照将从首次自动更新起逐日积累。</p>"}</div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderIdeas() {
  $("#ideas-grid").innerHTML = state.daily.recommendations.length ? state.daily.recommendations.map((item, index) => `<article class="idea"><div class="idea-top"><span>STRATEGY ${String(index + 1).padStart(2, "0")}</span><span class="idea-score">匹配度<b>${item.score}</b></span></div><h3>${esc(item.name)}</h3><small>${esc(item.code)}</small><div class="idea-price"><b>${item.price.toFixed(2)}</b><span class="${tone(item.change)}">${signed(item.change)}%</span></div><div class="metrics"><span>换手<b>${item.turnoverRate.toFixed(2)}%</b></span><span>量比<b>${item.volumeRatio.toFixed(2)}</b></span><span>PE<b>${item.pe.toFixed(1)}</b></span></div><span class="strategy">${esc(item.style)}</span><ul>${item.reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul><p><b>主要风险：</b>${esc(item.risks.join("、"))}</p></article>`).join("") : `<div class="empty">正在生成多战法观察名单…</div>`;
}

async function init() {
  const [daily, archive, stocks, historyData] = await Promise.all(["daily.json", "archive.json", "stocks.json", "history.json"].map(async (file) => { const response = await fetch(`./data/${file}?v=${Date.now()}`); if (!response.ok) throw new Error(file); return response.json(); }));
  state.daily = daily; state.archive = archive; state.stocks = stocks.items; state.history = historyData;
  renderOverview(); renderNews(); renderStocks(); renderIdeas();
}

$$('[data-view]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme").innerHTML = theme === "dark" ? '<i aria-hidden="true">☀</i><span>日间</span>' : '<i aria-hidden="true">☾</i><span>夜间</span>';
  $("#theme").setAttribute("aria-label", theme === "dark" ? "切换日间模式" : "切换夜间模式");
  document.querySelector('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#09090a" : "#c9151e");
}
$("#theme").addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; applyTheme(next); localStorage.setItem("weiguang-theme", next); });
applyTheme(localStorage.getItem("weiguang-theme") === "light" ? "light" : "dark");
$("#news-dates").addEventListener("click", (event) => { const button = event.target.closest("button[data-date]"); if (button) { state.newsDate = button.dataset.date; state.newsSource = "全部"; renderNews(); } });
$("#news-sources").addEventListener("click", (event) => { const button = event.target.closest("button[data-source]"); if (button) { state.newsSource = button.dataset.source; renderNews(); } });
$("#stock-query").addEventListener("input", (event) => { state.query = event.target.value; state.page = 1; renderStocks(); });
$("#stock-sort").addEventListener("change", (event) => { state.sort = event.target.value; state.page = 1; renderStocks(); });
$("#stock-order").addEventListener("click", () => { state.descending = !state.descending; $("#stock-order").textContent = state.descending ? "从高到低 ↓" : "从低到高 ↑"; renderStocks(); });
const stockFilterMap = { "stock-market": "market", "stock-price": "priceRange", "stock-cap": "capRange", "stock-pe": "peRange", "stock-activity": "activity" };
Object.entries(stockFilterMap).forEach(([id, key]) => $(`#${id}`).addEventListener("change", (event) => { state[key] = event.target.value; state.page = 1; renderStocks(); }));
$("#stock-clear").addEventListener("click", () => {
  state.query = ""; state.market = "all"; state.priceRange = "all"; state.capRange = "all"; state.peRange = "all"; state.activity = "all"; state.page = 1;
  $("#stock-query").value = "";
  Object.keys(stockFilterMap).forEach((id) => { $(`#${id}`).value = "all"; });
  renderStocks();
});
$("#prev").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderStocks(); });
$("#next").addEventListener("click", () => { state.page += 1; renderStocks(); });
$("#stock-rows").addEventListener("click", (event) => { const button = event.target.closest("button[data-secid]"); if (button) showHistory(button.dataset.secid); });
$("#history-panel").addEventListener("click", (event) => { if (event.target.closest("#history-close")) $("#history-panel").hidden = true; });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") $("#history-panel").hidden = true; });
const initialView = ["news", "stocks", "ideas"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview"; setView(initialView);
init().catch(() => { $("#trade-date").textContent = "数据暂时未生成，请稍后刷新"; $$("#summary,#indices,#sectors,#news-list,#stock-rows,#ideas-grid").forEach((node) => node.innerHTML = `<div class="empty">首次 GitHub Actions 更新完成后将在这里显示数据。</div>`); });
