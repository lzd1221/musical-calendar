// pages/notify/notify.js —— 提醒中心：即将开票/开演清单 + 一键订阅
const api = require('../../utils/api.js');
const dateUtil = require('../../utils/date.js');
const notifyUtil = require('../../utils/notify.js');

Page({
  data: {
    loading: true,
    ticketList: [],      // 即将开票（按时间排序）
    showList: [],        // 7 天内开演场次
    hasWatched: false,
    subHint: ''
  },
  onShow() { this.load(); },
  load() {
    this.setData({ loading: true });
    api.watchList().then(res => {
      const watched = res.list || [];
      const now = Date.now();
      const tickets = [];
      const shows = [];
      for (const s of watched) {
        if (s.ticketOpenAt && s.ticketOpenAt > now - 3600 * 1000) {
          tickets.push({
            showId: s._id, title: s.title,
            text: s.ticketOpenText || dateUtil.fmtDateTime(s.ticketOpenAt),
            cd: dateUtil.countdown(s.ticketOpenAt, now),
            past: s.ticketOpenAt <= now
          });
        }
        for (const p of (s.performances || [])) {
          const start = Date.parse(p.date + 'T' + (p.start || '00:00'));
          if (start > now && start < now + 7 * 86400000) {
            shows.push({
              showId: s._id, title: s.title, date: p.date, start: p.start, end: p.end, venue: p.venue,
              weekday: dateUtil.weekdayCn(p.date),
              cd: dateUtil.countdown(start, now)
            });
          }
        }
      }
      tickets.sort((a, b) => a.cd.ms - b.cd.ms);
      shows.sort((a, b) => Date.parse(a.date + 'T' + (a.start || '00:00')) - Date.parse(b.date + 'T' + (b.start || '00:00')));
      const configured = notifyUtil.configured();
      this.setData({
        loading: false,
        ticketList: tickets.slice(0, 10),
        showList: shows.slice(0, 20),
        hasWatched: watched.length > 0,
        subHint: configured ? '' : '⚠️ 尚未配置订阅消息模板 ID（见 README），以下按钮暂不可用。'
      });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },
  // 一键订阅最近的 1 个开票节点
  onSubscribeNext() {
    const next = this.data.ticketList.find(t => !t.past);
    if (!next) { wx.showToast({ title: '暂无可订阅的开票节点', icon: 'none' }); return; }
    if (this.data.subHint) {
      wx.showModal({ title: '提示', content: this.data.subHint, showCancel: false });
      return;
    }
    notifyUtil.requestSubscribe().then(({ accept }) => {
      if (accept > 0) {
        api.watchSubscribe(next.showId, accept).then(() => {
          wx.showToast({ title: '已为《' + next.title + '》订阅 ' + accept + ' 次提醒', icon: 'success' });
        });
      } else {
        wx.showToast({ title: '未授权，不会发送提醒', icon: 'none' });
      }
    });
  },
  goShow(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/show/show?id=' + id });
  },
  onPullDownRefresh() { this.load(); wx.stopPullDownRefresh(); }
});
