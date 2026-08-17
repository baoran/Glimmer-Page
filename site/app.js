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

const state = { daily: null, archive: [], stocks: [], history: [], newsDate: "", newsSource: "全部", query: "", sort: "change", descending: true, page: 1 };

function setView(view) {
  $$(".view").forEach((node) => node.classList.toggle("active", node.id === view));
  $$("nav [data-view]").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  history.replaceState(null, "", view === "overview" ? location.pathname : `#${view}`);
  scrollTo({ top: 0, behavior: "smooth" });
}

function renderOverview() {
  const { daily } = state;
  $("#trade-date").textContent = `${dateText(daily.tradeDate)} · 收盘数据`;
  $("#generated-at").textContent = `生成 ${timeText(daily.generatedAt)}`;
  $("#summary").innerHTML = `
    <article><span>核心指数红盘</span><b>${daily.summary.positiveIndices}<small> / ${daily.indices.length}</small></b><em>市场广度</em></article>
    <article><span>指数平均涨跌</span><b class="${tone(daily.summary.averageIndexChange)}">${signed(daily.summary.averageIndexChange)}<small>%</small></b><em>等权口径</em></article>
    <article><span>最强行业指数</span><b class="text">${esc(daily.summary.topSector)}</b><em>按收盘涨幅</em></article>
    <article><span>A股股票总数</span><b>${daily.totalStocks}<small> 只</small></b><em>沪深北市场</em></article>`;
  $("#indices").innerHTML = daily.indices.map((item) => `<article class="index"><div class="index-head"><span>${esc(item.name)}<small>${esc(item.code)}</small></span><span class="${tone(item.change)}">${signed(item.change)}%</span></div><div class="index-price"><b>${item.price.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</b><small class="${tone(item.changeAmount)}">${signed(item.changeAmount)}</small></div><div class="bars ${item.change < 0 ? "negative" : ""}">${bars(item.code, item.change >= 0).map((height) => `<i style="height:${height}%"></i>`).join("")}</div><div class="index-foot"><span>高 ${item.high.toFixed(2)}</span><span>低 ${item.low.toFixed(2)}</span><span>${compact(item.volume)}</span></div></article>`).join("");
  $("#sectors").innerHTML = daily.sectors.map((item, index) => `<article class="sector ${index > 7 ? "lag" : ""}"><div class="sector-head"><b>${String(index + 1).padStart(2, "0")}</b><small>${index > 7 ? "弱势观察" : "活跃板块"}</small></div><h3>${esc(item.name)}</h3><div class="sector-value"><b>${item.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</b><span class="${tone(item.change)}">${signed(item.change)}%</span></div><p>成交额 <b>${compact(item.turnover)}</b></p></article>`).join("");
}

function renderNews() {
  const days = state.archive.length ? state.archive : [{ tradeDate: state.daily.tradeDate, news: state.daily.news }];
  if (!state.newsDate) state.newsDate = days[0]?.tradeDate || state.daily.tradeDate;
  const day = days.find((item) => item.tradeDate === state.newsDate) || days[0];
  const sources = ["全部", ...new Set((day?.news || []).map((item) => item.source))];
  if (!sources.includes(state.newsSource)) state.newsSource = "全部";
  const news = (day?.news || []).filter((item) => state.newsSource === "全部" || item.source === state.newsSource);
  $("#news-dates").innerHTML = days.map((item) => `<button data-date="${esc(item.tradeDate)}" class="${item.tradeDate === state.newsDate ? "active" : ""}"><b>${dateChip(item.tradeDate)}</b><small>${item.news.length} 条</small></button>`).join("");
  $("#news-sources").innerHTML = sources.map((source) => `<button data-source="${esc(source)}" class="${source === state.newsSource ? "active" : ""}">${esc(source)}</button>`).join("");
  $("#news-day").textContent = `${dateText(day.tradeDate)} · ${state.newsSource === "全部" ? "全网热门" : state.newsSource}`;
  $("#news-count").textContent = `收录 ${news.length} 条`;
  $("#news-list").innerHTML = news.length ? news.map((item, index) => `<a class="news-item" href="${esc(safeUrl(item.url))}" target="_blank" rel="noreferrer"><span class="news-rank">${String(index + 1).padStart(2, "0")}</span><div><p class="news-meta"><b>${esc(item.category)}</b>${esc(item.source)} · ${timeText(item.publishedAt)}</p><h3>${esc(item.title)}</h3></div><span class="heat"><i style="width:${Math.max(0, Math.min(100, item.heat))}%"></i>热度 ${item.heat}</span><span>↗</span></a>`).join("") : `<div class="empty">当前日期或来源暂无资讯。</div>`;
}

