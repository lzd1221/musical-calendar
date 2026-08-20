// cloudfunctions/sendNotify/index.js —— 订阅消息发送
// 由 refreshShowData 定时触发调用（也可在云开发控制台手动测试）。
//
// ★★★ 部署前必改 ★★★
// 1) 到 mp.weixin.qq.com「订阅消息」申请两个模板（类目：娱乐-演出票务）：
//    - 「开票提醒」模板：字段建议 演出名称(thing) / 开票时间(time) / 温馨提示(thing)
//    - 「开演提醒」模板：字段建议 演出名称(thing) / 演出时间(time) / 场馆(thing)
// 2) 把模板 ID 填入下方 TEMPLATES。
// 3) 字段 key（thing1/time2/thing3）需与你申请模板的字段顺序一致。
//    微信字段类型限制：thing 最多 20 个中文字符，time 传 "2025-06-01 10:00"。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TEMPLATES = {
  ticket: '填写「开票提醒」模板ID',
  show: '填写「开演提醒」模板ID'
};

function cut(s, n) { return String(s || '').slice(0, n); }

// 开票提醒数据（字段顺序以申请模板为准）
function ticketData(show, stage) {
  let tip = '开票前提醒，准时开抢！';
  if (stage === 'day') tip = '明天开票，别忘了！';
  if (stage === 'open') tip = '已开票，快去抢！';
  return {
    thing1: { value: cut(show.title, 20) },
    time2: { value: show.ticketOpenText || '即将公布' },
    thing3: { value: tip }
  };
}

// 开演提醒数据
function showData(show, perf) {
  perf = perf || {};
  return {
    thing1: { value: cut(show.title, 20) },
    time2: { value: (perf.date || '') + ' ' + (perf.start || '') },
    thing3: { value: cut(perf.venue || '演出即将开始，记得前往！', 20) }
  };
}

exports.main = async (event) => {
  const { type, showId, perfIndex, stage } = event;
  const tmplId = TEMPLATES[type];
  if (!tmplId || tmplId.indexOf('填写') > -1) return { ok: false, msg: '模板未配置' };
  const sr = await db.collection('shows').doc(showId).get().catch(() => null);
  if (!sr || !sr.data) return { ok: false, msg: '剧目不存在' };
  const show = sr.data;

  // 有剩余订阅额度的用户
  const subs = await db.collection('user_sub')
    .where({ showId, count: _.gt(0) })
    .limit(100)
    .get();

  let sent = 0;
  for (const s of subs.data) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: s._openid,
        templateId: tmplId,
        page: 'pages/show/show?id=' + showId,
        miniprogramState: 'formal',
        data: type === 'ticket' ? ticketData(show, stage) : showData(show, (show.performances || [])[perfIndex || 0])
      });
      await db.collection('user_sub').doc(s._id).update({ data: { count: _.inc(-1), lastSentAt: Date.now() } });
      sent++;
    } catch (e) {
      console.warn('[send fail]', s._openid, e.errCode, e.errMsg || e.message);
      // 43101/拒绝：用户已取消订阅，扣减额度避免反复尝试
      if (e.errCode === 43101 || /refuse|deny|not allow/i.test(e.errMsg || '')) {
        await db.collection('user_sub').doc(s._id).update({ data: { count: _.inc(-1) } }).catch(() => {});
      }
    }
  }
  return { ok: true, sent, skipped: subs.data.length - sent };
};
