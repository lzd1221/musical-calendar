// pages/show/show.js —— 剧目详情：抢票平台/链接、开票倒计时、场次、订阅提醒、补录纠错
const api = require('../../utils/api.js');
const dateUtil = require('../../utils/date.js');
const notifyUtil = require('../../utils/notify.js');

Page({
  data: {
    loading: true,
    draft: false,            // 草稿模式：搜索无结果时手动录入
    draftTitle: '',
    draftCity: '上海',
    draftYear: '',
    show: null,
    watched: false,
    subCount: 0,
    cd: { text: '--', hot: false, past: false },
    conflicts: [],           // 与已关注剧目的撞期提示
    f: { platform: '大麦', ticketUrl: '', ticketOpenText: '', perfText: '' }
  },
  onLoad(options) {
    if (options.draft) {
      this.setData({
        draft: true, loading: false,
        draftTitle: options.title ? decodeURIComponent(options.title) : '',
        draftCity: options.city ? decodeURIComponent(options.city) : '上海',
        draftYear: options.year || ''
      });
    } else if (options.id) {
      this.loadShow(options.id);
    } else {
      this.setData({ loading: false });
    }
  },
  onShow() {
    if (this.data.show && this.data.show.ticketOpenAt) this.tick();
    this.startTicker();
  },
  onHide() { this.stopTicker(); },
  onUnload() { this.stopTicker(); },
  startTicker() {
    this.stopTicker();
    this.timer = setInterval(() => this.tick(), 1000);
  },
  stopTicker() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
  tick() {
    if (this.data.show && this.data.show.ticketOpenAt) {
      this.setData({ cd: dateUtil.countdown(this.data.show.ticketOpenAt) });
    }
  },

  loadShow(id) {
    this.setData({ loading: true });
    api.watchAction({ action: 'get', showId: id }).then(res => {
      const show = res.show ? this.decorate(res.show) : null;
      this.setData({
        loading: false, show,
        watched: !!res.watched,
        subCount: res.subCount || 0,
        cd: show && show.ticketOpenAt ? dateUtil.countdown(show.ticketOpenAt) : { text: '未公布', hot: false, past: false },
        conflicts: this.computeConflicts(show, (res.watchedList || []).map(this.decorate.bind(this)))
      });
      this.tick();
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  // 补充场次展示字段（星期等）
  decorate(show) {
    if (!show) return show;
    const perfs = (show.performances || []).map(p => Object.assign({}, p, {
      weekday: p.date ? dateUtil.weekdayCn(p.date) : ''
    }));
    return Object.assign({}, show, { performances: perfs });
  },

  // 撞期检测：本剧场次 vs 其它已关注剧目场次（同日期且时间重叠）
  computeConflicts(show, watchedList) {
    if (!show || !show.performances || !show.performances.length) return [];
    const out = [];
    const st = p => Date.parse(p.date + 'T' + (p.start || '00:00')) / 60000;
    const en = p => Date.parse(p.date + 'T' + (p.end || p.start)) / 60000 + (p.end && p.end <= p.start ? 1440 : 0);
    for (const w of watchedList) {
      if (!w || w._id === show._id || !w.performances) continue;
      for (const p of show.performances) for (const q of w.performances) {
        if (!q.date || !p.date) continue;
        if (p.date === q.date && st(p) < en(q) && st(q) < en(p)) {
          out.push({ label: dateUtil.fmtCnDate(p.date) + ' ' + (p.start || '?') + ' 与《' + (w.title || '') + '》' + (q.start || '') + '场撞期' });
        }
      }
    }
    return out;
  },

  onToggleWatch() {
    const show = this.data.show;
    if (!show) return;
    const next = !this.data.watched;
    const fn = next ? api.watchAdd : api.watchRemove;
    fn(show._id).then(() => {
      this.setData({ watched: next });
      wx.showToast({ title: next ? '已加入关注（用于日历与提醒）' : '已取消关注', icon: 'none' });
    }).catch(() => wx.showToast({ title: '操作失败', icon: 'none' }));
  },

  onSubscribe() {
    const show = this.data.show;
    if (!show || !show._id) return;
    if (!notifyUtil.configured()) {
      wx.showModal({
        title: '尚未配置订阅模板',
        content: '需在 miniprogram/utils/notify.js 与 cloudfunctions/sendNotify 中填入订阅消息模板 ID（见 README 部署步骤）。',
        showCancel: false
      });
      return;
    }
    notifyUtil.requestSubscribe().then(({ accept }) => {
      if (accept > 0) {
        api.watchSubscribe(show._id, accept).then(() => {
          this.setData({ subCount: this.data.subCount + accept });
          wx.showToast({ title: '已订阅 ' + accept + ' 次提醒额度', icon: 'success' });
        });
      } else {
        wx.showToast({ title: '未授权，将不会收到该剧提醒', icon: 'none' });
      }
    });
  },

  onCopyUrl() {
    const url = this.data.show && this.data.show.ticketUrl;
    if (!url) { wx.showToast({ title: '暂无购票链接', icon: 'none' }); return; }
    wx.setClipboardData({
      data: url,
      success() { wx.showToast({ title: '已复制，去浏览器/平台抢票', icon: 'none' }); }
    });
  },
  onCopyChannel(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({ data: url });
  },

  /* ---- 补录表单 ---- */
  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['f.' + field]: e.detail.value });
  },
  onPlatformChange(e) {
    const platforms = ['大麦', '猫眼', '保利票务', '剧院官网', '其他'];
    this.setData({ 'f.platform': platforms[+e.detail.value] });
  },
  onDraftInput(e) {
    this.setData({ draftTitle: e.detail.value });
  },
  onDraftSubmit() {
    const title = (this.data.draftTitle || '').trim();
    if (!title) { wx.showToast({ title: '请填写剧名', icon: 'none' }); return; }
    const f = this.data.f;
    api.submitCorrection({
      title,
      city: this.data.draftCity,
      year: this.data.draftYear,
      platform: f.platform,
      ticketUrl: f.ticketUrl.trim(),
      ticketOpenText: f.ticketOpenText.trim(),
      perfText: f.perfText.trim(),
      source: 'manual'
    }).then(res => {
      if (res && res.showId) {
        wx.showToast({ title: '已保存并加入关注', icon: 'success' });
        setTimeout(() => wx.redirectTo({ url: '/pages/show/show?id=' + res.showId }), 600);
      } else {
        wx.showToast({ title: '提交失败', icon: 'none' });
      }
    }).catch(() => wx.showToast({ title: '提交失败，请检查网络', icon: 'none' }));
  },
  openNotifyGuide() { wx.navigateTo({ url: '/pages/notify/notify' }); }
});
