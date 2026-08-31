// web-version/sources/index.js —— 数据源注册表（网页版）
const damai = require('./damai.js');
const maoyan = require('./maoyan.js');
const polly = require('./polly.js');
const resale = require('./resale.js');
const shct = require('./shct.js');
const shgt = require('./shgt.js');
const so360 = require('./so360.js');
const bing = require('./bing.js');

const REGISTRY = [damai, maoyan, polly, resale, shct, shgt];

// 并发运行平台源；单个源失败不影响其他源
async function runAll(params) {
  const results = [];
  await Promise.all(REGISTRY.map(async src => {
    if (!src.enabled) return;
    try {
      const list = await src.search(params);
      if (Array.isArray(list)) for (const item of list) results.push(item);
    } catch (e) {
      console.warn('[source:' + src.name + ']', e.message);
    }
  }));
  return results;
}

module.exports = { runAll, REGISTRY, so360, bing };
