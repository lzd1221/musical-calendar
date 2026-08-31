// web-version/sources/shct.js —— 上海文化广场（官方）节目列表适配器
// 数据源：https://m.shcstheatre.com/Program/ProgramListWeChat.aspx?GROUP_ID=351
// 说明：官网对非微信客户端 UA 返回反爬提示页，必须带 MicroMessenger UA 才能拿到真实列表。
//       返回的是官方节目列表（剧名/类型/场馆/日期/时间/价格/购票链接），权威且规整。
const { getText } = require('./http.js');

const name = '官方·上海文化广场';
const enabled = true;

const WX_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003123) NetType/WIFI Language/zh_CN';
const LIST_URL = 'https://m.shcstheatre.com/Program/ProgramListWeChat.aspx?GROUP_ID=351';
const BASE = 'https://m.shcstheatre.com/';

function pad2(n) { return String(n).padStart(2, '0'); }
function strip(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function pick(block, label) {
  const m = block.match(new RegExp(label + '([\\s\\S]*?)(?:<\\/li>|<)'));
  return m ? strip(m[1]) : '';
}

// 日期区间 + 时间 展开成场次
function expandPerfs(dateStr, timeStr, venue) {
  const parse = s => { const m = String(s).match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/); return m ? m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) : null; };
  const parts = String(dateStr || '').replace(/\s/g, '').split(/[-–~]+/);
  const d1 = parse(parts[0]);
  const d2 = parts[1] ? parse(parts[1]) : d1;
  const dates = [];
  if (d1 && d2) {
    const a = new Date(d1 + 'T00:00:00'), b = new Date(d2 + 'T00:00:00');
    const days = Math.round((b - a) / 86400000);
    if (days >= 0 && days <= 60) {
      for (let i = 0; i <= days; i++) { const d = new Date(a.getTime() + i * 86400000); dates.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())); }
    } else { dates.push(d1, d2); }
  }
  const times = String(timeStr || '').split(',').map(t => t.trim()).filter(Boolean);
  const perfs = [];
  for (const d of dates) for (const t of (times.length ? times : [''])) perfs.push({ date: d, start: t, end: '', venue });
  return perfs;
}

async function search({ name: keyword, year, city }) {
  try {
    const html = await getText(LIST_URL, {
      timeoutMs: 12000,
      headers: { 'User-Agent': WX_UA, 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://m.shcstheatre.com/' }
    });
    if (!html || html.indexOf('datarow') === -1) return [];
    const out = [];
    const blocks = html.split(/<div class='am-g'>/).slice(1);
    for (const block of blocks) {
      const tM = block.match(/program-content-title[\s\S]*?<a[^>]*href='([^']+)'[^>]*>([\s\S]*?)<\/a>/);
      if (!tM) continue;
      const url = BASE + tM[1].replace(/&amp;/g, '&');
      const title = strip(tM[2]).replace(/[《》]/g, '');
      const type = pick(block, '类型：');
      const venue = pick(block, '地点：') || '上海文化广场';
      const dateStr = pick(block, '日期：');
      const timeStr = pick(block, '时间：');
      const priceM = block.match(/color-curr'>([^<]+)</);
      const price = priceM ? strip(priceM[1]) : '';
      out.push({
        title, city: '上海', year: '',
        platform: '官方·上海文化广场',
        ticketUrl: url,
        ticketOpenAt: null, ticketOpenText: '',
        priceText: price,
        genre: type,
        performances: expandPerfs(dateStr, timeStr, venue),
        resale: false, source: 'shct', official: true
      });
    }
    // 关键词过滤（若提供了剧名）
    let list = out;
    if (keyword) {
      const k = String(keyword).replace(/[《》]/g, '').toLowerCase();
      list = out.filter(s => s.title.toLowerCase().indexOf(k) > -1 || (s.genre && s.genre.indexOf(k) > -1));
    }
    return list;
  } catch (e) {
    console.warn('[shct] fail:', e.message);
    return [];
  }
}

module.exports = { name, enabled, search };
