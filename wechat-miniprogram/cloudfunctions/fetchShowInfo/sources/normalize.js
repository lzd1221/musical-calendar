// cloudfunctions/fetchShowInfo/sources/normalize.js —— 规范化与合并工具
// 与小程序端 utils/date.js 的 parseShowTime 保持一致

function pad2(n) { return String(n).padStart(2, '0'); }

// 解析票务平台时间文本 -> [{date, start, end}]
function parseShowTime(text) {
  if (!text) return [];
  const out = [];
  const dates = [];
  const dateRe = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g;
  let m;
  const fmt = (y, mo, d) => y + '-' + pad2(+mo) + '-' + pad2(+d);
  while ((m = dateRe.exec(text)) !== null) dates.push(fmt(m[1], m[2], m[3]));
  const times = [];
  const timeRe = /(\d{1,2}):(\d{2})/g;
  while ((m = timeRe.exec(text)) !== null) times.push(pad2(m[1]) + ':' + m[2]);
  if (!dates.length) return out;
  const expandRange = () => {
    const a = new Date(dates[0] + 'T00:00:00');
    const b = new Date(dates[dates.length - 1] + 'T00:00:00');
    const days = Math.round((b - a) / 86400000);
    if (days > 1 && days <= 30) {
      const t = times[0] || '';
      out.length = 0;
      for (let i = 0; i <= days; i++) {
        const d = new Date(a.getTime() + i * 86400000);
        out.push({ date: fmt(d.getFullYear(), d.getMonth() + 1, d.getDate()), start: t, end: '' });
      }
      return true;
    }
    return false;
  };
  if (times.length === dates.length) {
    dates.forEach((d, i) => out.push({ date: d, start: times[i], end: '' }));
  } else if (times.length <= 1) {
    if (dates.length >= 2 && expandRange()) { /* 已展开 */ }
    else { const t = times[0] || ''; for (const d of dates) out.push({ date: d, start: t, end: '' }); }
  } else {
    const t = times[0] || '';
    for (const d of dates) out.push({ date: d, start: t, end: '' });
  }
  const seen = {};
  return out.filter(p => (seen[p.date + p.start] ? false : (seen[p.date + p.start] = true)));
}

// 去掉书名号等符号的规范化剧名
function normTitle(t) {
  return String(t || '').replace(/[《》【】「」（）()·\s]/g, '').toLowerCase();
}

// 去重键
function showKey(title, city, year) {
  return normTitle(title) + '|' + (city || '').toLowerCase() + '|' + (year || '');
}

// 字符串包含匹配（双向）
function fuzzyMatch(a, b) {
  const A = normTitle(a), B = normTitle(b);
  if (!A || !B) return false;
  return A.indexOf(B) > -1 || B.indexOf(A) > -1;
}

// 解析用户手动录入的场次文本（每行：日期 时间 场馆）
function parsePerfLines(text) {
  if (!text) return [];
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(\d{4})[-.](\d{1,2})[-.](\d{1,2})[^\d]*(\d{1,2}:\d{2})?\s*(.*)$/);
    if (!m) continue;
    out.push({
      date: m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]),
      start: m[4] || '',
      end: '',
      venue: (m[5] || '').trim()
    });
  }
  return out;
}

// 字段候选提取（适配不同平台/接口的字段命名差异）
function pick(obj, keys) {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

// 主平台打分（决定合并后谁的信息优先展示）
function primaryScore(show) {
  let s = 0;
  if (show.ticketOpenAt) s += 20;                 // 有开票时间最重要
  if (show.manual) s += 1;
  if (show.resale) s -= 3;                        // 二手/比价平台降权
  s += (show.performances || []).length;
  const w = { '大麦': 3, '猫眼': 2, '保利票务': 2, '剧院官网': 2, '社区补录': 1, '摩天轮': 0, '票牛': 0, '其他': 1 };
  s += w[show.platform] || 1;
  return s;
}

module.exports = { parseShowTime, normTitle, showKey, fuzzyMatch, parsePerfLines, primaryScore, pick };
