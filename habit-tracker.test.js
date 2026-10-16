import test from 'node:test';
import assert from 'node:assert/strict';
import {habitTracker,habitMonth,habitMonthDays} from './habit-tracker.js';
import {normalize,complete,addWorkout,totalXP} from './progress.js';
const today='2026-10-16',stamp=day=>new Date(day+'T12:00:00').getTime();
test('month windows respect real month lengths, leap years and year boundaries',()=>{
 assert.equal(habitMonthDays('2024-02').length,29);assert.equal(habitMonthDays('2025-02').length,28);
 assert.equal(habitMonth('2026-01-31',-1),'2025-12');
 const result=habitTracker(null,{today:'2026-01-10',months:3});assert.equal(result.start,'2025-11-01');assert.equal(result.end,'2026-01-31');assert.equal(result.days.length,92);
});
test('new diary and future days never create missed habits',()=>{
 const result=habitTracker(complete(normalize(null),'reading','2026-10-17'),{today});assert.equal(result.done,0);assert.equal(result.missed,0);assert.equal(result.rows.length,4);
 assert.equal(result.rows[0].status('2026-10-01'),'unknown');assert.equal(result.rows[0].status(today),'pending');assert.equal(result.rows[0].status('2026-10-17'),'future');
});
test('legacy and current completions deduplicate and only completed past days become missed',()=>{
 let state=complete(normalize(null),'warmup','2026-10-13');state=complete(state,'warmup','2026-10-14');
 state={...state,events:[...state.events,{id:'2026-10-14:habit:warmup',day:'2026-10-14',kind:'habit',habit:{id:'warmup',title:'Размяться',xp:5}}]};
 const result=habitTracker(state,{today}),row=result.rows.find(row=>row.id==='warmup');
 assert.equal(row.done,2);assert.equal(row.missed,1);assert.equal(row.best,2);assert.equal(row.status(today),'pending');assert.equal(row.status('2026-10-12'),'unknown');assert.equal(result.done,2);assert.equal(result.activeDays,2);
});
test('a custom habit is measured only after its known activation, preserving earlier real marks',()=>{
 const habit={id:'custom:walk',title:'Гулять',xp:5,archived:false,updatedAt:stamp('2026-10-14')};
 const state={base:0,plans:[],habits:[habit],events:[{id:'2026-10-10:habit:custom:walk',day:'2026-10-10',kind:'habit',habit}]};
 const row=habitTracker(state,{today}).rows[0];assert.equal(row.done,1);assert.equal(row.missed,2);assert.equal(row.status('2026-10-10'),'done');assert.equal(row.status('2026-10-11'),'unknown');assert.equal(row.status('2026-10-13'),'unknown');assert.equal(row.status(today),'pending');
});
test('archived and missing definitions preserve completions without inventing inactive-day misses',()=>{
 const habit={id:'custom:walk',title:'Гулять',xp:5};
 const event={id:'2026-10-10:habit:custom:walk',day:'2026-10-10',kind:'habit',habit};
 for(const habits of [[{...habit,archived:true,updatedAt:stamp('2026-10-12')}],[]]){
  const result=habitTracker({base:0,plans:[],habits,events:[event]},{today});assert.equal(result.rows.length,1);assert.equal(result.rows[0].done,1);assert.equal(result.missed,0);assert.equal(result.rows[0].status('2026-10-11'),'unknown');
 }
});
test('period aggregation counts daily marks once, excludes workouts and keeps earned XP untouched',()=>{
 let state=complete(normalize(null),'reading','2026-09-30');state=complete(state,'reading','2026-10-01');state=complete(state,'reading','2026-10-02');
 state=addWorkout(state,{type:'run',day:'2026-10-03',distance:3},'workout');
 const before=JSON.stringify(state),xp=totalXP(state),one=habitTracker(state,{today,months:1}),three=habitTracker(state,{today,months:3});
 assert.equal(one.done,2);assert.equal(one.rows.find(row=>row.id==='reading').best,2);assert.equal(three.done,3);assert.equal(three.rows.find(row=>row.id==='reading').best,3);
 assert.equal(JSON.stringify(state),before);assert.equal(totalXP(state),xp);
});
test('future months and unsupported periods fall back to the current calendar view',()=>{
 const result=habitTracker(null,{today,month:'2027-02',months:8});assert.equal(result.month,'2026-10');assert.equal(result.months,1);
});
test('legacy standard completions retain their names after the active definitions disappear',()=>{
 const saved=complete(normalize(null),'reading','2026-10-12');
 const result=habitTracker({...saved,habits:[]},{today});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].title,'Почитать');assert.equal(result.rows[0].done,1);assert.equal(result.missed,0);
});
