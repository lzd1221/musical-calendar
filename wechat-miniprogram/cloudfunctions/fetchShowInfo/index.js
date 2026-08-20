// cloudfunctions/fetchShowInfo/index.js —— 剧目信息获取云函数
// 入口：{ action: 'search', name, year, city } | { action: 'refresh', showId }
// 流程：DB 缓存 → 多平台抓取 → 合并归一化 → 写回 DB（供所有用户共享）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const sources = require('./sources/index.js');
const theater = require('./sources/theater.js');
const { showKey, fuzzyMatch, parsePerfLines, primaryScore } = require('./sources/normalize.js');

const CACHE_HOURS = 6; // 缓存多少小时内直接返回，不重复抓取

exports.main = async (event) => {
  if (event.action === 'refresh') return refresh(event.showId);
  if (event.action === 'search') return search(event);
  return { ok: false, msg: '未知操作' };
};

/* ---------------- 搜索 ---------------- */
async function search({ name, year, city }) {
  name = (name || '').trim();
  if (!name) return { ok: false, msg: '请填写剧名' };

  // 1) 查缓存：标题模糊匹配 + 城市/年份过滤
  const cached = await queryCache(name, year, city);
  if (cached.length) {
    return { ok: true, list: cached, fromCache: true, sourcesTip: '来自共享数据库' };
  }

  // 2) 多平台抓取（并行，单源失败不影响）
  const raw = await sources.runAll({ name, year, city });

  // 3) 社区补录数据（corrections 中已审核的人工录入）
  const community = await loadCommunity(name, year, city);
  raw.push(...community);

  // 4) 合并去重 + 官方渠道补充 + 写回 DB
  const merged = mergeResults(raw, { name, year, city });
  const saved = [];
  for (const m of merged) {
    theater.enrich(m); // 按场馆追加官方购票渠道
    const doc = await upsertShow(m);
    if (doc) saved.push(doc);
  }
  if (!saved.length && community.length) {
    // 社区数据也未命中精确合并时，仍然入库返回
    for (const c of community) { theater.enrich(c); const doc = await upsertShow(c); if (doc) saved.push(doc); }
  }
  return {
    ok: true, list: saved, fromCache: false,
    sourcesTip: saved.length ? '来自 大麦/猫眼/保利/剧院官网/二手平台 多源获取' : '',
    manualHint: !saved.length ? '未自动获取到，可手动补录' : ''
  };
}

/* ---------------- 刷新单条 ---------------- */
async function refresh(showId) {
  if (!showId) return { ok: false, msg: '缺少 showId' };
  const res = await db.collection('shows').doc(showId).get().catch(() => null);
  if (!res || !res.data) return { ok: false, msg: '剧目不存在' };
  const old = res.data;
  const raw = await sources.runAll({ name: old.title, year: old.year, city: old.city });
  const merged = mergeResults(raw, { name: old.title, year: old.year, city: old.city });
  const target = merged.find(m => showKey(m.title, m.city, m.year) === old.key) || merged[0];
  if (target) {
    theater.enrich(target);
    const updated = await upsertShow(target, old);
    return { ok: true, show: updated };
  }
  // 抓取失败：保留旧数据
  await db.collection('shows').doc(showId).update({ data: { sourceUpdatedAt: Date.now() } }).catch(() => {});
  return { ok: true, show: old, stale: true };
}

/* ---------------- 缓存查询 ---------------- */
async function queryCache(name, year, city) {
  try {
    const cond = {};
    cond.title = db.RegExp({ regexp: escapeRe(name), options: 'i' });
    if (city) cond.city = city;
    if (year) cond.year = year;
    const r = await db.collection('shows').where(cond).limit(20).get();
    return r.data || [];
  } catch (e) {
    console.warn('[cache query]', e.message);
    return [];
  }
}

async function loadCommunity(name, year, city) {
  try {
    const r = await db.collection('corrections')
      .where({ status: 'approved' })
      .limit(50)
      .get();
    const out = [];
    for (const c of r.data || []) {
      if (!c.title || !fuzzyMatch(c.title, name)) continue;
      if (city && c.city && c.city !== city) continue;
      if (year && c.year && c.year !== year) continue;
      out.push(manualToShow(c, true));
    }
    return out;
  } catch (e) { return []; }
}

