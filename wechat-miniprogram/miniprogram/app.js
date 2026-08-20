// app.js —— 全局入口
// 部署前必须把 globalData.env 换成你的云开发环境 ID（见 README 第 2 步）
App({
  globalData: {
    env: 'YOUR_ENV_ID',          // TODO: 替换为云开发环境 ID，如 'musical-xxxxxx'
    defaultCity: '上海',          // 默认城市，可在「我的」页修改
    watchedCacheKey: 'WATCHED_CACHE',
    searchHistoryKey: 'SEARCH_HISTORY'
  },
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库过低，请升级微信后重试');
      wx.showModal({ title: '提示', content: '当前微信版本过旧，请升级后使用', showCancel: false });
      return;
    }
    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true
    });
  }
});
