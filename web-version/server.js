// web-version/server.js —— 本地网页版后端
// 功能：
//   1) 访问密码保护（整站鉴权，未登录显示登录页）
//   2) 静态服务 web-version/public 目录
//   3) GET /api/search?name=剧名&city=城市&year=年份
//      -> 多平台真实抓取（大麦/猫眼/保利/摩天轮票牛）+ 360/必应搜索兜底 + 深度解析
// 启动：node web-version/server.js   然后浏览器打开 http://localhost:8878
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

/* ---------------- 访问密码保护（整站鉴权） ---------------- */
const AUTH_ENABLED = cfg.AUTH_ENABLED !== false;
const PASSWORD = String(cfg.PASSWORD || 'musical2025');
const SECRET = crypto.createHash('sha256').update('musical-calendar:' + PASSWORD).digest('hex');
const COOKIE_NAME = 'mw_auth';
const AUTH_MAX_AGE = 7 * 86400 * 1000; // 7 天免登录

function signToken(expires) {
  const payload = String(expires);
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function verifyToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return false;
    const expect = crypto.createHmac('sha256', SECRET).update(parts[0]).digest('base64url');
    if (expect !== parts[1]) return false;
    const expires = parseInt(parts[0], 10);
    return !isNaN(expires) && Date.now() <= expires;
  } catch (e) { return false; }
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
function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  return verifyToken(parseCookies(req)[COOKIE_NAME]);
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });
}

// 极简登录页（未登录时所有路径返回此页）
function loginPageHtml() {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>🔐 音乐剧助手 · 登录</title>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#12101e;color:#ece9f7;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
    '.box{background:#1b1730;border:1px solid #332c55;border-radius:16px;padding:36px 32px;width:320px;text-align:center}' +
    'h1{font-size:20px;margin:0 0 6px}.sub{color:#a49fc4;font-size:13px;margin:0 0 22px}' +
    'input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid #332c55;background:#221d3d;color:#ece9f7;font-size:15px;outline:none}' +
    'input:focus{border-color:#f2b24c}' +
    'button{width:100%;margin-top:14px;padding:12px;border-radius:10px;border:none;background:#f2b24c;color:#1a1428;font-size:15px;font-weight:600;cursor:pointer}' +
    '#err{color:#ff6b6b;font-size:13px;min-height:18px;margin-top:10px}' +
    'footer{position:fixed;bottom:16px;width:100%;text-align:center;color:#6f6a92;font-size:12px}</style></head>' +
    '<body><div class="box"><h1>🎭 音乐剧排期 & 抢票日历</h1>' +
    '<p class="sub">请输入访问密码后进入</p>' +
    '<input id="pwd" type="password" placeholder="访问密码" autocomplete="current-password" autofocus>' +
    '<button id="btn">🔓 进入</button><div id="err"></div></div>' +
    '<footer>密码见 web-version/sources/config.js 的 PASSWORD 字段</footer>' +
    '<script>function go(){var v=document.getElementById("pwd").value;if(!v)return;' +
    'fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:v})})' +
    '.then(function(r){if(r.ok){location.reload()}else{document.getElementById("err").textContent="密码错误"}})' +
    '.catch(function(){document.getElementById("err").textContent="请求失败，请刷新重试"})}' +
    'document.getElementById("btn").onclick=go;' +
    'document.getElementById("pwd").addEventListener("keydown",function(e){if(e.key==="Enter")go()});' +
    'document.getElementById("pwd").focus();</script></body></html>';
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
      title: primary.title,
      city: primary.city || city || '',
      year: primary.year || year || '',
      platform: primary.platform,
      ticketUrl: primary.ticketUrl || (channels[0] && channels[0].url) || '',
      ticketOpenAt: primary.ticketOpenAt || null,
      ticketOpenText: primary.ticketOpenText || '',
      performances: Object.keys(perfMap).sort().map(k => perfMap[k]),
      channels,
      resale: !!primary.resale
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
  // 平台源（并行）
  await Promise.all(sources.REGISTRY.map(async src => {
    if (!src.enabled) { status.push({ name: src.name, ok: false, skipped: true }); return; }
    try {
      const list = await src.search({ name, year, city });
      status.push({ name: src.name, ok: Array.isArray(list) && list.length > 0, count: (list || []).length });
      if (Array.isArray(list)) results.push(...list);
    } catch (e) {
      status.push({ name: src.name, ok: false, error: e.message });
    }
  }));
  // 搜索引擎兜底：360 优先（相关性好），空则必应
  let searchRef = [];
  let searchSrc = '';
  try {
    searchRef = await sources.so360.search({ name, year, city });
    if (searchRef.length) searchSrc = '360搜索';
  } catch (e) { /* ignore */ }
  if (!searchRef.length) {
    try {
      searchRef = await sources.bing.search({ name, year, city });
      if (searchRef.length) searchSrc = '必应搜索';
    } catch (e) { /* ignore */ }
  }
  if (searchSrc) status.push({ name: searchSrc, ok: true, count: searchRef.length });

  // 深度解析：抓取参考网页正文，直接提取开票时间/演出时间/场馆/票价
  let deepHits = 0;
  if (searchRef.length) {
    searchRef = await deep.analyze(searchRef, 4);
    deepHits = searchRef.filter(x => x.deep && (x.deep.openText || x.deep.showTimes.length)).length;
    if (deepHits) status.push({ name: '深度解析', ok: true, count: deepHits });
  }

  const merged = mergeResults(results, { city, year });
  const platformHits = merged.length;

  return {
    ok: platformHits > 0,
    name, city, year,
    list: merged,
    bing: searchRef,
    searchSrc,
    deepHits,
    status,
    ts: Date.now(),
    tips: buildTips(status, platformHits, searchRef.length, deepHits)
  };
}

