// web-version/server.js —— 本地网页版后端
// 功能：
//   1) 静态服务 web-version/public 目录（浏览器访问 http://localhost:8765）
//   2) GET /api/search?name=剧名&city=城市&year=年份
//      -> 多平台真实抓取（大麦/猫眼/保利/摩天轮票牛）+ 必应搜索兜底
//      -> 返回各来源状态、命中剧目、必应参考链接；爬不到时前端有明确提示
// 启动：node web-version/server.js   然后浏览器打开 http://localhost:8765
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const sources = require('./sources/index.js');
const { showKey, primaryScore } = require('./sources/normalize.js');

const PORT = Number(process.env.PORT || 8765);
const PUBLIC_DIR = path.join(__dirname, 'public');

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

  const merged = mergeResults(results, { city, year });
  const platformHits = merged.length;

  return {
    ok: platformHits > 0,
    name, city, year,
    list: merged,
    bing: searchRef,
    searchSrc,
    status,
    ts: Date.now(),
    tips: buildTips(status, platformHits, searchRef.length)
  };
}

function buildTips(status, hits, refCount) {
  const tips = [];
  if (hits > 0) {
    tips.push('已从票务平台获取到该剧目信息，开票时间/场次以官方页面为准。');
  } else {
    tips.push('平台接口未能返回数据（多为平台反爬限制）。');
    if (refCount > 0) {
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

server.listen(PORT, () => {
  console.log('🎭 音乐剧排期 & 抢票日历（网页版）已启动');
  console.log('   本地访问:  http://localhost:' + PORT);
  console.log('   搜索接口:  http://localhost:' + PORT + '/api/search?name=剧院魅影&city=上海');
});
