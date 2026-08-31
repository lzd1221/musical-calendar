// web-version/server.js —— 音乐剧排期 & 抢票日历（多用户版）后端
// 功能：
//   1) 用户注册 / 登录（scrypt 密码哈希 + HMAC token，cookie 7 天）
//   2) 抢票/看剧计划 CRUD（数据按用户隔离，存 JSON 文件，跨设备同步）
//   3) 剧目搜索（多平台抓取 + 360/必应兜底 + 深度解析）
//   4) 静态服务 web-version/public 目录
// 启动：node web-version/server.js   浏览器打开 http://localhost:8878
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sources = require('./sources/index.js');
const deep = require('./sources/deep.js');
const cfg = require('./sources/config.js');
const { showKey, primaryScore } = require('./sources/normalize.js');

const PORT = Number(process.env.PORT || 8878);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

/* ---------------- JSON 文件存储 ---------------- */
function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch (e) { return def; }
}
function saveJSON(file, data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
  } catch (e) { console.error('保存数据失败:', e.message); }
}
let users = loadJSON('users.json', []);
let plans = loadJSON('plans.json', []);
let SECRET = loadJSON('secret.json', '');
if (!SECRET || SECRET.length < 16) {
  SECRET = crypto.randomBytes(32).toString('hex');
  saveJSON('secret.json', SECRET);
}

/* ---------------- 鉴权 ---------------- */
const AUTH_ENABLED = cfg.AUTH_ENABLED !== false;
const COOKIE_NAME = 'mw_auth';
const AUTH_MAX_AGE = 7 * 86400 * 1000; // 7 天

function hashPw(password, salt) { return crypto.scryptSync(String(password), salt, 64).toString('hex'); }
function signUserToken(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + AUTH_MAX_AGE })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function verifyUserToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const expect = crypto.createHmac('sha256', SECRET).update(parts[0]).digest('base64url');
    if (expect !== parts[1]) return null;
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (!data.uid || Date.now() > data.exp) return null;
    return data.uid;
  } catch (e) { return null; }
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const pair of raw.split(';')) {
    const i = pair.indexOf('=');
    if (i > -1) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}
