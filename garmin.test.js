import test from 'node:test';
import assert from 'node:assert/strict';
import {garminURL,garminWorkout,garminSource,garminHealth} from './garmin.js';
import {garminCandidates,importGarmin,addWorkout,normalize,totalXP,awardAchievements} from './progress.js';
const today='2026-10-15';
const activity=(id,extra={})=>({activityId:String(id),day:today,title:'Пробежка с часов',typeKey:'running',distanceMeters:5000,durationSeconds:1800,movingDurationSeconds:1750,elapsedDurationSeconds:1900,averageHeartRate:142,maximumHeartRate:170,heartRateSamples:[{timestamp:1792040400000,bpm:130},{timestamp:1792040460000,bpm:145}],...extra});

test('Garmin import converts original units once and retains measured pulse and paused time',()=>{
 const input=garminWorkout(activity(1));assert.equal(input.distance,5);assert.equal(input.minutes,30);assert.equal(input.source.averageHeartRate,142);assert.equal(input.source.elapsedDurationSeconds,1900);
 const state=importGarmin(null,[activity(1)],['1'],today);assert.equal(totalXP(state),50);assert.equal(state.events[0].id,'garmin:1');assert.deepEqual(normalize(JSON.parse(JSON.stringify(state))),state);
});
test('unsupported sports, impossible dates and bad source IDs never become running XP',()=>{
 for(const item of [activity(2,{day:'2026-02-30'}),activity('../unsafe'),activity(3,{distanceMeters:null,durationSeconds:null})])assert.equal(garminWorkout(item),null);
 assert.equal(importGarmin(null,[activity(1,{day:'2026-10-16'})],['1'],today).events.length,0);
 assert.equal(garminWorkout(activity(4,{typeKey:'soccer'})).type,'football');
 const other=garminWorkout(activity(5,{typeKey:'cycling'}));assert.equal(other.type,'other');assert.equal(totalXP(importGarmin(null,[activity(5,{typeKey:'cycling'})],['5'],today)),0);
});
test('repeated sync and changed remote data never re-award imported workouts or achievements',()=>{
 let state=importGarmin(null,[activity(1)],['1'],today);state=awardAchievements(state,today);
 const xp=totalXP(state);state=importGarmin(state,[activity(1,{distanceMeters:21098})],['1'],today);state=awardAchievements(state,today);
 assert.equal(totalXP(state),xp);assert.equal(state.events.find(e=>e.kind==='workout').data.distance,5);
 assert.equal(garminCandidates(state,[activity(1)],today).length,0);
});
test('manual distance or time matches require review, and only selected records are imported',()=>{
 let state=addWorkout(null,{type:'run',day:today,minutes:30},'manual',today);
 assert.equal(garminCandidates(state,[activity(1)],today)[0].duplicate,true);
 assert.deepEqual(importGarmin(state,[activity(1)],[],today),state);
 state=importGarmin(state,[activity(1),activity(2,{distanceMeters:10000,durationSeconds:3600})],['2'],today);
 assert.equal(state.events.length,2);assert.equal(totalXP(state),115);
});
test('missing pulse remains missing, samples are bounded and unsafe transport URLs are rejected',()=>{
 const source=garminSource({provider:'garmin',id:'1',averageHeartRate:0,maximumHeartRate:Infinity,heartRateSamples:[{timestamp:1,bpm:NaN},{timestamp:2,bpm:140}]});
 assert.equal(source.averageHeartRate,null);assert.equal(source.maximumHeartRate,null);assert.equal(source.heartRateSamples.length,1);
 assert.equal(garminURL('https://example.trycloudflare.com/'),'https://example.trycloudflare.com');
 for(const url of ['http://example.com','https://user:password@example.com','https://example.com/private','https://example.com?token=secret','javascript:alert(1)'])assert.throws(()=>garminURL(url));
});
test('daily health displays real zeroes, validates dates, and remains separate from XP',()=>{
 const health=garminHealth({day:today,steps:0,averageStress:0,restingHeartRate:52,sleepSeconds:25200,sleepScore:82,sleepStages:{deep:3600,light:18000,rem:3600,awake:0},hrvNightAverage:54});
 assert.equal(health.steps,0);assert.equal(health.averageStress,0);assert.equal(health.sleepStages.awake,0);assert.equal(health.sleepScore,82);assert.equal(health.hrvNightAverage,54);
 assert.equal(totalXP(importGarmin(null,[health],[],today)),0);
 assert.equal(garminHealth({...health,day:'2026-02-30'}),null);
 const missing=garminHealth({day:today,restingHeartRate:0,sleepSeconds:0,averageStress:-1,sleepScore:100});
 assert.equal(missing.restingHeartRate,null);assert.equal(missing.sleepSeconds,null);assert.equal(missing.sleepScore,null);assert.equal(missing.averageStress,null);
});

test('fresh Garmin metadata repairs an already imported workout without changing volume, XP or record count',()=>{
 let old=importGarmin(null,[activity(1,{averageHeartRate:null,maximumHeartRate:null})],['1'],today);old=awardAchievements(old,today);
 const before=totalXP(old),fresh=activity(1,{distanceMeters:10000,averageHeartRate:151,maximumHeartRate:183,metricsVersion:2,averageCadence:172,calories:420,heartRateZones:[{zone:2,seconds:1500,lowerBpm:120,upperBpm:145}]});
 const repaired=importGarmin(old,[fresh],[],today),workout=repaired.events.find(e=>e.kind==='workout');
 assert.equal(totalXP(repaired),before);assert.equal(workout.data.distance,5);assert.equal(workout.data.source.averageHeartRate,151);assert.equal(workout.data.source.averageCadence,172);assert.equal(workout.data.source.heartRateZones[0].seconds,1500);assert.equal(repaired.events.length,old.events.length);
 assert.deepEqual(normalize(JSON.parse(JSON.stringify(repaired))),repaired);
 const missing=importGarmin(repaired,[activity(1,{averageHeartRate:null,maximumHeartRate:null})],[],today);
 assert.equal(missing.events.find(e=>e.kind==='workout').data.source.averageHeartRate,151);
});