function manualToShow(d, fromCommunity) {
  const title = (d.title || '').trim();
  const perfText = d.perfText || '';
  let ticketOpenAt = null, ticketOpenText = '';
  if (d.ticketOpenText) {
    const ts = Date.parse(String(d.ticketOpenText).replace(' ', 'T'));
    if (!isNaN(ts)) { ticketOpenAt = ts; ticketOpenText = d.ticketOpenText; }
  }
  return {
    title, city: d.city || '', year: d.year || '',
    platform: d.platform || '社区补录',
    ticketUrl: d.ticketUrl || '',
    ticketOpenAt, ticketOpenText,
    performances: parsePerfLines(perfText),
    manual: true, confirmed: fromCommunity ? true : false,
    source: 'community'
  };
}

/* ---------------- 合并 ---------------- */
function mergeResults(items, { name, year, city }) {
  const groups = {};
  for (const it of items) {
    if (!it || !it.title) continue;
    // 主键：规范化标题 + 城市（年份跟随标题所在组）
    const key = showKey(it.title, it.city || city || '', it.year || year || '');
    if (!groups[key]) groups[key] = { list: [] };
    groups[key].list.push(it);
  }
  const out = [];
  for (const key of Object.keys(groups)) {
    const list = groups[key].list;
    // 汇总渠道
    const channels = [];
    const seenCh = {};
    for (const it of list) {
      const chKey = it.platform + it.ticketUrl;
      if (it.ticketUrl && !seenCh[chKey]) {
        seenCh[chKey] = true;
        channels.push({ platform: it.platform, url: it.ticketUrl });
      }
    }
    // 主信息：取分最高的
    let primary = list[0];
    for (const it of list) if (primaryScore(it) > primaryScore(primary)) primary = it;
    // 场次合并去重（取最多者）
    const perfMap = {};
    for (const it of list) for (const p of it.performances || []) {
      const k = p.date + '|' + p.start;
      if (!perfMap[k]) perfMap[k] = Object.assign({}, p);
      else if (!perfMap[k].venue && p.venue) perfMap[k].venue = p.venue;
    }
    out.push({
      title: primary.title,
      city: primary.city || city || '',
      year: primary.year || year || '',
      platform: primary.platform,
      ticketUrl: primary.ticketUrl || (channels[0] && channels[0].url) || '',
      ticketOpenAt: primary.ticketOpenAt || null,
      ticketOpenText: primary.ticketOpenText || '',
      performances: Object.keys(perfMap).sort().map(k => perfMap[k]),
      channels,
      confirmed: true,
      manual: false,
      resale: !!primary.resale,
      source: 'merged'
    });
  }
  return out;
}

/* ---------------- 入库 ---------------- */
async function upsertShow(show, old) {
  const key = showKey(show.title, show.city, show.year);
  const now = Date.now();
  try {
    const existing = await db.collection('shows').where({ key }).limit(1).get();
    const data = {
      title: show.title, city: show.city || '', year: show.year || '',
      key,
      platform: show.platform || '其他',
      ticketUrl: show.ticketUrl || '',
      ticketOpenAt: show.ticketOpenAt || null,
      ticketOpenText: show.ticketOpenText || '',
      performances: show.performances || [],
      channels: show.channels || [],
      confirmed: show.confirmed !== false,
      manual: !!show.manual,
      resale: !!show.resale,
      sourceUpdatedAt: now,
      updatedAt: now
    };
    // 保留旧通知进度
    if (old && old.notified) data.notified = old.notified;
    let docId;
    if (existing.data.length) {
      const doc = existing.data[0];
      // 开票时间：新值优先，旧值兜底（避免刷新把已公布的开票时间清空）
      if (!data.ticketOpenAt && doc.ticketOpenAt) { data.ticketOpenAt = doc.ticketOpenAt; data.ticketOpenText = doc.ticketOpenText || ''; }
      if (!data.ticketUrl && doc.ticketUrl) data.ticketUrl = doc.ticketUrl;
      await db.collection('shows').doc(doc._id).update({ data });
      docId = doc._id;
    } else {
      const add = await db.collection('shows').add({ data });
      docId = add._id;
    }
    const after = await db.collection('shows').doc(docId).get().catch(() => null);
    return after && after.data ? Object.assign({ _id: docId }, after.data) : Object.assign({ _id: docId }, data);
  } catch (e) {
    console.warn('[upsert]', e.message);
    return null;
  }
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { main: exports.main, mergeResults, upsertShow, manualToShow };
