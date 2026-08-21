import { clamp, researchResult } from "../shared.mjs";

const POSITIVE = /增长|利好|增持|回购|上涨|突破|获批|中标|扭亏|超预期|创新高/;
const NEGATIVE = /下跌|风险|减持|亏损|处罚|调查|退市|暴跌|违约|终止|不及预期/;

export function runResearchNewsAgent({ stock, news }) {
  const direct = [...new Map(news.filter((item) => item.title.includes(stock.name) || item.title.includes(stock.code)).map((item) => [item.title, item])).values()];
  const positive = direct.filter((item) => POSITIVE.test(item.title)).length;
  const negative = direct.filter((item) => NEGATIVE.test(item.title)).length;
  const score = direct.length ? clamp(50 + positive * 6 - negative * 12) : 50;
  const confidence = direct.length ? Math.min(.60, .30 + direct.length * .08) : 0;
  return researchResult("news", "新闻 Agent · 研究 v2", score, confidence,
    [direct.length ? `${direct.length} 条去重后的直接标题` : "无直接标题，严格回归中性", negative ? `风险词标题 ${negative} 条` : "", positive ? `正向词标题 ${positive} 条` : ""],
    ["中文关键词表尚未经过金融语料校准", "标题情绪不是公告事实或因果影响"],
    direct.slice(0, 5).map((item) => `${item.source} · ${item.title}`),
    ["tetlock-2007", "loughran-mcdonald-2011"]);
}
