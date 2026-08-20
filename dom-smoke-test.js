/* ============================================================
   DOM 冒烟测试：用最小 DOM 桩执行 musical-calendar.html 整段脚本，
   跑通「载入示例 → 全量渲染 → 智能排期 → iCal 导出」主链路。
   运行：node dom-smoke-test.js
   ============================================================ */
"use strict";
const fs = require('fs');
const vm = require('vm');

function mkEl(id){
  return {
    id: id || '',
    dataset: {},
    style: {},
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    _html: '',
    textContent: '',
    value: '',
    checked: false,
    files: [],
    addEventListener(){},
    querySelector(){ return mkEl(); },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    click(){},
    set innerHTML(v){ this._html = String(v); },
    get innerHTML(){ return this._html; }
  };
}
const elCache = {};
const store = {};
const documentStub = {
  querySelector(sel){
    const m = String(sel).match(/^#([\w-]+)$/);
    if(m){ const id=m[1]; if(!elCache[id]) elCache[id]=mkEl(id); return elCache[id]; }
    if(String(sel).startsWith('#')) return mkEl();
    return null;
  },
  querySelectorAll(){ return []; },
  createElement(){ return mkEl(); },
  addEventListener(){}
};
const localStorageStub = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(store,k) ? store[k] : null; },
  setItem(k,v){ store[k]=String(v); },
  removeItem(k){ delete store[k]; }
};

const html = fs.readFileSync(require('path').join(__dirname,'musical-calendar.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if(!m){ console.error('未找到 <script>'); process.exit(1); }

const code = m[1] + '\n;globalThis.__t = { renderAll, loadDemo, solveSchedule, buildICS, state };';
const sandbox = {
  document: documentStub,
  localStorage: localStorageStub,
  setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {},
  confirm: () => true,
  console,
  Notification: { permission: 'denied' },
  window: {}
};
sandbox.globalThis = sandbox;

let fail = 0;
function t(name, fn){
  try{ fn(); console.log('  ✓', name); }
  catch(e){ fail++; console.error('  ✗', name, '\n    ', e && e.stack ? e.stack.split('\n').slice(0,4).join('\n    ') : e); }
}

console.log('DOM 冒烟测试：');
vm.createContext(sandbox);

t('脚本可完整加载执行（无语法/初始化错误）', () => { vm.runInContext(code, sandbox); });
const T = sandbox.__t;

t('初始为空状态，渲染不报错', () => { T.renderAll(); });
t('载入示例数据后共 8 部剧目', () => {
  T.loadDemo();
  if(T.state.shows.length !== 8) throw new Error('期望 8，实际 ' + T.state.shows.length);
});
t('全量渲染（日历/列表/抢票/排期/设置）不报错', () => { T.renderAll(); });

t('智能排期（最优解）可得到排期结果', () => {
  const r = T.solveSchedule({ avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto' });
  if(!r.ok) throw new Error(r.msg);
  if(!r.chosen.length) throw new Error('没有排到任何剧目');
  console.log('      → 排到 ' + r.chosen.length + ' 部，优先级总分 ' + r.totalPriority +
    '，未排：' + (r.skipped.map(s=>s.show.name).join('、') || '（无）'));
  // 校验任意两场不重叠
  for(let i=0;i<r.chosen.length;i++) for(let j=i+1;j<r.chosen.length;j++){
    const a=r.chosen[i].perf, b=r.chosen[j].perf;
    const st=(p)=>Date.parse(p.date+'T'+(p.start||'00:00'))/60000;
    const en=(p)=>{const s=(p.start||'').split(':').map(Number), e=(p.end||p.start).split(':').map(Number);
      return Date.parse(p.date+'T'+(p.end||p.start))/60000 + ((e[0]*60+e[1])<=(s[0]*60+s[1])?1440:0);};
    if(st(a) < en(b) && st(b) < en(a)) throw new Error(`撞期：${r.chosen[i].show.name} 与 ${r.chosen[j].show.name}`);
  }
});

t('排期选项：避开上班时间 + 只看周末 均可用', () => {
  const r = T.solveSchedule({ avoidWork:true, lock:true, weekendOnly:true, from:null, to:null, mode:'auto' });
  for(const c of r.chosen){
    const dow = new Date(c.perf.date+'T00:00').getDay();
    if(dow!==0 && dow!==6) throw new Error('周末过滤失效: ' + c.perf.date);
  }
});

t('iCal 导出（含抢票提醒）生成有效结构', () => {
  const ics = T.buildICS(true);
  if(!ics.includes('BEGIN:VCALENDAR') || !ics.includes('END:VCALENDAR')) throw new Error('缺少 VCALENDAR 边界');
  if(!ics.includes('BEGIN:VEVENT')) throw new Error('缺少演出事件');
  if(!ics.includes('VALARM')) throw new Error('缺少开票提醒 VALARM');
  if(!ics.includes('DTSTART:')) throw new Error('缺少 DTSTART');
});

t('localStorage 保存/重载往返', () => {
  const before = T.state.shows.length;
  // 直接调用内部 save（通过再次执行脚本走 load）
  const sandbox2 = { document: documentStub, localStorage: localStorageStub, setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {},
    confirm: () => true, console, Notification: { permission:'denied' }, window: {} };
  sandbox2.globalThis = sandbox2;
  vm.createContext(sandbox2);
  vm.runInContext(m[1] + '\n;globalThis.__t2={state};', sandbox2);
  if(sandbox2.__t2.state.shows.length !== before) throw new Error('重载后剧目数不一致');
});

t('无任何数据时排期给出友好提示', () => {
  const s3 = { document: documentStub, localStorage: { getItem:()=>null, setItem(){}, removeItem(){} },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true, console, Notification:{permission:'denied'}, window:{} };
  s3.globalThis = s3;
  vm.createContext(s3);
  vm.runInContext(m[1] + '\n;globalThis.__t3={solveSchedule};', s3);
  const r = s3.__t3.solveSchedule({ avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto' });
  if(r.ok || !r.msg) throw new Error('应返回 ok=false 与提示信息');
});

console.log(fail ? fail + ' 项失败 ❌' : '全部通过 ✅');
process.exit(fail ? 1 : 0);

