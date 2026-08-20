// cloudfunctions/fetchShowInfo/sources/resale.js —— 摩天轮/票牛 二手·比价平台适配器
// 说明：二手平台信息可能滞后/含溢价，结果统一标记 resale: true，
//       合并时降权（primaryScore -3），仅在无一手渠道时作为补充展示。
// 策略：候选接口并行尝试（6s 超时），失败静默返回 []。
// ★ 部署后建议实测；接口失效期间不影响其他源，此类信息主要靠社区补录。
const { getJSON } = require('./http.js');
const { parseShowTime, fuzzyMatch, pick } = require('./normalize.js');
const cfg = require('./config.js');

const name = '摩天轮/票牛';
const enabled = cfg.ENABLE_RESALE;

// 候选接口来自集中配置（sources/config.js），支持 {kw} 占位符
const ENDPOINTS = cfg.RESALE_ENDPOINTS;

async function search({ name: keyword, year, city }) {
  const attempts = ENDPOINTS.map(cfgItem =>
    getJSON(cfgItem.url.replace('{kw}', encodeURIComponent(keyword)), { headers: { Referer: 'https://www.motianlun.cn/' }, timeoutMs: 6000 })
      .then(data => normalize(data, cfgItem.platform, { keyword, year, city }))
      .catch(e => { console.warn('[resale] endpoint fail:', cfgItem.platform, e.message); return []; })
  );
  const results = await Promise.all(attempts);
  const out = [];
  for (const list of results) if (list) out.push(...list);
  return out;
}

function extractList(data) {
  if (!data) return [];
  const d = data.data || data;
  if (Array.isArray(d)) return d;
  return d.list || d.items || d.records || d.projects ||
         (d.result && (d.result.list || d.result.items)) || [];
}

function normalize(data, platform, { keyword, year, city }) {
  const raw = extractList(data);
  const out = [];
  for (const it of raw.slice(0, 10)) {
    const title = pick(it, ['title', 'name', 'projectName', 'showName']);
    if (!title || !fuzzyMatch(title, keyword)) continue;
    const st = pick(it, ['showTime', 'timeText', 'performanceTime', 'startTime', 'dateText']);
    if (year && st.indexOf(year) === -1 && /\d{4}/.test(st)) continue;
    const itemCity = pick(it, ['cityName', 'city']);
    if (city && itemCity && itemCity.indexOf(city) === -1) continue;
    const url = pick(it, ['url', 'link', 'projectUrl', 'detailUrl', 'jumpUrl']);
    out.push({
      title, city: itemCity || city || '', year: year || '',
      platform, ticketUrl: url,
      ticketOpenAt: null, ticketOpenText: '',
      performances: parseShowTime(st).map(p => Object.assign(p, { venue: pick(it, ['venueName', 'venue', 'theaterName']) })),
      resale: true, source: 'resale'
    });
  }
  return out;
}

module.exports = { name, enabled, search };
