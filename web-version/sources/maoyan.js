// cloudfunctions/fetchShowInfo/sources/maoyan.js —— 猫眼适配器
// 搜索接口：https://m.maoyan.com/ajax/search?kw=xxx （公开接口）
// 注意：猫眼演出详情为前端渲染，开票时间需在页面内人工确认（可后续扩展）；本适配器返回场次/链接。
const { getJSON } = require('./http.js');
const { parseShowTime, fuzzyMatch } = require('./normalize.js');
const cfg = require('./config.js');

const name = '猫眼';
const enabled = cfg.ENABLE_MAOYAN;

function headers() {
  const h = { Referer: 'https://m.maoyan.com/' };
  if (cfg.COOKIE) h.Cookie = cfg.COOKIE;
  return h;
}

async function search({ name: keyword, year, city }) {
  const url = 'https://m.maoyan.com/ajax/search?kw=' + encodeURIComponent(keyword);
  let data;
  try {
    data = await getJSON(url, { headers: headers() });
  } catch (e) {
    console.warn('[maoyan] search fail:', e.message);
    return [];
  }
  // 演出类目可能在 showList / dramaList / liveList
  const list = (data.showList || data.dramaList || data.liveList || []).slice(0, 10);
  const out = [];
  for (const it of list) {
    const title = (it.name || '').trim();
    if (!title || !fuzzyMatch(title, keyword)) continue;
    const itemCity = it.cityName || '';
    if (city && itemCity && itemCity.indexOf(city) === -1) continue;
    const st = it.st || '';
    if (year && st.indexOf(year) === -1 && /\d{4}/.test(st)) continue;
    const url2 = it.url ? ('https:' + it.url) : '';
    out.push({
      title, city: itemCity || city || '', year: year || '',
      platform: '猫眼', ticketUrl: url2,
      ticketOpenAt: null, ticketOpenText: '',
      performances: parseShowTime(st).map(p => Object.assign(p, { venue: it.venueName || '' })),
      source: 'maoyan'
    });
  }
  return out;
}

module.exports = { name, enabled, search };