function getUid(req) {
  if (!AUTH_ENABLED) return 'anonymous';
  return verifyUserToken(parseCookies(req)[COOKIE_NAME]);
}
function usernameOf(uid) {
  const u = users.find(x => x.id === uid);
  return u ? u.username : '';
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function setAuthCookie(res, uid) {
  return COOKIE_NAME + '=' + signUserToken(uid) + '; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax';
}

/* ---------------- 静态文件服务 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------- 搜索 API ---------------- */
function mergeResults(items, { city, year }) {
  const groups = {};
  for (const it of items) {
    if (!it || !it.title) continue;
    const key = showKey(it.title, it.city || city || '', it.year || year || '');
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  }
  const out = [];
  for (const key of Object.keys(groups)) {
    const list = groups[key];
    let primary = list[0];
    for (const it of list) if (primaryScore(it) > primaryScore(primary)) primary = it;
    const channels = [];
    const seen = {};
    for (const it of list) {
      const ck = it.platform + '|' + it.ticketUrl;
      if (it.ticketUrl && !seen[ck]) { seen[ck] = true; channels.push({ platform: it.platform, url: it.ticketUrl, resale: !!it.resale }); }
    }
    const perfMap = {};
    for (const it of list) for (const p of it.performances || []) {
      const k = p.date + '|' + p.start;
      if (!perfMap[k]) perfMap[k] = Object.assign({}, p);
    }
    out.push({
      title: primary.title, city: primary.city || city || '', year: primary.year || year || '',
      platform: primary.platform, ticketUrl: primary.ticketUrl || (channels[0] && channels[0].url) || '',
      ticketOpenAt: primary.ticketOpenAt || null, ticketOpenText: primary.ticketOpenText || '',
      priceText: primary.priceText || '', genre: primary.genre || '',
      performances: Object.keys(perfMap).sort().map(k => perfMap[k]), channels, resale: !!primary.resale
    });
  }
  return out;
}
async function handleSearch(q) {
  const name = (q.name || '').trim();
  if (!name) return { ok: false, msg: '缺少剧名' };
  const city = (q.city || '').trim();
  const year = (q.year || '').trim();
  const status = [];
  const results = [];
  await Promise.all(sources.REGISTRY.map(async src => {
    if (!src.enabled) { status.push({ name: src.name, ok: false, skipped: true }); return; }
    try {
      const list = await src.search({ name, year, city });
      status.push({ name: src.name, ok: Array.isArray(list) && list.length > 0, count: (list || []).length });
      if (Array.isArray(list)) results.push(...list);
    } catch (e) { status.push({ name: src.name, ok: false, error: e.message }); }
  }));
  let searchRef = [], searchSrc = '';
  try { searchRef = await sources.so360.search({ name, year, city }); if (searchRef.length) searchSrc = '360搜索'; } catch (e) {}
  if (!searchRef.length) {
    try { searchRef = await sources.bing.search({ name, year, city }); if (searchRef.length) searchSrc = '必应搜索'; } catch (e) {}
  }
  if (searchSrc) status.push({ name: searchSrc, ok: true, count: searchRef.length });
  let deepHits = 0;
  if (searchRef.length) {
    searchRef = await deep.analyze(searchRef, 4);
    deepHits = searchRef.filter(x => x.deep && (x.deep.openText || x.deep.showTimes.length)).length;
    if (deepHits) status.push({ name: '深度解析', ok: true, count: deepHits });
  }
  const merged = mergeResults(results, { city, year });
  const platformHits = merged.length;

  // 社区共享：其他用户公开的抢票/开场信息
  const community = plans.filter(p => {
    if (!p.public) return false;
    if (name && p.showName.toLowerCase().indexOf(name.toLowerCase()) === -1) return false;
    if (city && p.city && p.city !== city) return false;
    return true;
  }).slice(0, 20).map(p => ({
    id: p.id, showName: p.showName, city: p.city,
    ticketOpenAt: p.ticketOpenAt, ticketOpenText: p.ticketOpenText,
    perfDate: p.perfDate, perfStart: p.perfStart, venue: p.venue,
    sharedBy: p.sharedBy || '网友'
  }));

  return {
    ok: platformHits > 0 || community.length > 0,
    name, city, year, list: merged, bing: searchRef, searchSrc, deepHits, community,
    status, ts: Date.now(),
    tips: buildTips(status, platformHits, searchRef.length, deepHits, community.length)
  };
}
function buildTips(status, hits, refCount, deepHits, communityCount) {
  const tips = [];
  if (hits > 0) tips.push('已从票务平台获取到该剧目信息，开票时间/场次以官方页面为准。');
  else {
    tips.push('平台接口未能返回数据（多为平台反爬限制）。');
    if (communityCount > 0) tips.push('社区网友分享的公开信息已匹配到该剧，可一键加入自己的日程。');
    if (deepHits > 0) tips.push('已从相关网页中解析出开票时间/演出信息，请核对后再抢票。');
    else if (refCount > 0) tips.push('已为你找到相关网页参考（下方列表），可点开官方/票务页面获取开票时间，或手动录入。');
    else if (communityCount === 0) tips.push('搜索引擎此刻可能正被限流（间歇性反爬），建议稍后再试，或手动录入。');
  }
  return tips;
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // 注册
  if (pathname === '/api/register' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return json(res, 400, { ok: false, msg: '请求格式错误' }); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!/^[\w\u4e00-\u9fa5-]{2,20}$/.test(username)) return json(res, 400, { ok: false, msg: '用户名需 2-20 位（字母/数字/中文/下划线/横线）' });
    if (password.length < 6) return json(res, 400, { ok: false, msg: '密码至少 6 位' });
    if (users.some(u => u.username === username)) return json(res, 409, { ok: false, msg: '该用户名已被注册' });
    const u = { id: 'u' + crypto.randomBytes(8).toString('hex'), username, salt: crypto.randomBytes(16).toString('hex'), createdAt: Date.now() };
    u.hash = hashPw(password, u.salt);
    users.push(u); saveJSON('users.json', users);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': setAuthCookie(res, u.id) });
    return res.end(JSON.stringify({ ok: true, username }));
  }

  // 登录
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return json(res, 400, { ok: false, msg: '请求格式错误' }); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const u = users.find(x => x.username === username);
    if (!u || hashPw(password, u.salt) !== u.hash) return json(res, 401, { ok: false, msg: '用户名或密码错误' });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': setAuthCookie(res, u.id) });
    return res.end(JSON.stringify({ ok: true, username: u.username }));
  }

  // 登录状态
  if (pathname === '/api/auth-status') {
    const uid = getUid(req);
    return json(res, 200, { ok: !!uid, username: uid ? usernameOf(uid) : '' });
  }

  // 登出
  if (pathname === '/api/logout' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': COOKIE_NAME + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ---- 以下需要登录 ----
  const uid = getUid(req);
  if (!uid) {
    if (pathname === '/api/plans' || pathname === '/api/search') return json(res, 401, { ok: false, msg: '请先登录' });
    // 未登录访问页面：直接返回 index.html（前端根据 auth-status 显示登录界面）
    return serveStatic(req, res);
  }

  // 计划列表
  if (pathname === '/api/plans' && req.method === 'GET') {
    const list = plans.filter(p => p.userId === uid)
      .sort((a, b) => (a.ticketOpenAt || a.createdAt) - (b.ticketOpenAt || b.createdAt));
    return json(res, 200, { ok: true, list });
  }

  // 新增计划
  if (pathname === '/api/plans' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return json(res, 400, { ok: false, msg: '请求格式错误' }); }
    const showName = String(body.showName || '').trim();
    if (!showName) return json(res, 400, { ok: false, msg: '请填写剧名' });
    const ticketOpenText = String(body.ticketOpenText || '').trim();
    const ticketOpenAt = ticketOpenText ? Date.parse(ticketOpenText.replace(' ', 'T')) : null;
    const plan = {
      id: 'p' + crypto.randomBytes(8).toString('hex'),
      userId: uid,
      showName,
      city: String(body.city || '').trim(),
      ticketOpenAt: ticketOpenAt && !isNaN(ticketOpenAt) ? ticketOpenAt : null,
      ticketOpenText,
      perfDate: String(body.perfDate || '').trim(),
      perfStart: String(body.perfStart || '').trim(),
      venue: String(body.venue || '').trim(),
      note: String(body.note || '').trim(),
      ticketStatus: ['已抢', '已购', '放弃'].indexOf(body.ticketStatus) > -1 ? body.ticketStatus : '待抢',
      public: !!body.public,
      sharedBy: usernameOf(uid),
      createdAt: Date.now(), updatedAt: Date.now()
    };
    plans.push(plan); saveJSON('plans.json', plans);
    return json(res, 200, { ok: true, plan });
  }

  // 更新 / 删除计划
  const planMatch = pathname.match(/^\/api\/plans\/([\w-]+)$/);
  if (planMatch) {
    const pid = planMatch[1];
    const plan = plans.find(p => p.id === pid && p.userId === uid);
    if (!plan) return json(res, 404, { ok: false, msg: '计划不存在' });
    if (req.method === 'DELETE') {
      plans = plans.filter(p => p.id !== pid); saveJSON('plans.json', plans);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'PATCH') {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return json(res, 400, { ok: false, msg: '请求格式错误' }); }
      if (body.showName !== undefined) plan.showName = String(body.showName || '').trim();
      if (body.city !== undefined) plan.city = String(body.city || '').trim();
      if (body.ticketOpenText !== undefined) {
        plan.ticketOpenText = String(body.ticketOpenText || '').trim();
        const t = plan.ticketOpenText ? Date.parse(plan.ticketOpenText.replace(' ', 'T')) : null;
        plan.ticketOpenAt = t && !isNaN(t) ? t : null;
      }
      if (body.perfDate !== undefined) plan.perfDate = String(body.perfDate || '').trim();
      if (body.perfStart !== undefined) plan.perfStart = String(body.perfStart || '').trim();
      if (body.venue !== undefined) plan.venue = String(body.venue || '').trim();
      if (body.note !== undefined) plan.note = String(body.note || '').trim();
      if (body.ticketStatus !== undefined) plan.ticketStatus = ['已抢', '已购', '放弃'].indexOf(body.ticketStatus) > -1 ? body.ticketStatus : '待抢';
      if (body.public !== undefined) plan.public = !!body.public;
      plan.updatedAt = Date.now(); saveJSON('plans.json', plans);
      return json(res, 200, { ok: true, plan });
    }
  }

  // 搜索
  if (pathname === '/api/search') {
    try {
      const result = await handleSearch(Object.fromEntries(url.searchParams));
      return json(res, 200, result);
    } catch (e) {
      console.error('[api error]', e);
      return json(res, 500, { ok: false, msg: '服务器内部错误: ' + e.message });
    }
  }

  serveStatic(req, res);
});

// 端口被占用时自动向后顺延
function listenWithFallback(srv, port, attemptsLeft) {
  srv.once('error', err => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn('端口 ' + port + ' 被占用，改用 ' + (port + 1));
      listenWithFallback(srv, port + 1, attemptsLeft - 1);
    } else { console.error('监听失败:', err.message); process.exit(1); }
  });
  srv.listen(port, () => {
    console.log('🎭 音乐剧排期 & 抢票日历（多用户版）已启动');
    console.log('   本地访问:  http://localhost:' + port);
  });
}
listenWithFallback(server, PORT, 10);
