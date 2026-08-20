/* ============================================================
   排期算法冒烟测试（与 musical-calendar.html 内 solver 逻辑一致）
   运行：node scheduler-test.js
   ============================================================ */
"use strict";
const assert = require('assert');

/* ---------- 以下为核心逻辑镜像（与 HTML 中一致） ---------- */
const pad2 = n => String(n).padStart(2, '0');
const parseDate = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const toMin = t => { const [h,m] = (t||'00:00').split(':').map(Number); return h*60+m; };
const isWeekend = ds => { const d = parseDate(ds).getDay(); return d===0||d===6; };
function pStart(p){ return Date.parse(p.date+'T'+(p.start||'00:00'))/60000; }
function pEnd(p){
  const s=toMin(p.start), e=toMin(p.end||p.start);
  return Date.parse(p.date+'T'+(p.end||p.start))/60000 + (e<=s?1440:0);
}
function perfOverlap(a,b){ return pStart(a) < pEnd(b) && pStart(b) < pEnd(a); }
function workConflict(p, show){
  if(show.allowWork) return false;
  const w = globalThis.state.settings.workHours;
  if(!w.enabled) return false;
  const dow = parseDate(p.date).getDay();
  const wd = dow===0 ? 7 : dow;
  if(!w.weekdays.includes(wd)) return false;
  const ps=toMin(p.start), pe=toMin(p.end||p.start), ws=toMin(w.start), we=toMin(w.end);
  return ps < we && pe > ws;
}
function solveSchedule(opts){
  const res = { chosen:[], skipped:[], pinnedWarn:[], ok:true, msg:'', mode:'' };
  const shows = globalThis.state.shows.filter(s => s.name.trim());
  if(!shows.length){ res.ok=false; res.msg='no shows'; return res; }
  const pinned = [];
  const cands = shows.map(show => {
    const list=[];
    const locked = opts.lock && show.performances.some(p => p.ticket==='已购' || p.ticket==='已抢');
    if(locked){
      for(const p of show.performances)
        if((p.ticket==='已购'||p.ticket==='已抢') && p.date && p.start) pinned.push({show, p});
      return list;
    }
    for(const p of show.performances){
      if(!p.date || !p.start) continue;
      if(p.ticket==='放弃') continue;
      if(opts.from && p.date < opts.from) continue;
      if(opts.to && p.date > opts.to) continue;
      if(opts.weekendOnly && !isWeekend(p.date)) continue;
      if(opts.avoidWork && workConflict(p, show)) continue;
      list.push(p);
    }
    return list;
  });
  for(let i=0;i<pinned.length;i++) for(let j=i+1;j<pinned.length;j++)
    if(perfOverlap(pinned[i].p, pinned[j].p))
      res.pinnedWarn.push('pinned conflict');
  let lastEnd = 0;
  for(const it of pinned){ const e=pEnd(it.p); if(e>lastEnd) lastEnd=e; }
  cands.forEach(list => {
    for(let i=list.length-1;i>=0;i--)
      if(pinned.some(q => perfOverlap(q.p, list[i]))) list.splice(i,1);
  });
  const N = shows.length;
  if(N <= 18 && opts.mode !== 'greedy'){
    res.mode = 'optimal';
    const perfs=[];
    for(let si=0; si<N; si++) for(let pi=0; pi<cands[si].length; pi++)
      perfs.push({si, pi, p:cands[si][pi], st:pStart(cands[si][pi]), en:pEnd(cands[si][pi])});
    perfs.sort((a,b)=>a.en-b.en || a.st-b.st);
    const total=1<<N, INF=Infinity;
    const dp=new Array(total).fill(INF); dp[0]=lastEnd;
    const par=new Array(total).fill(null);
    for(const it of perfs){
      const bit=1<<it.si;
      for(let mask=0; mask<total; mask++){
        if(mask & bit) continue;
        const le=dp[mask];
        if(le===INF || le>it.st) continue;
        const nm=mask|bit;
        if(it.en < dp[nm]){ dp[nm]=it.en; par[nm]={prev:mask, si:it.si, pi:it.pi}; }
      }
    }
    let bestMask=0, bestVal=-1;
    for(let mask=0; mask<total; mask++){
      if(dp[mask]===INF) continue;
      let v=0; for(let i=0;i<N;i++) if(mask & (1<<i)) v+=shows[i].priority;
      if(v>bestVal){ bestVal=v; bestMask=mask; }
    }
    const picked = new Array(N).fill(-1);
    let m=bestMask;
    while(m){ const pr=par[m]; if(!pr) break; picked[pr.si]=pr.pi; m=pr.prev; }
    for(let i=0;i<N;i++) if(picked[i]>=0) res.chosen.push({show:shows[i], perf:cands[i][picked[i]]});
  }else{
    res.mode='greedy';
    const order = shows.map((s,i)=>({i, pri:s.priority, n:cands[i].length}))
                       .sort((a,b)=> b.pri-a.pri || a.n-b.n);
    const taken = pinned.map(q=>q.p);
    for(const o of order){
      const list=[...cands[o.i]].sort((a,b)=>pStart(a)-pStart(b) || pEnd(a)-pEnd(b));
      let pick=null;
      for(const p of list){ if(!taken.some(q=>perfOverlap(q,p))){ pick=p; break; } }
      if(pick){ taken.push(pick); res.chosen.push({show:shows[o.i], perf:pick}); }
    }
  }
  for(const q of pinned) res.chosen.push({show:q.show, perf:q.p, locked:true});
  res.chosen.sort((a,b)=> pStart(a.perf)-pStart(b.perf) || pEnd(a.perf)-pEnd(b.perf));
  const chosenShowIds = new Set(res.chosen.map(c=>c.show.id));
  for(let i=0;i<N;i++){
    const s=shows[i];
    if(chosenShowIds.has(s.id)) continue;
    if(!s.performances.length) res.skipped.push({show:s, reason:'未排期'});
    else if(!cands[i].length) res.skipped.push({show:s, reason:'无可用'});
    else res.skipped.push({show:s, reason:'撞期'});
  }
  res.totalPriority = res.chosen.reduce((a,c)=>a+(c.show.priority||0), 0);
  return res;
}
/* ---------- 核心逻辑镜像结束 ---------- */

