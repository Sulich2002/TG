import test from 'node:test';
import assert from 'node:assert/strict';
import {healthWeek,healthSummary,metricValue,shiftHealthDay,formatHealth} from './health-analysis.js';
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
