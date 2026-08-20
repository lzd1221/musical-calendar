// cloudfunctions/fetchShowInfo/sources/damai.js —— 大麦网适配器
// 搜索接口：https://search.damai.cn/searchajax.html?keyword=xxx （公开接口，无需登录）
// 开票时间：抓详情页 HTML 中的「开售时间/开票时间」（限流：每次搜索仅抓前 3 条）
const { getJSON, getText } = require('./http.js');
const { parseShowTime, normTitle, fuzzyMatch } = require('./normalize.js');
const cfg = require('./config.js');

// 大麦城市码（未收录城市留空 = 全国搜索，前端再过滤）
const CITY_CODE = {
  '上海': 852, '北京': 11, '广州': 765, '深圳': 764, '杭州': 840, '南京': 839,
  '苏州': 862, '成都': 762, '重庆': 854, '武汉': 790, '西安': 1068, '长沙': 789,
  '天津': 12, '青岛': 1041
};

const name = '大麦';
const enabled = cfg.ENABLE_DAMAI; // 集中配置开关（sources/config.js）

function headers() {
  const h = { Referer: 'https://www.damai.cn/' };
  if (cfg.COOKIE) h.Cookie = cfg.COOKIE;
  return h;
}

async function search({ name: keyword, year, city }) {
  const cty = CITY_CODE[city] || '';
  const url = 'https://search.damai.cn/searchajax.html?keyword=' + encodeURIComponent(keyword) +
    '&cty=' + cty + '&ctl=1&currPage=1&pageSize=30';
  let data;
  try {
    data = await getJSON(url, { headers: headers() });
  } catch (e) {
    console.warn('[damai] search fail:', e.message);
    return [];
  }
  const list = (((data.data || {}).resultData || {}).listData) || [];
  const out = [];
  const candidates = [];
  for (const it of list) {
    const title = (it.name || '').trim();
    if (!title) continue;
    const itemCity = it.cityName || '';
    // 关键词双向匹配，避免搜到无关演出
    if (!fuzzyMatch(title, keyword)) continue;
    // 城市过滤（标题强匹配时放宽城市限制）
    if (city && itemCity && itemCity.indexOf(city) === -1 && normTitle(title).indexOf(normTitle(keyword)) === -1) continue;
    // 年份过滤：时间文本里已含年份且与目标年份不同才排除
    if (year && /\d{4}/.test(it.showTime || '') && (it.showTime || '').indexOf(year) === -1) continue;
    const perfText = it.showTime || '';
    const url2 = it.projectUrl ? ('https:' + it.projectUrl) : '';
    const item = {
      title, city: itemCity || city || '', year: year || '',
      platform: '大麦', ticketUrl: url2,
      ticketOpenAt: null, ticketOpenText: '',
      performances: parseShowTime(perfText).map(p => Object.assign(p, { venue: it.venueName || '' })),
      source: 'damai'
    };
    out.push(item);
    candidates.push({ item, url: url2, title });
  }
  // 开票时间补充（详情页抓取，最多 3 条，失败静默）
  await Promise.all(candidates.slice(0, 3).map(async c => {
    const open = await fetchTicketOpen(c.url);
    if (open) {
      c.item.ticketOpenAt = open.ts;
      c.item.ticketOpenText = open.text;
    }
  }));
  return out;
}

// 从大麦详情页 HTML 提取开售/开票时间
async function fetchTicketOpen(url) {
  if (!url) return null;
  try {
    const html = await getText(url, { headers: headers(), timeoutMs: 6000 });
    const pats = [/开售时间[：:]\s*(\d{4})[-.年](\d{1,2})[-.月](\d{1,2})[日]?\s*(\d{1,2}):(\d{2})/,
                  /开票时间[：:]\s*(\d{4})[-.年](\d{1,2})[-.月](\d{1,2})[日]?\s*(\d{1,2}):(\d{2})/];
    for (const pat of pats) {
      const m = html.match(pat);
      if (m) {
        const text = m[1] + '-' + (+m[2]) + '-' + (+m[3]) + ' ' + m[4] + ':' + m[5];
        return { ts: Date.parse(text.replace(' ', 'T')), text };
      }
    }
    // 兜底：页面内嵌 JSON 中找开售时间字段
    const jm = html.match(/window\.__INITIAL_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
    if (jm) {
      try {
        const obj = JSON.parse(jm[1]);
        const found = deepFindSaleTime(obj);
        if (found) return { ts: found.ts, text: found.text };
      } catch (e) { /* 解析失败忽略 */ }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// 递归查找类似开售时间的字段值
function deepFindSaleTime(obj, depth) {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string') {
    const m = obj.match(/(\d{4})[-.年](\d{1,2})[-.月](\d{1,2})[日]?\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const text = m[1] + '-' + (+m[2]) + '-' + (+m[3]) + ' ' + m[4] + ':' + m[5];
      const ts = Date.parse(text.replace(' ', 'T'));
      return isNaN(ts) ? null : { ts, text };
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = deepFindSaleTime(v, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    // 优先看键名像开售时间的字段
    for (const k of Object.keys(obj)) {
      if (/sale|onsale|开售|开票|sell/i.test(k)) {
        const r = deepFindSaleTime(obj[k], depth + 1);
        if (r) return r;
      }
    }
    for (const k of Object.keys(obj)) {
      const r = deepFindSaleTime(obj[k], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

module.exports = { name, enabled, search };