function filteredStocks() {
  const term = state.query.trim().toLowerCase();
  return state.stocks.filter((item) => !term || item.name.toLowerCase().includes(term) || item.code.includes(term)).sort((a, b) => (Number(a[state.sort] || 0) - Number(b[state.sort] || 0)) * (state.descending ? -1 : 1));
}

function renderStocks() {
  const rows = filteredStocks();
  const perPage = 50;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  state.page = Math.min(state.page, pages);
  const visible = rows.slice((state.page - 1) * perPage, state.page * perPage);
  $("#stock-total").textContent = `覆盖沪深北 A 股 ${state.stocks.length} 只`;
  $("#stock-rows").innerHTML = visible.map((item, index) => `<tr><td>${String((state.page - 1) * perPage + index + 1).padStart(2, "0")}</td><td><button class="stock-name" data-secid="${esc(item.secid)}"><b>${esc(item.name)}</b><small>${esc(item.code)} · 查看历史</small></button></td><td>${item.price.toFixed(2)}</td><td class="${tone(item.change)}">${signed(item.change)}%</td><td>${item.turnoverRate.toFixed(2)}%</td><td>${item.volumeRatio ? item.volumeRatio.toFixed(2) : "—"}</td><td>${item.pe > 0 ? item.pe.toFixed(1) : "亏损"}</td><td>${compact(item.marketCap)}</td><td>${compact(item.turnover)}</td></tr>`).join("");
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
  $("#ideas-grid").innerHTML = state.daily.recommendations.length ? state.daily.recommendations.map((item, index) => `<article class="idea"><div class="idea-top"><span>0${index + 1}</span><b>${item.score}</b></div><h3>${esc(item.name)}</h3><small>${esc(item.code)}</small><div class="idea-price"><b>${item.price.toFixed(2)}</b><span class="${tone(item.change)}">${signed(item.change)}%</span></div><div class="metrics"><span>换手<b>${item.turnoverRate.toFixed(2)}%</b></span><span>量比<b>${item.volumeRatio.toFixed(2)}</b></span><span>PE<b>${item.pe.toFixed(1)}</b></span></div><span class="strategy">${esc(item.style)}</span><ul>${item.reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul><p><b>主要风险：</b>${esc(item.risks.join("、"))}</p></article>`).join("") : `<div class="empty">正在生成多战法观察名单…</div>`;
}

async function init() {
  const [daily, archive, stocks, historyData] = await Promise.all(["daily.json", "archive.json", "stocks.json", "history.json"].map(async (file) => { const response = await fetch(`./data/${file}?v=${Date.now()}`); if (!response.ok) throw new Error(file); return response.json(); }));
  state.daily = daily; state.archive = archive; state.stocks = stocks.items; state.history = historyData;
  renderOverview(); renderNews(); renderStocks(); renderIdeas();
}

$$('[data-view]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$("#theme").addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; localStorage.setItem("weiguang-theme", next); $("#theme").innerHTML = next === "dark" ? "☀ <span>日间</span>" : "☾ <span>夜间</span>"; });
document.documentElement.dataset.theme = localStorage.getItem("weiguang-theme") === "dark" ? "dark" : "light";
$("#news-dates").addEventListener("click", (event) => { const button = event.target.closest("button[data-date]"); if (button) { state.newsDate = button.dataset.date; state.newsSource = "全部"; renderNews(); } });
$("#news-sources").addEventListener("click", (event) => { const button = event.target.closest("button[data-source]"); if (button) { state.newsSource = button.dataset.source; renderNews(); } });
$("#stock-query").addEventListener("input", (event) => { state.query = event.target.value; state.page = 1; renderStocks(); });
$("#stock-sort").addEventListener("change", (event) => { state.sort = event.target.value; state.page = 1; renderStocks(); });
$("#stock-order").addEventListener("click", () => { state.descending = !state.descending; $("#stock-order").textContent = state.descending ? "从高到低 ↓" : "从低到高 ↑"; renderStocks(); });
$("#prev").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderStocks(); });
$("#next").addEventListener("click", () => { state.page += 1; renderStocks(); });
$("#stock-rows").addEventListener("click", (event) => { const button = event.target.closest("button[data-secid]"); if (button) showHistory(button.dataset.secid); });
$("#history-panel").addEventListener("click", (event) => { if (event.target.closest("#history-close")) $("#history-panel").hidden = true; });
const initialView = ["news", "stocks", "ideas"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview"; setView(initialView);
init().catch(() => { $("#trade-date").textContent = "数据暂时未生成，请稍后刷新"; $$("#summary,#indices,#sectors,#news-list,#stock-rows,#ideas-grid").forEach((node) => node.innerHTML = `<div class="empty">首次 GitHub Actions 更新完成后将在这里显示数据。</div>`); });
