// cloudfunctions/fetchShowInfo/sources/polly.js —— 保利票务适配器（剧院院线官方票务，音乐剧主力渠道）
// 官网为 SPA，公开搜索接口不稳定且可能变更。
// 策略：内置多条候选接口，并行尝试（单条 6s 超时），全部失败则静默返回 []，不影响其他源。
// ★ 部署后建议在微信开发者工具「云函数本地调试」里实测，若接口全部失效，
//   把 SEARCH_ENDPOINTS 换成当时可用的搜索接口即可；失效期间信息由社区补录兜底。
const { getJSON } = require('./http.js');
const { parseShowTime, fuzzyMatch, pick } = require('./normalize.js');
const cfg = require('./config.js');

const name = '保利票务';
const enabled = cfg.ENABLE_POLLY;

// 候选搜索接口来自集中配置（sources/config.js），支持 {kw} 占位符
const SEARCH_ENDPOINTS = cfg.POLLY_ENDPOINTS;

async function search({ name: keyword, year, city }) {
  const attempts = SEARCH_ENDPOINTS.map(base => {
    const url = base.replace('{kw}', encodeURIComponent(keyword));
    return getJSON(url, { headers: { Referer: 'https://www.poliyu.com/' }, timeoutMs: 6000 })
      .then(data => normalize(data, { keyword, year, city }))
      .catch(e => { console.warn('[polly] endpoint fail:', base, e.message); return []; });
  });
  const results = await Promise.all(attempts);
  // 取第一个解析出结果的
  for (const list of results) if (list && list.length) return list;
  return [];
}

// 兼容多种返回结构
function extractList(data) {
  if (!data) return [];
  const d = data.data || data;
  if (Array.isArray(d)) return d;
  return d.list || d.items || d.records || d.content ||
         (d.result && (d.result.list || d.result.items || d.result.records)) || [];
}

function normalize(data, { keyword, year, city }) {
  const raw = extractList(data);
  const out = [];
  for (const it of raw.slice(0, 10)) {
    const title = pick(it, ['title', 'name', 'projectName', 'showName']);
    if (!title || !fuzzyMatch(title, keyword)) continue;
    const st = pick(it, ['showTime', 'timeText', 'performanceTime', 'startTimeText', 'startTime']);
    if (year && st.indexOf(year) === -1 && /\d{4}/.test(st)) continue;
    const itemCity = pick(it, ['cityName', 'city']);
    if (city && itemCity && itemCity.indexOf(city) === -1) continue;
    const url = pick(it, ['url', 'link', 'projectUrl', 'detailUrl']);
    out.push({
      title, city: itemCity || city || '', year: year || '',
      platform: '保利票务', ticketUrl: url,
      ticketOpenAt: null, ticketOpenText: '',
      performances: parseShowTime(st).map(p => Object.assign(p, { venue: pick(it, ['venueName', 'venue', 'theaterName']) })),
      resale: false, source: 'polly'
    });
  }
  return out;
}

module.exports = { name, enabled, search };
