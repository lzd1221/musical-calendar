// utils/store.js —— 本地缓存封装（搜索历史/默认城市/关注列表缓存）
const app = getApp();

function get(key, def) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? def : v;
  } catch (e) { return def; }
}
function set(key, val) { try { wx.setStorageSync(key, val); } catch (e) {} }

function getDefaultCity() {
  const c = get(app.globalData.defaultCityKey || 'DEF_CITY', '');
  return c || app.globalData.defaultCity || '上海';
}
function setDefaultCity(c) { set('DEF_CITY', c); }

function getSearchHistory() { return get(app.globalData.searchHistoryKey, []); }
function addSearchHistory(item) {
  const h = getSearchHistory().filter(x => !(x.name === item.name && x.city === item.city));
  h.unshift(item);
  set(app.globalData.searchHistoryKey, h.slice(0, 8));
}
function clearSearchHistory() { set(app.globalData.searchHistoryKey, []); }

// 关注剧目本地缓存（快速展示，权威数据在云数据库）
function getWatchedCache() { return get(app.globalData.watchedCacheKey, []); }
function setWatchedCache(list) { set(app.globalData.watchedCacheKey, list); }

module.exports = {
  get, set,
  getDefaultCity, setDefaultCity,
  getSearchHistory, addSearchHistory, clearSearchHistory,
  getWatchedCache, setWatchedCache
};
