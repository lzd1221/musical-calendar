// cloudfunctions/refreshShowData/index.js —— 定时任务
// 每 5 分钟扫描所有被关注的剧目：
//   1) 数据过期（>6h）→ 调用 fetchShowInfo 重新抓取
//   2) 开票/开演时间到达阈值 → 调用 sendNotify 推送订阅消息（防重复）
// 部署：云开发控制台给本函数配置定时触发器（config.json 已内置，上传时选择）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const REFRESH_STALE_MS = 6 * 3600 * 1000; // 数据刷新周期
const TICKET_DAY = 24 * 3600 * 1000;      // 开票前 24h 提醒
const TICKET_SOON = 30 * 60000;           // 开票前 30 分钟提醒
const SHOW_DAY = 24 * 3600 * 1000;        // 开演前 24h 提醒
const SHOW_2H = 2 * 3600 * 1000;          // 开演前 2 小时提醒

exports.main = async () => {
  const watchRes = await db.collection('user_watch').limit(1000).get();
  const showIds = [...new Set(watchRes.data.map(w => w.showId).filter(Boolean))];
  let scanned = 0, notified = 0;

  for (const ids of chunk(showIds, 20)) {
    const sr = await db.collection('shows').where({ _id: _.in(ids) }).limit(20).get();
    for (const show of sr.data || []) {
      scanned++;
      // 1) 过期数据刷新
      if (!show.sourceUpdatedAt || Date.now() - show.sourceUpdatedAt > REFRESH_STALE_MS) {
        try {
          await cloud.callFunction({ name: 'fetchShowInfo', data: { action: 'refresh', showId: show._id } });
        } catch (e) {
          console.warn('[refresh fail]', show._id, e.message);
        }
      }
      // 2) 通知判断
      const marks = await maybeNotify(show);
      if (marks) {
        await db.collection('shows').doc(show._id).update({ data: { notified: marks } });
        notified++;
      }
    }
  }
  return { ok: true, scanned, notified };
};

async function maybeNotify(show) {
  const now = Date.now();
  const n = Object.assign({ ticketSoon: false, ticketDay: false, ticketOpen: false, shows: {} }, show.notified || {});
  const send = async (type, payload) => {
    try {
      const r = await cloud.callFunction({ name: 'sendNotify', data: Object.assign({ type, showId: show._id }, payload) });
      return !!(r && r.result && r.result.sent > 0);
    } catch (e) {
      console.warn('[sendNotify call fail]', e.message);
      return false;
    }
  };
  let changed = false;
  const mark = (k, v) => { if (n[k] !== v) { n[k] = v; changed = true; } };

  if (show.ticketOpenAt) {
    if (!n.ticketDay && now >= show.ticketOpenAt - TICKET_DAY && now < show.ticketOpenAt) {
      mark('ticketDay', await send('ticket', { stage: 'day' }));
    }
    if (!n.ticketSoon && now >= show.ticketOpenAt - TICKET_SOON && now < show.ticketOpenAt) {
      mark('ticketSoon', await send('ticket', { stage: 'soon' }));
    }
    if (!n.ticketOpen && now >= show.ticketOpenAt) {
      mark('ticketOpen', await send('ticket', { stage: 'open' }));
    }
  }
  for (let i = 0; i < (show.performances || []).length; i++) {
    const p = show.performances[i];
    if (!p.date) continue;
    const start = Date.parse(p.date + 'T' + (p.start || '00:00'));
    if (isNaN(start)) continue;
    const pid = String(p._id || i);
    if (!n.shows[pid + ':24h'] && now >= start - SHOW_DAY && now < start) {
      mark('shows.' + pid + ':24h', await send('show', { perfIndex: i }));
    }
    if (!n.shows[pid + ':2h'] && now >= start - SHOW_2H && now < start) {
      mark('shows.' + pid + ':2h', await send('show', { perfIndex: i }));
    }
  }
  return changed ? n : null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
