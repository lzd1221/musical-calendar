// utils/notify.js —— 微信订阅消息封装
// 说明：娱乐类小程序只能用「一次性订阅消息」：用户每点一次「允许」= 该模板 1 次发送额度。
// 部署前：1) 在 mp.weixin.qq.com 申请订阅消息模板（类目选娱乐-演出类）并填入下方 ID；
//        2) 模板字段需与 cloudfunctions/sendNotify 中的 data 字段一一对应。
const TEMPLATES = {
  ticket: '请填入「开票提醒」模板ID',   // 字段建议：演出名称(thing)/开票时间(time)/温馨提示(thing)
  show: '请填入「开演提醒」模板ID'      // 字段建议：演出名称(thing)/演出时间(time)/场馆(thing)
};

// 用户点击触发：请求订阅（开票 + 开演 两个模板各一次授权）
// 返回 { accept: 授权成功的模板数, res }
function requestSubscribe() {
  return new Promise(resolve => {
    if (!wx.requestSubscribeMessage) { resolve({ accept: 0, unsupported: true }); return; }
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATES.ticket, TEMPLATES.show],
      success(res) {
        const accept = [TEMPLATES.ticket, TEMPLATES.show].filter(id => res[id] === 'accept').length;
        resolve({ accept, res });
      },
      fail(err) {
        // 用户拒绝或系统拦截：静默处理，不打断主流程
        resolve({ accept: 0, err });
      }
    });
  });
}

// 判断模板是否已配置（用于 UI 提示“请先配置模板ID”）
function configured() {
  return TEMPLATES.ticket.indexOf('请填入') === -1 && TEMPLATES.show.indexOf('请填入') === -1;
}

module.exports = { TEMPLATES, requestSubscribe, configured };
