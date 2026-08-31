// web-version/sources/so360.js —— 360 搜索兜底数据源（相关性最好的搜索引擎兜底）
// 平台接口被反爬时，用 360 搜索抓取剧目的相关页面（标题/真实链接/摘要/日期）。
// 结果块 <li class="res-list">，真实链接在 a[data-mdurl]，摘要 span.res-list-summary。
const { getText } = require('./http.js');

const name = '360搜索';
const enabled = true;

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseResults(html) {
  const out = [];
  const liRe = /<li[^>]*class="[^"]*res-list[^"]*"[\s\S]*?<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const block = m[0];
    const a = block.match(/<h3[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/);
    if (!a) continue;
    const md = block.match(/data-mdurl="([^"]+)"/);
    const url = (md && md[1]) || a[1];
    const title = stripHtml(a[2]);
    if (!url || !title) continue;
    const p = block.match(/<span class="res-list-summary">([\s\S]*?)<\/span>/);
    const snippet = p ? stripHtml(p[1]) : '';
    const dt = block.match(/<span class="g-c-gray">([^<]*)<\/span>/);
    const date = dt ? dt[1].trim() : '';
    out.push({ title, url, snippet, date });
    if (out.length >= 8) break;
  }
  return out;
}

// 桌面浏览器特征请求头（降低被搜索引擎风控识别为爬虫的概率）
const DESKTOP_HEADERS = {
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://www.so.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

async function search({ name: keyword, year, city }) {
  // 剧名加引号精确匹配，提升相关性
  const q = ('"' + keyword + '" ' + (year || '') + ' ' + (city || '') + ' 演出 开票 购票').trim();
  try {
    const url = 'https://www.so.com/s?q=' + encodeURIComponent(q) + '&pn=1';
    const html = await getText(url, {
      timeoutMs: 9000,
      headers: DESKTOP_HEADERS
    });
    const list = parseResults(html);
    // 按相关度排序：标题/URL 含完整剧名的排最前
    const kw = String(keyword || '').replace(/[《》]/g, '').trim();
    const score = it => {
      const hay = (it.title + ' ' + it.url);
      if (kw && hay.indexOf(kw) > -1) return 3;
      return 0;
    };
    list.sort((a, b) => score(b) - score(a));
    return list;
  } catch (e) {
    console.warn('[so360] fail:', e.message);
    return [];
  }
}

module.exports = { name, enabled, search };
