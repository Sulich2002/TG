import test from 'node:test';
import assert from 'node:assert/strict';
import {healthWeek,healthPeriod,mergeHealthHistory,healthSummary,metricValue,shiftHealthDay,formatHealth} from './health-analysis.js';
const today='2026-10-15';
const row=(day,extra={})=>({day,sleepSeconds:25200,steps:10000,averageStress:0,bodyBattery:20,bodyBatteryHighest:85,...extra});

test('seven calendar days preserve gaps and discard future, old and invalid records',()=>{
 const week=healthWeek([row('2026-10-14'),row(today),row('2026-10-16'),row('2026-10-08'),row('2026-02-30')],today);
 assert.equal(week.length,7);assert.equal(week[0].day,'2026-10-09');assert.equal(week[0].row,null);
 const summary=healthSummary(week,'sleep',today);assert.equal(summary.available,2);assert.equal(summary.count,2);assert.equal(summary.average,25200);assert.equal(summary.change,null);
 assert.equal(shiftHealthDay('2026-03-01',-1),'2026-02-28');assert.equal(shiftHealthDay('2028-03-01',-1),'2028-02-29');
});
test('deduplication uses latest update without counting a night twice',()=>{
 const week=healthWeek([row(today,{updated:'2026-10-15T12:00:00Z',sleepSeconds:28800}),row(today,{updated:'2026-10-15T10:00:00Z',sleepSeconds:18000})],today);
 assert.equal(healthSummary(week,'sleep',today).average,28800);assert.equal(healthSummary(week,'sleep',today).count,1);
});
test('today is visible but excluded from completed-day steps, stress and peak battery averages',()=>{
 const week=healthWeek([row('2026-10-14',{steps:10000,averageStress:0}),row(today,{steps:2000,averageStress:90,bodyBatteryHighest:99})],today);
 const steps=healthSummary(week,'steps',today);assert.equal(steps.available,2);assert.equal(steps.count,1);assert.equal(steps.average,10000);assert.equal(steps.points[6].partial,true);
 assert.equal(healthSummary(week,'stress',today).average,0);assert.equal(healthSummary(week,'battery',today).average,85);
 assert.equal(healthSummary(healthWeek([row(today)],today),'steps',today).average,null);
});
test('failed sections never influence statistics; actual zeroes remain values',()=>{
 const week=healthWeek([row('2026-10-14',{warnings:['sleep','daily'],sleepSeconds:10000}),row(today,{sleepSeconds:28800,steps:0})],today);
 assert.equal(healthSummary(week,'sleep',today).average,28800);assert.equal(healthSummary(week,'steps',today).count,0);assert.equal(metricValue(week[6].row,'steps'),0);
 assert.equal(metricValue(healthWeek([row(today,{hrvNightAverage:54,warnings:['hrv']})],today)[6].row,'hrv'),null);
});
test('comparison uses two complete equal calendar windows and never fills missing days',()=>{
 const rows=Array.from({length:7},(_,i)=>row(shiftHealthDay(today,i-6),{sleepSeconds:i<3?21600:28800}));
 assert.equal(healthSummary(healthWeek(rows,today),'sleep',today).change,7200);
 assert.equal(healthSummary(healthWeek(rows.filter((_,i)=>i!==2),today),'sleep',today).change,null);
});
test('durations use minutes without wrapping and missing values are not zero',()=>{
 assert.equal(formatHealth(25200,'sleep'),'7 ч 0 мин');assert.equal(formatHealth(-5400,'sleep'),'−1 ч 30 мин');
 assert.equal(formatHealth(0,'stress'),'0');assert.equal(formatHealth(null,'sleep'),'—');
});


test('2, 3 and 30-day windows cross month boundaries and use the selected denominator',()=>{
 const end='2026-11-02',rows=Array.from({length:30},(_,i)=>row(shiftHealthDay(end,i-29),{sleepSeconds:i<15?21600:28800}));
 for(const days of [2,3,7,30]){const period=healthPeriod(rows,end,days);assert.equal(period.length,days);assert.equal(period.at(-1).day,end);assert.equal(healthSummary(period,'sleep',end).available,days);}
 const month=healthPeriod(rows,end,30);assert.equal(month[0].day,'2026-10-04');assert.equal(healthSummary(month,'sleep',end).change,7200);
 const two=healthPeriod([row('2026-11-01',{sleepSeconds:21600}),row(end,{sleepSeconds:25200})],end,2);
 assert.equal(healthSummary(two,'sleep',end).average,23400);assert.equal(healthSummary(two,'sleep',end).change,3600);
 assert.equal(healthSummary(two,'steps',end).change,null);
 assert.equal(healthPeriod(rows,end,999).length,7);
});
test('rolling server snapshots accumulate at most 30 days without mixing or duplicating dates',()=>{
 const previous=[row('2026-10-01'),row('2026-10-14',{updated:'2026-10-14T10:00:00Z',steps:5000})];
 const incoming=[row('2026-10-14',{updated:'2026-10-14T12:00:00Z',steps:6000}),row(today)];
 const merged=mergeHealthHistory(previous,incoming,today);
 assert.deepEqual(merged.map(r=>r.day),[today,'2026-10-14','2026-10-01']);assert.equal(merged[1].steps,6000);
 const later=mergeHealthHistory(merged,[row('2026-11-01')],'2026-11-01');assert.equal(later.some(r=>r.day==='2026-10-01'),false);
 assert.equal(mergeHealthHistory([],incoming,today).some(r=>r.day==='2026-10-01'),false);
});
