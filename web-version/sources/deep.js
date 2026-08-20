// web-version/sources/deep.js —— 搜索结果深度解析
// 对搜索引擎发现的相关网页（新闻/票务/资讯）二次抓取，直接从页面正文提取：
//   开票时间 / 演出时间 / 场馆 / 票价
// 平台接口被反爬时，这是真正拿到"开票信息"的可行路径（新闻官宣常写明开票时间）。
'use strict';
const { getText } = require('./http.js');

// 常用场馆名单（用于正文识别场馆）
const VENUE_RE = /(上海文化广场|上海大剧院|上音歌剧院|上海东方艺术中心|上海话剧艺术中心|天桥艺术中心|北京人艺|首都剧场|国家大剧院|北京保利剧院|深圳保利剧院|南京保利大剧院|杭州大剧院|苏州文化艺术中心|广州大剧院|深圳大剧院|珠海大剧院|青岛大剧院|武汉琴台大剧院|西安音乐厅|成都城市音乐厅|重庆大剧院|长沙梅溪湖国际文化艺术中心)/;

function stripHtml(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 从文本提取开票时间（优先"开票/开售/发售/抢票/售票"附近的日期时间）
function extractOpenTime(text) {
  if (!text) return '';
  const pats = [
    /(?:开票|开售|发售|抢票|售票|开闸)[^。！？\n]{0,12}?((?:20\d{2}年?)?\d{1,2}月\d{1,2}日\s*\d{1,2}[:：]\d{2})/,
    /((?:20\d{2}[-.年]\d{1,2}[-.月]\d{1,2}[日]?)\s*\d{1,2}[:：]\d{2})[^。！？\n]{0,10}(?:开票|开售|发售|抢票|售票)/,
    /((?:\d{1,2}月\d{1,2}日)\s*\d{1,2}[:：]\d{2})[^。！？\n]{0,10}(?:开票|开售|发售|预售|售票)/,
    /((?:20\d{2}[-.年]\d{1,2}[-.月]\d{1,2}[日]?|\d{1,2}月\d{1,2}日)\s*\d{1,2}[:：]\d{2})[^。！？\n]{0,8}(?:起|起售|全面|正式)?(?:开票|开售|发售|预售)/,
    /(?:开票|开售|发售|抢票|售票)[^。！？\n]{0,15}?((?:20\d{2}[-.年]\d{1,2}[-.月]\d{1,2}[日]?))/
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m && m[1]) {
      // 补全年份（如 "6月1日 10:00" -> "2025年6月1日 10:00"）
      let s = m[1].replace(/\./g, '-');
      if (!/20\d{2}/.test(s)) {
        const yearMatch = text.slice(0, m.index).match(/20\d{2}/g);
        s = ((yearMatch && yearMatch[yearMatch.length - 1]) || new Date().getFullYear()) + '年' + s;
      }
      return s;
    }
  }
  return '';
}

// 提取演出时间（正文中的日期+可选时间，去重取前 6）
function extractShowTimes(text) {
  if (!text) return [];
  const out = [];
  const re = /(20\d{2}[-.年]\d{1,2}[-.月]\d{1,2}[日]?)(?:[\s(（]*(\d{1,2}[:：]\d{2}))?/g;
  let m;
  const seen = {};
  while ((m = re.exec(text)) !== null) {
    let d = m[1].replace(/[-.]/g, '-').replace('年', '-').replace('月', '-').replace('日', '');
    const p = d.split('-');
    if (p.length === 3) d = p[0] + '-' + p[1].padStart(2, '0') + '-' + p[2].padStart(2, '0');
    const key = d + (m[2] ? ' ' + m[2].replace('：', ':') : '');
    if (!seen[key]) { seen[key] = true; out.push({ date: d, start: m[2] ? m[2].replace('：', ':') : '' }); }
    if (out.length >= 6) break;
  }
  return out;
}

// 提取场馆
function extractVenue(text) {
  const m = text && text.match(VENUE_RE);
  return m ? m[1] : '';
}

// 提取票价（¥99 / 99元 / 99.00）
function extractPrice(text) {
  if (!text) return '';
  const m = text.match(/[¥￥]\s?\d{2,5}(?:\.\d+)?|\d{2,5}(?:\.\d+)?\s?元|票价[：:]\s*[¥￥]?\d{2,5}/);
  return m ? m[0].trim() : '';
}

// 抓取单个页面并提取结构化信息（失败返回 null，不影响整体）
async function fetchPage(url, timeoutMs) {
  try {
    const html = await getText(url, { timeoutMs: timeoutMs || 5000, headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    const text = stripHtml(html);
    if (text.length < 200) return null; // 疑似验证页/空页
    return {
      openText: extractOpenTime(text),
      showTimes: extractShowTimes(text),
      venue: extractVenue(text),
      price: extractPrice(text)
    };
  } catch (e) {
    return null;
  }
}

// 对搜索结果做深度解析（并发抓取前 limit 条；只抓值得抓的：票务/新闻/资讯类域名）
const WORTH_FETCH = /(damai|maoyan|poliyu|piaoniu|motianlun|shcstheatre|shgtheatre|tartscenter|chncpa|bjry|sohu|qq\.com|163\.com|sina|bilibili|theater|drama|juchang|yanchu|piao|bendibao|dahepiao|shengdiao|damai)/i;

async function analyze(results, limit) {
  const list = (results || []).slice(0, limit || 4);
  const out = await Promise.all(list.map(async it => {
    if (!it || !it.url || !WORTH_FETCH.test(it.url)) {
      return Object.assign({}, it, { deep: null });
    }
    const deep = await fetchPage(it.url);
    return Object.assign({}, it, { deep });
  }));
  return out;
}

module.exports = { analyze, fetchPage, extractOpenTime, extractShowTimes, extractVenue, extractPrice, stripHtml };