function S(id, name, priority, perfs, extra){
  return Object.assign({id, name, priority, city:'', genre:'音乐剧', allowWork:false, note:'', performances:perfs}, extra||{});
}
function P(id, date, start, end, extra){
  return Object.assign({id, date, start, end, venue:'', ticketOpen:'', ticket:'', note:''}, extra||{});
}
function baseState(shows){
  return { settings:{ workHours:{enabled:true, weekdays:[1,2,3,4,5], start:'09:00', end:'18:00'}, notify:false }, shows };
}
let n=0;
function t(name, fn){
  n++;
  try{ fn(); console.log('  ✓', name); }
  catch(e){ console.error('  ✗', name, '\n    ', e.message); process.exitCode=1; }
}

console.log('排期算法测试：');

/* T1: 同日晚场撞期 -> 取优先级高者 */
t('T1 撞期取舍：必看(3)优先于想看(2)', ()=>{
  globalThis.state = baseState([
    S('a','A',3,[P('a1','2025-07-05','19:30','22:00')]),
    S('b','B',2,[P('b1','2025-07-05','19:30','22:00')]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen.length,1);
  assert.strictEqual(r.chosen[0].show.name,'A');
  assert.strictEqual(r.skipped.length,1);
  assert.strictEqual(r.skipped[0].show.name,'B');
});

/* T2: 同日午场+晚场不重叠 -> 两场都要（连打） */
t('T2 午场+晚场同日连打', ()=>{
  const d='2025-07-12'; // 周六
  globalThis.state = baseState([
    S('a','A',3,[P('a1',d,'14:00','16:30')]),
    S('b','B',2,[P('b1',d,'19:30','22:00')]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen.length,2);
  assert.deepStrictEqual(r.chosen.map(c=>c.show.name).sort(),['A','B']);
});

/* T3: 换场次规避撞期：B 有第二个可用场次 */
t('T3 优先级的剧可换场次避开撞期', ()=>{
  globalThis.state = baseState([
    S('a','A',3,[P('a1','2025-07-05','19:30','22:00')]),
    S('b','B',3,[P('b1','2025-07-05','19:30','22:00'), P('b2','2025-07-06','19:30','22:00')]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen.length,2);
  assert.strictEqual(r.chosen.find(c=>c.show.name==='B').perf.id,'b2');
});

/* T4: 工作日午场默认被排除（上班冲突），可选场次被选 */
t('T4 工作日午场避开上班时间；关闭选项后可选', ()=>{
  const wed='2025-07-09'; // 周三
  const sat='2025-07-12';
  globalThis.state = baseState([
    S('a','A',3,[P('a1',wed,'14:00','16:00'), P('a2',sat,'19:30','22:00')]),
  ]);
  let r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen.length,1);
  assert.strictEqual(r.chosen[0].perf.id,'a2');
  r=solveSchedule({avoidWork:false, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen[0].perf.id,'a1');
});

/* T5: 剧目允许请假后，工作日午场可排 */
t('T5 勾选「可请假」后工作日午场可排', ()=>{
  const wed='2025-07-09';
  globalThis.state = baseState([
    S('a','A',3,[P('a1',wed,'14:00','16:00')], {allowWork:true}),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen.length,1);
});

/* T6: 已购票场次被锁定（固定），其他场次避让 */
t('T6 锁定已购场次并避让', ()=>{
  globalThis.state = baseState([
    S('a','A',3,[P('a1','2025-07-05','19:30','22:00',{ticket:'已购'})]),
    S('b','B',3,[P('b1','2025-07-05','19:30','22:00'), P('b2','2025-07-06','19:30','22:00')]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen.length,2);
  assert.ok(r.chosen.some(c=>c.locked && c.show.name==='A'));
  assert.strictEqual(r.chosen.find(c=>c.show.name==='B').perf.id,'b2');
});

/* T7: 只看周末过滤 */
t('T7 weekendOnly 只排周末', ()=>{
  const wed='2025-07-09', sat='2025-07-12';
  globalThis.state = baseState([
    S('a','A',3,[P('a1',wed,'19:30','22:00'), P('a2',sat,'19:30','22:00')]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:true, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen[0].perf.id,'a2');
});

/* T8: 跨日（end<=start 视为跨夜）不误判 */
t('T8 跨夜场次不误判为撞期', ()=>{
  globalThis.state = baseState([
    S('a','A',3,[P('a1','2025-07-05','21:00','23:59')]),
    S('b','B',3,[P('b1','2025-07-06','19:30','22:00')]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen.length,2);
});

/* T9/T9b: 复杂场景最优解（多场次+优先级权衡） */
/* T9: 最优解 + 换场次：A 周六晚、B 可换周日午、C 可换周日晚
   -> A + B(周日午) + C(周日晚) = 3+3+2 = 8 分，考验 DP 跨日组合 */
t('T9 最优解：换场次组合拼出最高分', ()=>{
  globalThis.state = baseState([
    S('a','A',3,[P('a1','2025-07-05','19:30','22:00')]),
    S('b','B',3,[P('b1','2025-07-05','19:30','22:00'), P('b2','2025-07-06','14:00','16:30')]),
    S('c','C',2,[P('c1','2025-07-05','19:30','22:00'), P('c2','2025-07-06','19:30','22:00')]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.totalPriority,8);
  assert.strictEqual(r.chosen.length,3);
  assert.strictEqual(r.chosen.find(c=>c.show.name==='B').perf.id,'b2');
  assert.strictEqual(r.chosen.find(c=>c.show.name==='C').perf.id,'c2');
});

/* T9b: 同档取舍：A(3) B(3) 同周六晚档；C(2) D(1) 同周六午场档
   最优 = A + C = 5 分（每组内最多取一部） */
t('T9b 最优解：同档取舍取最高分', ()=>{
  globalThis.state = baseState([
    S('a','A',3,[P('a1','2025-07-05','19:30','22:00')]),
    S('b','B',3,[P('b1','2025-07-05','19:30','22:00')]),
    S('c','C',2,[P('c1','2025-07-05','14:00','16:00')]),
    S('d','D',1,[P('d1','2025-07-05','14:00','16:00')]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.totalPriority,5);
  assert.strictEqual(r.chosen.length,2);
});

/* T10: 贪心模式在简单场景下与最优一致 */
t('T10 贪心兜底可用', ()=>{
  globalThis.state = baseState([
    S('a','A',3,[P('a1','2025-07-05','19:30','22:00')]),
    S('b','B',2,[P('b1','2025-07-05','19:30','22:00')]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'greedy'});
  assert.strictEqual(r.mode,'greedy');
  assert.strictEqual(r.chosen.length,1);
  assert.strictEqual(r.chosen[0].show.name,'A');
});

/* T11: 已放弃场次不参与 */
t('T11 放弃的场次被排除', ()=>{
  globalThis.state = baseState([
    S('a','A',3,[P('a1','2025-07-05','19:30','22:00',{ticket:'放弃'})]),
  ]);
  const r=solveSchedule({avoidWork:true, lock:true, weekendOnly:false, from:null, to:null, mode:'auto'});
  assert.strictEqual(r.chosen.length,0);
  assert.strictEqual(r.skipped.length,1);
});

console.log(n+' 组测试完成' + (process.exitCode?'（存在失败）':'，全部通过 ✅'));
