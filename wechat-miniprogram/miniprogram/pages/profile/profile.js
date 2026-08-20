// pages/profile/profile.js —— 我的：关注列表、默认城市、关于
const api = require('../../utils/api.js');
const store = require('../../utils/store.js');

const CITY_OPTIONS = ['上海','北京','广州','深圳','杭州','南京','苏州','成都','重庆','武汉','西安','长沙','天津','青岛','其他'];

Page({
  data: {
    city: '上海',
    cityIndex: 0,
    cityOptions: CITY_OPTIONS,
    watched: [],
    loading: true
  },
  onLoad() {
    const city = store.getDefaultCity();
    this.setData({
      city,
      cityIndex: Math.max(0, CITY_OPTIONS.indexOf(city))
    });
  },
  onShow() { this.loadWatched(); },
  loadWatched() {
    this.setData({ loading: true });
    api.watchList().then(res => {
      const watched = (res.list || []).map(s => ({
        _id: s._id,
        title: s.title,
        city: s.city,
        year: s.year,
        perfCount: (s.performances || []).length,
        ticketOpenText: s.ticketOpenText || '',
        upcoming: !!(s.ticketOpenAt && s.ticketOpenAt > Date.now())
      }));
      this.setData({ watched, loading: false });
    }).catch(() => this.setData({ loading: false }));
  },
  onCityChange(e) {
    const city = CITY_OPTIONS[+e.detail.value];
    store.setDefaultCity(city);
    this.setData({ city, cityIndex: +e.detail.value });
    wx.showToast({ title: '默认城市：' + city, icon: 'none' });
  },
  removeWatch(e) {
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title;
    wx.showModal({
      title: '取消关注',
      content: '确定取消关注《' + title + '》吗？将不再参与日历与提醒。',
      success: res => {
        if (res.confirm) {
          api.watchRemove(id).then(() => {
            this.loadWatched();
            wx.showToast({ title: '已取消关注', icon: 'none' });
          });
        }
      }
    });
  },
  goShow(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/show/show?id=' + id });
  },
  goNotify() { wx.navigateTo({ url: '/pages/notify/notify' }); },
  clearHistory() {
    store.clearSearchHistory();
    wx.showToast({ title: '搜索历史已清空', icon: 'none' });
  },
  showAbout() {
    wx.showModal({
      title: '关于',
      content: '本工具自动聚合公开票务渠道的开票/排期信息，仅供个人看剧规划参考；一切以官方渠道为准。数据获取受平台反爬限制，如有出入可手动补录纠错。',
      showCancel: false
    });
  }
});
