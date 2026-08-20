// pages/index/index.js —— 首页：剧名-年份-城市 搜索
const api = require('../../utils/api.js');
const store = require('../../utils/store.js');
const dateUtil = require('../../utils/date.js');

const CITY_OPTIONS = ['上海','北京','广州','深圳','杭州','南京','苏州','成都','重庆','武汉','西安','长沙','天津','青岛','其他'];
const HOT_KEYWORDS = ['剧院魅影','悲惨世界','汉密尔顿','摇滚莫扎特','巴黎圣母院','罗密欧与朱丽叶','基督山伯爵','道林格雷的画像','桑塔露琪亚','献给阿尔吉侬的花束'];

Page({
  data: {
    keyword: '',
    city: '上海',
    cityIndex: 0,
    cityOptions: CITY_OPTIONS,
    yearOptions: ['不限'],
    yearIndex: 0,
    history: [],
    hotKeywords: HOT_KEYWORDS,
    searched: false,
    searching: false,
    results: [],
    sourcesTip: '',
    watchedMap: {}
  },
  onLoad() {
    const city = store.getDefaultCity();
    const cIdx = Math.max(0, CITY_OPTIONS.indexOf(city));
    // 年份：当前年 ~ 后两年
    const y = new Date().getFullYear();
    this.setData({
      city,
      cityIndex: cIdx,
      yearOptions: ['不限', String(y), String(y + 1), String(y + 2)],
      history: store.getSearchHistory()
    });
  },
  onShow() {
    this.refreshWatchedMap();
  },
  refreshWatchedMap() {
    api.watchList().then(res => {
      const map = {};
      (res.list || []).forEach(w => { map[w.showId] = true; });
      this.setData({ watchedMap: map });
    }).catch(() => {});
  },
  onKeywordInput(e) { this.setData({ keyword: e.detail.value }); },
  onCityChange(e) {
    const city = CITY_OPTIONS[+e.detail.value];
    store.setDefaultCity(city);
    this.setData({ city, cityIndex: +e.detail.value });
  },
  onYearChange(e) { this.setData({ yearIndex: +e.detail.value }); },
  onHotTap(e) {
    this.setData({ keyword: e.currentTarget.dataset.name });
    this.onSearch();
  },
  onHistoryTap(e) {
    const h = e.currentTarget.dataset.item;
    this.setData({
      keyword: h.name,
      city: h.city || '上海',
      cityIndex: Math.max(0, CITY_OPTIONS.indexOf(h.city || '上海')),
      yearIndex: h.year ? this.data.yearOptions.indexOf(h.year) : 0
    });
    this.onSearch();
  },
  clearHistory() {
    store.clearSearchHistory();
    this.setData({ history: [] });
  },
  onSearch() {
    const name = (this.data.keyword || '').trim();
    if (!name) { wx.showToast({ title: '请输入剧名', icon: 'none' }); return; }
    const city = this.data.city;
    const yearOpt = this.data.yearOptions[this.data.yearIndex];
    const year = yearOpt === '不限' ? '' : yearOpt;
    store.addSearchHistory({ name, city, year: yearOpt });
    this.setData({ searched: true, searching: true, results: [], sourcesTip: '' });
    api.searchShow({ name, year, city }).then(res => {
      const list = (res.list || []).map(this.normalize.bind(this));
      this.setData({
        searching: false,
        results: list,
        sourcesTip: res.sourcesTip || '',
        history: store.getSearchHistory()
      });
    }).catch(() => {
      this.setData({ searching: false });
      wx.showToast({ title: '查询失败，请稍后重试', icon: 'none' });
    });
  },
  normalize(s) {
    const cd = dateUtil.countdown(s.ticketOpenAt);
    return Object.assign({}, s, {
      cdText: cd.text,
      cdHot: cd.hot,
      perfCount: (s.performances || []).length,
      watched: !!this.data.watchedMap[s._id]
    });
  },
  goDraft() {
    // 没搜到？手动录入 → 详情页草稿模式
    const name = (this.data.keyword || '').trim();
    const city = this.data.city;
    const year = this.data.yearOptions[this.data.yearIndex] === '不限' ? '' : this.data.yearOptions[this.data.yearIndex];
    wx.navigateTo({ url: '/pages/show/show?draft=1&title=' + encodeURIComponent(name) + '&city=' + encodeURIComponent(city) + '&year=' + year });
  },
  onPullDownRefresh() {
    if (this.data.searched) { this.onSearch(); }
    wx.stopPullDownRefresh();
  }
});
