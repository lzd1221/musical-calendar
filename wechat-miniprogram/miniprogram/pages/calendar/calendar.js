// pages/calendar/calendar.js —— 排期日历：已关注剧目月历 + 撞期/上班冲突提示 + 即将开票
const api = require('../../utils/api.js');
const dateUtil = require('../../utils/date.js');

function st(p) { return Date.parse(p.date + 'T' + (p.start || '00:00')) / 60000; }
function en(p) {
  const s = (p.start || '').split(':').map(Number);
  const e = (p.end || p.start || '').split(':').map(Number);
  return Date.parse(p.date + 'T' + (p.end || p.start)) / 60000 + ((e[0] * 60 + e[1]) <= (s[0] * 60 + s[1]) ? 1440 : 0);
}
function perfOverlap(a, b) { return a.date === b.date && st(a) < en(b) && st(b) < en(a); }
// 与上班时间冲突（默认工作日 09:00-18:00，可在代码中调整）
function workConflict(p) {
  const d = new Date(p.date + 'T00:00:00').getDay();
  if (d === 0 || d === 6) return false;
  const ps = (p.start || '00:00').split(':').map(Number);
  const pe = (p.end || p.start || '00:00').split(':').map(Number);
  const sMin = ps[0] * 60 + ps[1], eMin = pe[0] * 60 + pe[1];
  return sMin < 18 * 60 && eMin > 9 * 60;
}

Page({
  data: {
    loading: true,
    offset: 0,              // 相对当前月的偏移（0=本月，-1=上月…）
    label: '',
    cells: [],              // [{ day: 'YYYY-MM-DD'|null, perfs: [{show, perf, conflict}] }]
    conflictList: [],
    ticketSoon: [],
    today: ''
  },
  onShow() { this.load(); },
  load() {
    this.setData({ loading: true });
    api.watchList().then(res => {
      const watched = (res.list || []).map(s => Object.assign({}, s, {
        performances: (s.performances || []).map(p => Object.assign({}, p, {
          weekday: p.date ? dateUtil.weekdayCn(p.date) : ''
        }))
      }));
      this.setData({ watched });
      this.buildMonth();
      this.buildTicketSoon();
      this.setData({ loading: false });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },
  prevMonth() { this.setData({ offset: this.data.offset - 1 }); this.buildMonth(); },
  nextMonth() { this.setData({ offset: this.data.offset + 1 }); this.buildMonth(); },
  backToday() { this.setData({ offset: 0 }); this.buildMonth(); },

  buildMonth() {
    const watched = this.data.watched || [];
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth() + this.data.offset, 1);
    const y = base.getFullYear(), m = base.getMonth() + 1;
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDow = base.getDay();
    const offset = (firstDow + 6) % 7; // 周一起始
    const today = dateUtil.fmtDate(Date.now());

    const perfsOfDay = d => {
      const list = [];
      for (const s of watched) for (const p of (s.performances || []))
        if (p.date === d) list.push({ show: s, perf: p });
      list.sort((a, b) => (a.perf.start || '').localeCompare(b.perf.start || ''));
      return list;
    };

    const cells = [];
    for (let i = 0; i < offset; i++) cells.push({ day: null, perfs: [] });
    for (let day = 1; day <= daysInMonth; day++) {
      const d = y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const list = perfsOfDay(d);
      // 撞期标记：同一天内不同剧目的场次时间重叠
      const marked = [];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
        if (perfOverlap(list[i].perf, list[j].perf)) { marked.push(list[i].perf.id || i); marked.push(list[j].perf.id || j); }
      const perfs = list.map((it, idx) => ({
        show: it.show, perf: it.perf,
        conflict: marked.indexOf(it.perf.id || idx) > -1,
        work: workConflict(it.perf),
        isToday: d === today
      }));
      cells.push({
        day: d,
        dayNum: day,
        isToday: d === today,
        perfs
      });
    }
    // 剩余补全
    while (cells.length % 7 !== 0) cells.push({ day: null, perfs: [] });

    // 本月冲突清单
    const conflictList = [];
    for (const c of cells) {
      if (!c.day) continue;
      const list = perfsOfDay(c.day);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        if (perfOverlap(list[i].perf, list[j].perf))
          conflictList.push(dateUtil.fmtCnDate(c.day) + ' ' + (list[i].perf.start || '') + ' 《' + list[i].show.title + '》 ↔ 《' + list[j].show.title + '》撞期');
      }
      for (const it of list) if (workConflict(it.perf))
        conflictList.push(dateUtil.fmtCnDate(c.day) + ' ' + (it.perf.start || '') + ' 《' + it.show.title + '》与上班时间重叠');
    }

    this.setData({
      label: y + '年' + m + '月',
      cells,
      conflictList
    });
  },

  buildTicketSoon() {
    const watched = this.data.watched || [];
    const now = Date.now();
    const ticketSoon = watched
      .filter(s => s.ticketOpenAt && s.ticketOpenAt > now)
      .map(s => ({
        showId: s._id, title: s.title,
        text: s.ticketOpenText || dateUtil.fmtDateTime(s.ticketOpenAt),
        cd: dateUtil.countdown(s.ticketOpenAt, now)
      }))
      .sort((a, b) => a.cd.ms - b.cd.ms)
      .slice(0, 5);
    this.setData({ ticketSoon });
  },

  tapPerf(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/show/show?id=' + id });
  },
  goShow(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/show/show?id=' + id });
  }
});