function buildTips(status, hits, refCount, deepHits) {
  const tips = [];
  if (hits > 0) {
    tips.push('已从票务平台获取到该剧目信息，开票时间/场次以官方页面为准。');
  } else {
    tips.push('平台接口未能返回数据（多为平台反爬限制）。');
    if (deepHits > 0) {
      tips.push('已从相关网页中解析出开票时间/演出信息（见下方「🎫 已解析信息」），请核对后再抢票。');
    } else if (refCount > 0) {
      tips.push('已为你找到相关网页参考（下方列表），可点开官方/票务页面获取开票时间，或用「手动录入」补全。');
    } else {
      tips.push('搜索引擎此刻可能正被限流（间歇性反爬），建议等 1-2 分钟再试，或换关键词。');
    }
  }
  return tips;
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // 登录接口（无需鉴权）
  if (url.pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.password === PASSWORD) {
        const token = signToken(Date.now() + AUTH_MAX_AGE);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': COOKIE_NAME + '=' + token + '; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax'
        });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: '密码错误' }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: '请求格式错误' }));
    }
    return;
  }

  // 登录状态检查（无需鉴权）
  if (url.pathname === '/api/auth-status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: isAuthed(req) }));
    return;
  }

  // 未登录：所有其他请求返回登录页
  if (!isAuthed(req)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(loginPageHtml());
    return;
  }

  if (url.pathname === '/api/search') {
    try {
      const result = await handleSearch(Object.fromEntries(url.searchParams));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error('[api error]', e);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: '服务器内部错误: ' + e.message }));
    }
    return;
  }
  serveStatic(req, res);
});

// 端口被占用时自动向后顺延，避免启动崩溃
function listenWithFallback(server, port, attemptsLeft) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn('端口 ' + port + ' 被占用，改用 ' + (port + 1));
      listenWithFallback(server, port + 1, attemptsLeft - 1);
    } else {
      console.error('监听失败:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    console.log('🎭 音乐剧排期 & 抢票日历（网页版）已启动');
    console.log('   本地访问:  http://localhost:' + port);
    console.log('   搜索接口:  http://localhost:' + port + '/api/search?name=剧院魅影&city=上海');
  });
}
listenWithFallback(server, PORT, 10);
