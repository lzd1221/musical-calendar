// components/show-card/show-card.js
const dateUtil = require('../../utils/date.js');
Component({
  properties: {
    show: { type: Object, value: null },
    watched: { type: Boolean, value: false }
  },
  observers: {
    'show': function (s) { if (s) this.compute(s); }
  },
  data: {
    cdText: '--', cdHot: false, perfCount: 0, sourceText: '', ticketLabel: ''
  },
  methods: {
    compute(s) {
      const cd = dateUtil.countdown(s.ticketOpenAt);
      let sourceText = '';
      if (s.channels && s.channels.length) {
        const names = s.channels.map(c => c.platform).join(' / ');
        sourceText = '来源：' + names;
      } else if (s.platform) {
        sourceText = '来源：' + s.platform;
      }
      this.setData({
        cdText: cd.text,
        cdHot: cd.hot,
        perfCount: (s.performances || []).length,
        sourceText
      });
    },
    onTap() {
      if (!this.data.show || !this.data.show._id) return;
      wx.navigateTo({ url: '/pages/show/show?id=' + this.data.show._id });
    }
  }
});
