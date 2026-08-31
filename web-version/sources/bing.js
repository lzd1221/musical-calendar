// web-version/sources/bing.js —— 必应搜索兜底数据源
// 平台接口被反爬时，用公开搜索引擎抓取剧目的相关页面（标题/链接/摘要），
// 用户可据此手动打开官方页面获取开票信息。失败返回 []，不影响主流程。
const { getText } = require('./http.js');

const name = '必应搜索';
const enabled = true;

const ENDPOINTS = [
  'https://cn.bing.com/search?q={q}&setlang=zh-hans&mkt=zh-CN&cc=cn&count=10',
  'https://www.bing.com/search?q={q}&setlang=zh-hans&mkt=zh-CN&cc=cn&count=10'
];

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 解包必应跳转链接（https://www.bing.com/ck/a?...&u=a1<base64url>），降级页也可用
function unwrapUrl(url) {
  const m = String(url || '').match(/[?&]u=a1([A-Za-z0-9_\-]+)/);
  if (m) {
    try {
      const real = Buffer.from(m[1], 'base64url').toString('utf8');
      if (real.indexOf('http') === 0) return real;
    } catch (e) { /* ignore */ }
  }
  return url;
}

function parseResults(html) {
  const out = [];
  const liRe = /<li[^>]*class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const block = m[0];
    const a = block.match(/<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/);
    if (!a) continue;
    const url = unwrapUrl(a[1]);
    const title = stripHtml(a[2]);
    if (!url || !title || /bing\.com\/search|go\.microsoft/.test(url)) continue;
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = p ? stripHtml(p[1]) : '';
    out.push({ title, url, snippet });
    if (out.length >= 8) break;
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search({ name: keyword, year, city }) {
  // 剧名加引号精确匹配，减少泛化结果（如「剧院」概念页）
  const q = ('"' + keyword + '" ' + (year || '') + ' ' + (city || '') + ' 演出 开票 购票').trim();
  // 串行尝试端点 + 间隔，避免并发触发反爬降级
  let list = [];
  for (const base of ENDPOINTS) {
    const url = base.replace('{q}', encodeURIComponent(q));
    try {
      const html = await getText(url, {
        timeoutMs: 9000,
        headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' }
      });
      list = parseResults(html);
      if (list.length) break;
      // 结果过少（<3）视为被降级，换端点再试
      if (list.length < 3) list = [];
    } catch (e) {
      console.warn('[bing] fail:', e.message);
    }
    await sleep(2000);
  }
  // 按相关度排序：标题/URL 含完整剧名（去书名号）的排最前
  const kw = String(keyword || '').replace(/[《》]/g, '').trim();
  const score = it => {
    const hay = (it.title + ' ' + it.url);
    if (kw && hay.indexOf(kw) > -1) return 3;
    return 0;
  };
  list.sort((a, b) => score(b) - score(a));
  return list;
}

module.exports = { name, enabled, search };
