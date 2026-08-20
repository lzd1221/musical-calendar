// cloudfunctions/fetchShowInfo/sources/http.js —— 简单 HTTP 请求封装（Node https）
const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

function request(url, options = {}, timeoutMs = 10000, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects: ' + url));
    const mod = url.indexOf('https') === 0 ? https : http;
    const t = (options && options.timeoutMs) || timeoutMs;
    const req = mod.get(url, Object.assign({
      headers: Object.assign({
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }, options.headers || {})
    }, options), res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        // 自动跟随重定向
        if ([301, 302, 303, 307, 308].indexOf(res.statusCode) > -1 && res.headers.location) {
          let loc = res.headers.location;
          if (loc.indexOf('://') === -1) loc = new URL(loc, url).href;
          return request(loc, options, t, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        resolve({ status: res.statusCode, body: buf, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(t, () => req.destroy(new Error('timeout ' + url)));
  });
}

async function getJSON(url, options) {
  const r = await request(url, options);
  return JSON.parse(r.body);
}
async function getText(url, options) {
  const r = await request(url, options);
  return r.body;
}

module.exports = { request, getJSON, getText, UA };
