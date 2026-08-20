// cloudfunctions/fetchShowInfo/sources/index.js —— 数据源注册表与并发分发
// 五大数据源：
//   1) 大麦 Damai        —— 一手主流票务（含巡演排期）
//   2) 猫眼 Maoyan       —— 一手主流票务
//   3) 保利票务 Polly    —— 剧院院线官方票务
//   4) 剧院官网 Theater  —— 官方渠道（场馆→官方链接 enrich + 官方接口尝试）
//   5) 摩天轮/票牛 Resale—— 二手/比价平台（降权展示，标注滞后风险）
const damai = require('./damai.js');
const maoyan = require('./maoyan.js');
const polly = require('./polly.js');
const theater = require('./theater.js');
const resale = require('./resale.js');

const REGISTRY = [damai, maoyan, polly, theater, resale];

// 并发运行所有启用的数据源；单个源失败不影响其他源
async function runAll(params) {
  const results = [];
  await Promise.all(REGISTRY.map(async src => {
    if (!src.enabled) return;
    try {
      const list = await src.search(params);
      if (Array.isArray(list)) {
        for (const item of list) results.push(Object.assign({ source: src.name }, item));
      }
    } catch (e) {
      console.warn('[source:' + src.name + ']', e.message);
    }
  }));
  return results;
}

module.exports = { runAll, REGISTRY };
