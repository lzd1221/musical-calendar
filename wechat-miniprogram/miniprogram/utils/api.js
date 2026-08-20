// utils/api.js —— 云函数调用封装
// 所有云函数名与入参约定（与 cloudfunctions/ 下实现一一对应）

function call(name, data) {
  return wx.cloud.callFunction({ name, data }).then(r => r.result);
}

// 按 剧名-年份-城市 搜索剧目（云函数内部：查缓存 → 多平台抓取 → 合并归一化）
function searchShow(payload) {
  return call('fetchShowInfo', Object.assign({ action: 'search' }, payload));
}

// 刷新单部剧目信息（开票时间/场次）
function refreshShow(showId) {
  return call('fetchShowInfo', { action: 'refresh', showId });
}

// 关注/取关/列表/订阅额度
function watchAction(payload) {
  return call('watchList', payload);
}
function watchAdd(showId) { return watchAction({ action: 'add', showId }); }
function watchRemove(showId) { return watchAction({ action: 'remove', showId }); }
function watchList() { return watchAction({ action: 'list' }); }
function watchSubscribe(showId, count) { return watchAction({ action: 'subscribe', showId, count }); }

// 用户补录/纠错（社区数据兜底：自动抓取失败时人工补开票时间/链接）
function submitCorrection(payload) {
  return watchAction({ action: 'correct', data: payload });
}

module.exports = {
  searchShow, refreshShow,
  watchAdd, watchRemove, watchList, watchSubscribe,
  submitCorrection
};
