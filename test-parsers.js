// 解析逻辑测试：票务平台时间文本解析 + 手动补录场次解析 + 倒计时
// 运行：node test-parsers.js
"use strict";
const assert = require('assert');
const norm = require('./wechat-miniprogram/cloudfunctions/fetchShowInfo/sources/normalize.js');
const dateUtil = require('./wechat-miniprogram/miniprogram/utils/date.js');

let n = 0;
function t(name, fn) {
  n++;
  try { fn(); console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}
console.log('解析逻辑测试：');

t('parseShowTime: 单场 "2025.06.20 周五 19:30"', () => {
  const r = norm.parseShowTime('2025.06.20 周五 19:30');
  assert.deepStrictEqual(r, [{ date: '2025-06-20', start: '19:30', end: '' }]);
});
t('parseShowTime: 横杠日期 "2025-06-20 19:30"', () => {
  const r = norm.parseShowTime('2025-06-20 19:30');
  assert.strictEqual(r[0].date, '2025-06-20');
  assert.strictEqual(r[0].start, '19:30');
});
t('parseShowTime: 区间 "2025.06.20-2025.06.22 周五-周日 19:30" 拆成 3 场', () => {
  const r = norm.parseShowTime('2025.06.20-2025.06.22 周五-周日 19:30');
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].date, '2025-06-20');
  assert.strictEqual(r[2].date, '2025-06-22');
});
t('parseShowTime: 无日期文本返回空', () => {
  assert.deepStrictEqual(norm.parseShowTime('常年演出'), []);
  assert.deepStrictEqual(norm.parseShowTime(''), []);
});
t('parseShowTime: 多日多时间（多场）', () => {
  const r = norm.parseShowTime('2025.06.20 周五 19:30 2025.06.21 周六 14:00');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[1].start, '14:00');
});
t('parsePerfLines: 手动补录文本解析', () => {
  const r = norm.parsePerfLines('2025-06-20 19:30 上海文化广场\n2025.6.21 14:00 上音歌剧院');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].venue, '上海文化广场');
  assert.strictEqual(r[1].date, '2025-06-21');
});
t('fuzzyMatch: 带书名号与不带书名号匹配', () => {
  assert.ok(norm.fuzzyMatch('《剧院魅影》', '剧院魅影'));
  assert.ok(norm.fuzzyMatch('剧院魅影', '《剧院魅影》'));
  assert.ok(!norm.fuzzyMatch('悲惨世界', '剧院魅影'));
});
t('showKey 归一化', () => {
  assert.strictEqual(norm.showKey('《剧院魅影》', '上海', '2025'), norm.showKey('剧院魅影', '上海', '2025'));
});
t('date.js countdown 格式', () => {
  const now = Date.now();
  const c1 = dateUtil.countdown(now + 3600 * 1000 + 60000, now);
  assert.strictEqual(c1.text, '01:01:00');
  const c2 = dateUtil.countdown(now + 3 * 86400000, now);
  assert.match(c2.text, /^3天/);
  const c3 = dateUtil.countdown(now - 1000, now);
  assert.strictEqual(c3.past, true);
});
t('date.js 星期/日期格式化', () => {
  assert.strictEqual(dateUtil.weekdayCn('2025-07-05'), '周六');
  assert.strictEqual(dateUtil.fmtCnDate('2025-06-20'), '6月20日');
  assert.ok(dateUtil.isWeekend('2025-07-05'));
  assert.ok(!dateUtil.isWeekend('2025-07-07'));
});
t('date.js 跨夜场次结束时间', () => {
  // 内部按 Date.parse 比较，23:30 跨夜不误伤次日场次（客户端由页面逻辑处理，这里验证解析层不报错）
  const r = norm.parseShowTime('2025.06.20 周五 23:30');
  assert.strictEqual(r[0].start, '23:30');
});

/* ---- 五源适配器逻辑（纯函数部分） ---- */
const theater = require('./wechat-miniprogram/cloudfunctions/fetchShowInfo/sources/theater.js');
const resale = require('./wechat-miniprogram/cloudfunctions/fetchShowInfo/sources/resale.js');

t('theater.enrich: 按场馆追加官方购票渠道', () => {
  const show = { title: '《剧院魅影》', performances: [{ venue: '上海文化广场' }, { venue: '上海大剧院' }], channels: [] };
  theater.enrich(show);
  const labels = show.channels.map(c => c.platform);
  assert.ok(labels.indexOf('官方·上海文化广场') > -1, '应追加文化广场官方渠道，实际: ' + labels.join(','));
  assert.ok(labels.indexOf('官方·上海大剧院') > -1, '应追加上海大剧院官方渠道');
  assert.ok(show.channels.every(c => c.official === true));
});
t('theater.enrich: 幂等，不重复添加', () => {
  const show = { title: 'A', performances: [{ venue: '上海文化广场' }], channels: [] };
  theater.enrich(show);
  const n1 = show.channels.length;
  theater.enrich(show);
  assert.strictEqual(show.channels.length, n1);
});
t('theater.enrich: 场馆不匹配时不追加', () => {
  const show = { title: 'A', performances: [{ venue: '某小剧场' }], channels: [] };
  theater.enrich(show);
  assert.strictEqual(show.channels.length, 0);
});
t('resale 适配器模块可加载（含候选接口链配置）', () => {
  assert.strictEqual(typeof resale.search, 'function');
  assert.strictEqual(resale.enabled, true);
});
t('primaryScore: 二手平台降权，一手渠道优先', () => {
  const base = { ticketOpenAt: null, manual: false, performances: [], platform: '' };
  const damai = norm.primaryScore(Object.assign({}, base, { platform: '大麦' }));
  const resaleScore = norm.primaryScore(Object.assign({}, base, { platform: '摩天轮', resale: true }));
  const maoyan = norm.primaryScore(Object.assign({}, base, { platform: '猫眼' }));
  assert.ok(damai > resaleScore, '大麦应高于摩天轮');
  assert.ok(maoyan > resaleScore, '猫眼应高于摩天轮');
});
t('pick: 字段候选提取', () => {
  assert.strictEqual(norm.pick({ name: 'A', title: 'B' }, ['title', 'name']), 'B');
  assert.strictEqual(norm.pick({ name: 'A' }, ['title', 'name']), 'A');
  assert.strictEqual(norm.pick({}, ['title', 'name']), '');
});

console.log(n + ' 组测试完成' + (process.exitCode ? '（存在失败）' : '，全部通过 ✅'));
