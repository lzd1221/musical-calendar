// cloudfunctions/watchList/index.js —— 用户关注 / 订阅额度 / 详情 / 手动补录
// actions:
//   list        -> { list: [完整剧目记录] }                 （我关注的剧目）
//   get         -> { show, watched, subCount, watchedList }（详情页）
//   add         -> { ok }                                   （关注）
//   remove      -> { ok }                                   （取关）
//   subscribe   -> { ok }                                   （增加订阅额度）
//   correct     -> { ok, showId }                           （手动补录/纠错）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { showKey, parsePerfLines } = require('./sources/normalize.js');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  switch (event.action) {
    case 'list': return listWatched(OPENID);
    case 'get': return getShow(OPENID, event.showId);
    case 'add': return addWatch(OPENID, event.showId);
    case 'remove': return removeWatch(OPENID, event.showId);
    case 'subscribe': return subscribe(OPENID, event.showId, event.count);
    case 'correct': return correct(OPENID, event.data);
    default: return { ok: false, msg: '未知操作' };
  }
};

async function listWatched(OPENID) {
  try {
    const wr = await db.collection('user_watch').where({ _openid: OPENID }).limit(100).get();
    const ids = wr.data.map(w => w.showId).filter(Boolean);
    if (!ids.length) return { ok: true, list: [] };
    const sr = await db.collection('shows').where({ _id: _.in(ids) }).limit(100).get();
    return { ok: true, list: sr.data || [] };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

async function getShow(OPENID, showId) {
  if (!showId) return { ok: false, msg: '缺少 showId' };
  const sr = await db.collection('shows').doc(showId).get().catch(() => null);
  if (!sr || !sr.data) return { ok: false, msg: '剧目不存在' };
  const show = Object.assign({ _id: showId }, sr.data);
  // 是否已关注
  const wRes = await db.collection('user_watch').where({ _openid: OPENID, showId }).limit(1).get();
  // 订阅额度
  let subCount = 0;
  const sRes = await db.collection('user_sub').where({ _openid: OPENID, showId }).limit(1).get();
  if (sRes.data.length) subCount = sRes.data[0].count || 0;
  // 其他已关注剧目（供撞期检测）
  const all = await listWatched(OPENID);
  return { ok: true, show, watched: wRes.data.length > 0, subCount, watchedList: all.list || [] };
}

async function addWatch(OPENID, showId) {
  if (!showId) return { ok: false, msg: '缺少 showId' };
  const exist = await db.collection('user_watch').where({ _openid: OPENID, showId }).limit(1).get();
  if (!exist.data.length) {
    await db.collection('user_watch').add({ data: { showId, createdAt: Date.now(), _openid: OPENID } });
  }
  return { ok: true };
}

async function removeWatch(OPENID, showId) {
  await db.collection('user_watch').where({ _openid: OPENID, showId }).remove();
  return { ok: true };
}

async function subscribe(OPENID, showId, count) {
  if (!showId) return { ok: false, msg: '缺少 showId' };
  const n = Math.max(0, Math.min(count || 0, 10));
  if (!n) return { ok: true };
  const exist = await db.collection('user_sub').where({ _openid: OPENID, showId }).limit(1).get();
  if (exist.data.length) {
    await db.collection('user_sub').doc(exist.data[0]._id).update({ data: { count: _.inc(n), updatedAt: Date.now() } });
  } else {
    await db.collection('user_sub').add({ data: { showId, count: n, updatedAt: Date.now(), _openid: OPENID } });
  }
  return { ok: true };
}

/* ---------------- 手动补录 ---------------- */
async function correct(OPENID, d) {
  if (!d || !d.title || !String(d.title).trim()) return { ok: false, msg: '缺少剧名' };
  const title = String(d.title).trim();
  const city = d.city || '';
  const year = d.year || '';
  const perfText = d.perfText || '';
  let ticketOpenAt = null, ticketOpenText = '';
  if (d.ticketOpenText) {
    const ts = Date.parse(String(d.ticketOpenText).replace(' ', 'T'));
    if (!isNaN(ts)) { ticketOpenAt = ts; ticketOpenText = String(d.ticketOpenText); }
  }
  const key = showKey(title, city, year);
  const performances = parsePerfLines(perfText);

  // 1) 写纠错日志（记录提交者，便于后续审核）
  await db.collection('corrections').add({
    data: {
      title, city, year, platform: d.platform || '其他',
      ticketUrl: d.ticketUrl || '', ticketOpenText, perfText,
      source: d.source || 'manual', status: 'approved',
      _openid: OPENID, createdAt: Date.now()
    }
  });

  // 2) upsert 到 shows（与自动数据合并；人工开票时间优先）
  const exist = await db.collection('shows').where({ key }).limit(1).get();
  let showId;
  if (exist.data.length) {
    const doc = exist.data[0];
    const upd = { manual: true, confirmed: true, updatedAt: Date.now() };
    if (ticketOpenAt) { upd.ticketOpenAt = ticketOpenAt; upd.ticketOpenText = ticketOpenText; }
    if (d.ticketUrl) upd.ticketUrl = d.ticketUrl;
    if (performances.length) {
      const perfMap = {};
      for (const p of doc.performances || []) perfMap[p.date + '|' + p.start] = p;
      for (const p of performances) if (!perfMap[p.date + '|' + p.start]) perfMap[p.date + '|' + p.start] = p;
      upd.performances = Object.keys(perfMap).sort().map(k => perfMap[k]);
    }
    const channels = doc.channels || [];
    if (d.platform && d.ticketUrl && !channels.some(c => c.platform === d.platform)) {
      channels.push({ platform: d.platform, url: d.ticketUrl });
      upd.channels = channels;
    }
    await db.collection('shows').doc(doc._id).update({ data: upd });
    showId = doc._id;
  } else {
    const add = await db.collection('shows').add({
      data: {
        title, city, year, key,
        platform: d.platform || '社区补录',
        ticketUrl: d.ticketUrl || '',
        ticketOpenAt, ticketOpenText, performances,
        channels: d.ticketUrl ? [{ platform: d.platform || '其他', url: d.ticketUrl }] : [],
        confirmed: true, manual: true,
        sourceUpdatedAt: Date.now(), updatedAt: Date.now()
      }
    });
    showId = add._id;
  }

  // 3) 自动关注
  await addWatch(OPENID, showId);
  return { ok: true, showId };
}
