import test from 'node:test';
import assert from 'node:assert/strict';
import {tasks,normalize,migrate,totalXP,completed,complete,bonusDays,addWorkout,workoutData,personalRecords,workoutDescription} from './progress.js';
const today='2026-10-15';
test('daily tasks award once and completing the full set grants one bonus',()=>{
 let state=normalize(null);
 for(const task of tasks)state=complete(state,task.id,today);
 assert.equal(totalXP(state),70);
 assert.deepEqual(bonusDays(state),[today]);
 assert.deepEqual(complete(state,'reading',today),state);
 assert.equal(totalXP(complete(state,'reading',today)),70);
});
test('new calendar day unlocks tasks without removing accumulated XP',()=>{
 let state=normalize(null);for(const task of tasks)state=complete(state,task.id,'2026-10-14');
 assert.deepEqual(completed(state,today),[]);
 state=complete(state,'warmup',today);assert.equal(totalXP(state),80);
 assert.equal(completed(state,today).length,1);
});
test('legacy XP is preserved without fabricating workouts or physical attributes',()=>{
 const state=migrate({total:130,done:['touch'],trainingCounts:{touch:5}});
 assert.equal(totalXP(state),130);assert.equal(personalRecords(state).workouts,0);
 assert.deepEqual(migrate({total:-10}),{base:0,events:[]});
});
test('run accepts distance only or time only; football requires time',()=>{
 assert.equal(workoutData({type:'run',day:today,distance:'2,5'},today).distance,2.5);
 assert.equal(workoutData({type:'run',day:today,minutes:20},today).distance,null);
 assert.throws(()=>workoutData({type:'run',day:today},today));
 assert.throws(()=>workoutData({type:'football',day:today,distance:5},today));
 assert.equal(workoutData({type:'football',day:today,minutes:70},today).distance,null);
});
test('workout validation rejects future dates, impossible dates and invalid repetitions',()=>{
 assert.throws(()=>workoutData({type:'run',day:'2026-10-16',minutes:20},today));
 assert.throws(()=>workoutData({type:'run',day:'2026-02-30',minutes:20},today));
 for(const reps of ['0,10','-3,4','4.5,2','', '3,not-a-number'])assert.throws(()=>workoutData({type:'home',day:today,exercise:'pushups',reps},today));
});
test('home sets retain individual repetitions and records compare measured values',()=>{
 let state=addWorkout(null,{type:'home',day:'2026-10-14',exercise:'pushups',reps:'15, 12, 10'},'one',today);
 state=addWorkout(state,{type:'home',day:today,exercise:'pushups',reps:'20, 16'},'two',today);
 assert.deepEqual(state.events[0].data.reps,[15,12,10]);
 assert.deepEqual(personalRecords(state).pushups,{first:15,latest:20,best:20});
 assert.equal(personalRecords(state).pullups,null);assert.equal(totalXP(state),80);
});
test('gym stores the exercise, muscle group, zero or positive weight, sets and reps',()=>{
 const data=workoutData({type:'gym',day:today,group:'back',exercise:'Тяга',weight:30,sets:3,reps:12},today);
 assert.equal(workoutDescription(data),'Спина · Тяга · 30 кг · 3 × 12');
 assert.equal(workoutData({...data,weight:0},today).weight,0);
 assert.throws(()=>workoutData({...data,sets:1.5},today));
 assert.throws(()=>workoutData({...data,weight:''},today));
 assert.throws(()=>workoutData({...data,exercise:''},today));
});
test('workout XP does not increase with volume and duplicate submission is idempotent',()=>{
 const a=addWorkout(null,{type:'run',day:today,distance:1},'one',today);
 const b=addWorkout(null,{type:'run',day:today,distance:20},'one',today);
 assert.equal(totalXP(a),totalXP(b));
 assert.deepEqual(addWorkout(a,{type:'run',day:today,distance:1},'one',today),a);
});
test('history round trip keeps records and XP, rejecting duplicate or invalid events',()=>{
 let state=complete(null,'shower',today);state=addWorkout(state,{type:'football',day:today,minutes:70},'match',today);
 assert.deepEqual(normalize(JSON.parse(JSON.stringify(state))),state);
 const corrupt=normalize({base:0,events:[...state.events,...state.events,{id:'bad',day:'oops',kind:'workout'}]});
 assert.deepEqual(corrupt,state);assert.equal(totalXP(corrupt),60);
});
test('run distance sums only runs with a known distance, not football or time-only runs',()=>{
 let state=addWorkout(null,{type:'run',day:today,distance:3},'r1',today);
 state=addWorkout(state,{type:'run',day:today,minutes:20},'r2',today);
 state=addWorkout(state,{type:'football',day:today,minutes:70,distance:8},'f1',today);
 assert.equal(personalRecords(state).kilometers,3);assert.equal(personalRecords(state).runs,2);assert.equal(personalRecords(state).workouts,3);
});
