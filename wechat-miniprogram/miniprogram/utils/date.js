// utils/date.js —— 日期/时间工具与场次文本解析
const WEEK_CN = ['日','一','二','三','四','五','六'];

function pad2(n) { return String(n).padStart(2, '0'); }

// 时间戳 -> 'YYYY-MM-DD'
function fmtDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// 时间戳 -> 'YYYY-MM-DD HH:MM'
function fmtDateTime(ts) {
  const d = new Date(ts);
  return fmtDate(ts) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// 'YYYY-MM-DD' -> '6月20日'
function fmtCnDate(dateStr) {
  if (!dateStr) return '';
  const p = dateStr.split('-');
  return (+p[1]) + '月' + (+p[2]) + '日';
}

// 'YYYY-MM-DD' 或时间戳 -> '周五'
function weekdayCn(x) {
  let d;
  if (typeof x === 'number') d = new Date(x);
  else d = new Date(x + 'T00:00:00');
  return '周' + WEEK_CN[d.getDay()];
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDay() === 0 || d.getDay() === 6;
}

// 时间戳 -> 倒计时描述
// 返回 { text, hot, past, ms }
function countdown(ts, now) {
  now = now || Date.now();
  const ms = ts - now;
  if (!ts) return { text: '未公布', hot: false, past: false, ms: Infinity };
  if (ms <= 0) return { text: '已开票', hot: false, past: true, ms: 0 };
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  let text;
  if (d > 0) text = d + '天 ' + pad2(h) + ':' + pad2(m) + ':' + pad2(sec);
  else text = pad2(h) + ':' + pad2(m) + ':' + pad2(sec);
  return { text, hot: ms <= 30 * 60000, past: false, ms };
}

// 解析票务平台的演出时间文本 -> 规范场次数组
// 支持：'2025.06.20 周五 19:30' / '2025-06-20 19:30' / '2025.06.20-2025.06.22 19:30'（区间拆场）
//       / '2025.06.20 19:30 2025.06.21 14:00'（多场配对）
// 解析失败返回空数组（交由用户手动补录）
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
  // 去重
  const seen = {};
  return out.filter(p => (seen[p.date + p.start] ? false : (seen[p.date + p.start] = true)));
}

module.exports = { fmtDate, fmtDateTime, fmtCnDate, weekdayCn, isWeekend, countdown, parseShowTime };
