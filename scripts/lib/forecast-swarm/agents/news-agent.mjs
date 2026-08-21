import { agentResult, clamp } from "../shared.mjs";

export const NEWS_AGENT_ID = "news";
export const POSITIVE_NEWS_PATTERN = /增长|利好|增持|回购|上涨|突破|获批|中标|扭亏|超预期|创新高/;
export const NEGATIVE_NEWS_PATTERN = /下跌|风险|减持|亏损|处罚|调查|退市|暴跌|违约|终止|不及预期/;

export function runNewsAgent({ stock, news }) {
  const direct = news.filter((item) => item.title.includes(stock.name) || item.title.includes(stock.code));
  const positive = direct.filter((item) => POSITIVE_NEWS_PATTERN.test(item.title)).length;
  const negative = direct.filter((item) => NEGATIVE_NEWS_PATTERN.test(item.title)).length;
  const score = direct.length ? clamp(50 + positive * 12 - negative * 15) : 50;
  return agentResult(NEWS_AGENT_ID, score, direct.length ? Math.min(.82, .48 + direct.length * .1) : .25,
    [direct.length ? `发现 ${direct.length} 条标题级直接关联资讯` : "未发现标题级直接关联资讯", positive ? `正向关键词 ${positive} 条` : "", negative ? `风险关键词 ${negative} 条` : ""],
    [!direct.length ? "仅有市场级新闻，保持中性且不推断个股利好" : "", "标题关键词不等同于公告全文或事件影响判断"],
    (direct.length ? direct : news.slice(0, 2)).map((item) => `${item.source} · ${item.title}`));
}
