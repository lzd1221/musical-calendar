// web-version/sources/shgt.js —— 上海大剧院（官方）节目列表适配器
// 数据源：官网 SPA（https://www.shgtheatre.com/shtheatre/index.html#/）
// 后端接口：POST /thvendor/ticket/program/getHotProgramList.xhtml
//   认证：请求头 cmpappkey: grandtheatrepc（客户端标识，从官网 JS bundle 提取）
// 说明：该接口来自第三方「冷离票务」系统，返回热门/在售节目列表（剧名/时间/价格/海报）。
const { postJSON } = require('./http.js');

const name = '官方·上海大剧院';
const enabled = true;

const API_URL = 'https://www.shgtheatre.com/thvendor/ticket/program/getHotProgramList.xhtml';
const HEADERS = {
  'cmpappkey': 'grandtheatrepc',
  'Referer': 'https://www.shgtheatre.com/shtheatre/index.html',
  'Origin': 'https://www.shgtheatre.com'
};

function pad2(n) { return String(n).padStart(2, '0'); }
// "2026-04-01 00:00:00" -> "2026-04-01"
function datePart(s) { const m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) : ''; }

async function search({ name: keyword, year, city }) {
  try {
    const data = await postJSON(API_URL, { showSite: 'pclist' }, { timeoutMs: 12000, headers: HEADERS });
    if (!data || data.errcode !== '0000' || !Array.isArray(data.data)) return [];
    const out = [];
    for (const p of data.data) {
      const title = (p.fullCnName || p.cnName || '').trim();
      if (!title) continue;
      const d1 = datePart(p.startTime);
      const d2 = datePart(p.endTime);
      const perfs = [];
      if (d1) perfs.push({ date: d1, start: '', end: '', venue: '上海大剧院' });
      if (d2 && d2 !== d1) perfs.push({ date: d2, start: '', end: '', venue: '上海大剧院' });
      let priceText = '';
      if (p.minPrice != null && p.maxPrice != null) priceText = p.minPrice + '-' + p.maxPrice + '元';
      else if (p.minPrice != null) priceText = p.minPrice + '元';
      out.push({
        title, city: '上海', year: '',
        platform: '官方·上海大剧院',
        ticketUrl: 'https://www.shgtheatre.com/shtheatre/index.html#/ticket/detail/' + p.id,
        ticketOpenAt: null, ticketOpenText: '',
        priceText,
        genre: (p.category || '').replace(/,618/g, ''),
        poster: p.horizontalPoster || '',
        performances: perfs,
        resale: false, source: 'shgt', official: true
      });
    }
    let list = out;
    if (keyword) {
      const k = String(keyword).replace(/[《》]/g, '').toLowerCase();
      list = out.filter(s => s.title.toLowerCase().indexOf(k) > -1);
    }
    return list;
  } catch (e) {
    console.warn('[shgt] fail:', e.message);
    return [];
  }
}

module.exports = { name, enabled, search };
