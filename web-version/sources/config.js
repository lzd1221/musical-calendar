// cloudfunctions/fetchShowInfo/sources/config.js —— 数据源集中配置
// ★ 部署后在此调整（在微信开发者工具中修改并重新上传该云函数即可生效）。
//
// 【当前实测结论（2025-06 本机探测）】
//   大麦 searchajax  → 已被阿里 x5sec 反爬拦截（返回 JS 挑战页）
//   猫眼 ajax/search → WAF 400（需要有效会话）
//   保利/摩天轮/票牛 → 候选接口未命中或 302 跳转
//  → 纯服务器直抓需要：有效 Cookie 或验证后的可用接口（见 DATA-SOURCES.md）。
//  → 系统已确保：自动抓取全部失败时，社区补录 + 官方渠道链接（theater.enrich）兜底，功能不中断。
module.exports = {
  // ---- 各数据源总开关 ----
  ENABLE_DAMAI: true,
  ENABLE_MAOYAN: true,
  ENABLE_POLLY: true,
  ENABLE_THEATER: true,
  ENABLE_RESALE: true,

  // ---- 可选：有效会话 Cookie ----
  // 部分平台被 WAF 拦截时，可把「浏览器登录平台后」的 Cookie 复制到这里（只建议低频个人使用）。
  // 留空则不带 Cookie 请求。Cookie 会过期，失效时清空即可。
  COOKIE: '',

  // ---- 保利票务候选搜索接口（部署后实测，保留能用的；支持 {kw} 占位符）----
  POLLY_ENDPOINTS: [
    'https://web.poliyu.com/api/search?keyword={kw}&page=1&pageSize=20',
    'https://api.poliyu.com/search/query?keyword={kw}&page=1&pageSize=20',
    'https://www.poliyu.com/api/search?keyword={kw}&page=1&pageSize=20'
  ],

  // ---- 摩天轮 / 票牛候选搜索接口 ----
  RESALE_ENDPOINTS: [
    { platform: '摩天轮', url: 'https://api.motianlun.cn/v2/search/project?keyword={kw}&page=1' },
    { platform: '票牛', url: 'https://www.piaoniu.com/api/search?keyword={kw}&page=1&size=20' }
  ]
};
