// cloudfunctions/fetchShowInfo/sources/theater.js —— 剧院官网/官方渠道适配器
// 两个职责：
//   1) enrich(show)：按「场馆 → 官方票务」映射，为已匹配剧目追加官方购票渠道链接。
//      官网链接模板稳定、始终可用，这是本适配器的主要价值（官方渠道信息最权威）。
//   2) search()：尝试对接部分剧院官方搜索接口（不稳定，失败静默，一般返回 []）。
// 说明：剧院官方公众号（微信）无公开接口，开票通知依赖用户手动补录（corrections 集合）。
const { getJSON } = require('./http.js');
const { fuzzyMatch } = require('./normalize.js');
const cfg = require('./config.js');

const name = '剧院官网';
const enabled = cfg.ENABLE_THEATER;

// 主要剧院官方票务：场馆关键字 → 官方渠道（可自行增删）
const OFFICIAL_SITES = [
  { venue: '文化广场', label: '官方·上海文化广场', search: t => 'https://www.shcstheatre.com/' },
  { venue: '上海大剧院', label: '官方·上海大剧院', search: t => 'https://www.shgtheatre.com/' },
  { venue: '天桥艺术中心', label: '官方·北京天桥艺术中心', search: t => 'https://www.tartscenter.com/' },
  { venue: '国家大剧院', label: '官方·国家大剧院', search: t => 'https://www.chncpa.org/' },
  { venue: '保利剧院', label: '官方·保利票务', search: t => 'https://www.poliyu.com/searchpage?keyword=' + encodeURIComponent(t) },
  { venue: '上海东方艺术中心', label: '官方·上海东方艺术中心', search: t => 'https://www.shoac.com.cn/' },
  { venue: '上海话剧艺术中心', label: '官方·上海话剧艺术中心', search: t => 'https://www.shdramatic.com/' },
  { venue: '北京人艺', label: '官方·北京人艺', search: t => 'https://www.bjry.com/' },
  { venue: '杭州大剧院', label: '官方·杭州大剧院', search: t => 'https://www.hzdjy.com/' },
  { venue: '南京保利大剧院', label: '官方·南京保利大剧院', search: t => 'https://www.poliyu.com/searchpage?keyword=' + encodeURIComponent(t) },
  { venue: '深圳保利剧院', label: '官方·深圳保利剧院', search: t => 'https://www.poliyu.com/searchpage?keyword=' + encodeURIComponent(t) }
];

// 为剧目追加官方渠道（幂等：不重复添加同一平台+url）
function enrich(show) {
  if (!show) return show;
  const title = show.title || '';
  const venues = (show.performances || []).map(p => p.venue || '').join(' ');
  const channels = show.channels || [];
  for (const site of OFFICIAL_SITES) {
    if (!venues || venues.indexOf(site.venue) === -1) continue;
    const url = site.search(title);
    if (!url) continue;
    const dup = channels.some(c => c.platform === site.label || c.url === url);
    if (!dup) channels.push({ platform: site.label, url, official: true });
  }
  show.channels = channels;
  return show;
}

// 官方搜索接口尝试（不同剧院接口差异大，这里做保守尝试；失败返回 []）
const THEATER_SEARCH_ATTEMPTS = [
  // { name: '示例剧院', url: t => 'https://xxx/api/search?kw=' + encodeURIComponent(t) }
];

async function search({ name: keyword, year, city }) {
  const attempts = THEATER_SEARCH_ATTEMPTS.map(cfg =>
    getJSON(cfg.url(keyword), { timeoutMs: 5000 })
      .then(data => normalizeOfficial(data, { keyword, year, city }))
      .catch(() => [])
  );
  const results = await Promise.all(attempts);
  for (const list of results) if (list && list.length) return list;
  return [];
}

function normalizeOfficial(data, { keyword }) {
  if (!data) return [];
  const list = data.list || data.data || data.items || [];
  const out = [];
  for (const it of (Array.isArray(list) ? list : []).slice(0, 10)) {
    const title = it.title || it.name || '';
    if (!title || !fuzzyMatch(title, keyword)) continue;
    out.push({
      title, city: it.city || '', year: '',
      platform: '剧院官网', ticketUrl: it.url || '',
      ticketOpenAt: null, ticketOpenText: '',
      performances: [], resale: false, source: 'theater'
    });
  }
  return out;
}

module.exports = { name, enabled, search, enrich, OFFICIAL_SITES };
