import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,dailyHabits,habitDefinitions,addHabit,archiveHabit,complete,completed,totalXP,bonusDays,dayHasBonus,mergeHabits,awardAchievements,addWorkout,workoutData,workoutXP,workoutDescription,swimmingPace,weeklySummary,personalRecords,importGarmin} from './progress.js';
import {garminWorkout} from './garmin.js';
const today='2026-10-16';

test('custom habits recur daily, archive without losing history, and restore without duplicate XP',()=>{
 let state=addHabit(null,{title:'  Погулять  ',xp:5},'walk',today);assert.equal(dailyHabits(state).length,5);
 state=complete(state,'custom:walk',today);assert.equal(totalXP(state),5);assert.equal(state.events[0].habit.title,'Погулять');
 assert.deepEqual(complete(state,'custom:walk',today),state);
 state=archiveHabit(state,'custom:walk',true,today);assert.equal(dailyHabits(state).length,4);assert.equal(totalXP(state),5);
 state=archiveHabit(state,'custom:walk',false,today);assert.deepEqual(complete(state,'custom:walk',today),state);
 state=complete(state,'custom:walk','2026-10-17');assert.equal(totalXP(state),10);assert.deepEqual(normalize(JSON.parse(JSON.stringify(state))),state);
});
test('custom daily set grants one bonus and an empty set grants none',()=>{
 let state=null;for(const id of ['warmup','shower','breakfast','reading'])state=archiveHabit(state,id,true,today);
 assert.equal(dailyHabits(state).length,0);assert.equal(totalXP(awardAchievements(state,today)),0);
 state=addHabit(state,{title:'Прогулка',xp:5},'walk',today);state=complete(state,'custom:walk',today);assert.equal(totalXP(state),25);assert.equal(dayHasBonus(state,today),true);
 state=addHabit(state,{title:'Курс',xp:10},'course',today);state=complete(state,'custom:course',today);assert.equal(totalXP(state),35);assert.equal(state.events.filter(e=>e.kind==='habit-bonus').length,1);
 state=archiveHabit(state,'custom:walk',true,today);state=archiveHabit(state,'custom:course',true,today);assert.equal(totalXP(state),35);
 assert.equal(awardAchievements(state,today).events.filter(e=>e.achievement==='full-day').length,1);
});
test('old daily rewards and bonuses stay intact when habits change',()=>{
 let state=null;for(const id of ['warmup','shower','breakfast','reading'])state=complete(state,id,today);
 assert.equal(totalXP(state),45);state=addHabit(state,{title:'Прогулка',xp:5},'walk',today);state=complete(state,'custom:walk',today);
 assert.equal(totalXP(state),50);assert.deepEqual(bonusDays(state),[today]);assert.equal(state.events.some(e=>e.kind==='habit-bonus'),false);
 state=archiveHabit(state,'reading',true,today);assert.equal(totalXP(state),50);
 for(const habit of dailyHabits(state))state=complete(state,habit.id,'2026-10-17');
 assert.equal(totalXP(state),90);assert.equal(dayHasBonus(state,'2026-10-17'),true);
});
test('old and new device records of the same daily habit and bonus merge only once',()=>{
 let old=null;for(const id of ['warmup','shower','breakfast','reading'])old=complete(old,id,today);
 let modern=archiveHabit(null,'reading',false,today);for(const id of ['warmup','shower','breakfast','reading'])modern=complete(modern,id,today);
 const merged=normalize({...modern,events:[...modern.events,...old.events]});assert.equal(totalXP(merged),45);assert.equal(completed(merged,today).length,4);assert.equal(merged.events.length,4);
 const removed=archiveHabit(modern,'reading',true,today),definitions=mergeHabits(removed,old);assert.equal(definitions.find(h=>h.id==='reading').archived,true);
 const later={...removed,habits:habitDefinitions(removed).map(h=>h.id==='reading'?{...h,archived:false,updatedAt:h.updatedAt+1}:h)};
 assert.equal(mergeHabits(removed,later).find(h=>h.id==='reading').archived,false);
});
test('unknown rewards and unearned bonus snapshots cannot inflate habit XP',()=>{
 assert.throws(()=>addHabit(null,{title:' ',xp:5},'empty',today));assert.throws(()=>addHabit(null,{title:'Test',xp:100},'bad',today));
 const state=normalize({events:[{id:today+':habit:custom:test',day:today,kind:'habit',habit:{id:'custom:test',title:'Test',xp:100}},{id:today+':habit-bonus',day:today,kind:'habit-bonus',required:['custom:test'],xp:999}]});assert.equal(totalXP(state),0);
});
test('swimming uses minutes, optional metres and pace per 100m without running kilometres',()=>{
 const data=workoutData({type:'swim',day:today,minutes:30,distance:1.2},today);assert.equal(workoutXP(data),30);assert.equal(swimmingPace(data),'2:30 мин/100 м');assert.match(workoutDescription(data),/1.?200 м.*30 мин.*2:30/);
 assert.equal(workoutXP(workoutData({type:'swim',minutes:45},today)),45);assert.throws(()=>workoutData({type:'swim',distance:1},today));
 const state=addWorkout(null,data,'swim',today);assert.equal(personalRecords(state).kilometers,0);assert.equal(weeklySummary(state,today).minutes,30);
});
test('Garmin pool/open-water sessions use active minutes and already imported sessions keep XP',()=>{
 const activity={activityId:'123',day:today,title:'Бассейн',typeKey:'lap_swimming',distanceMeters:500,durationSeconds:1200,movingDurationSeconds:600};
 const data=garminWorkout(activity);assert.equal(data.type,'swim');assert.equal(data.minutes,10);assert.equal(data.distance,.5);assert.equal(garminWorkout({...activity,typeKey:'open_water_swimming'}).type,'swim');
 const state=importGarmin(null,[activity],['123'],today);assert.equal(totalXP(state),10);assert.deepEqual(importGarmin(state,[activity],['123'],today),state);
 const old=addWorkout(null,{...data,type:'other'},'garmin:123',today);assert.equal(totalXP(importGarmin(old,[activity],['123'],today)),0);assert.equal(old.events[0].data.type,'other');
});
