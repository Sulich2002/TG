import test from 'node:test';
import assert from 'node:assert/strict';
import {tasks,normalize,migrate,totalXP,completed,complete,bonusDays,addWorkout,workoutData,personalRecords,workoutDescription,workoutXP,levelProgress,runningPace,addPlan,completePlan,removePlan,awardAchievements,achievements,activeStreak,weeklySummary,shiftDay,weekStart} from './progress.js';
const today='2026-10-15';
test('daily tasks award once and completing the full set grants one bonus',()=>{
 let state=normalize(null);
 for(const task of tasks)state=complete(state,task.id,today);
 assert.equal(totalXP(state),45);
 assert.deepEqual(bonusDays(state),[today]);
 assert.deepEqual(complete(state,'reading',today),state);
 assert.equal(totalXP(complete(state,'reading',today)),45);
});
test('new calendar day unlocks tasks without removing accumulated XP',()=>{
 let state=normalize(null);for(const task of tasks)state=complete(state,task.id,'2026-10-14');
 assert.deepEqual(completed(state,today),[]);
 state=complete(state,'warmup',today);assert.equal(totalXP(state),50);
 assert.equal(completed(state,today).length,1);
});
test('legacy XP is preserved without fabricating workouts or physical attributes',()=>{
 const state=migrate({total:130,done:['touch'],trainingCounts:{touch:5}});
 assert.equal(totalXP(state),130);assert.equal(personalRecords(state).workouts,0);
 assert.deepEqual(migrate({total:-10}),{base:0,events:[],plans:[]});
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
 assert.equal(personalRecords(state).pullups,null);assert.equal(totalXP(state),7.3);
});
test('gym supports multiple groups and exercises, including legacy single records',()=>{
 const first={group:'back',exercise:'Тяга',weight:30,sets:3,reps:12};
 const data=workoutData({type:'gym',day:today,...first},today);
 assert.equal(workoutDescription(data),'Спина · Тяга · 30 кг · 3 × 12');
 assert.equal(workoutData({type:'gym',exercises:[{...first,weight:0}]},today).exercises[0].weight,0);
 for(const invalid of [{...first,sets:1.5},{...first,weight:''},{...first,exercise:''}])assert.throws(()=>workoutData({type:'gym',exercises:[invalid]},today));
 const multi=workoutData({type:'gym',day:today,exercises:[first,{group:'chest',exercise:'Жим',weight:40,sets:3,reps:10}]},today);
 assert.equal(multi.exercises.length,2);assert.equal(workoutXP(multi),34.8);
});
test('workout XP increases with measured volume and duplicate submission is idempotent',()=>{
 const a=addWorkout(null,{type:'run',day:today,distance:1},'one',today);
 const b=addWorkout(null,{type:'run',day:today,distance:20},'one',today);
 assert.equal(totalXP(a),10);assert.equal(totalXP(b),200);
 assert.deepEqual(addWorkout(a,{type:'run',day:today,distance:1},'one',today),a);
});
test('history round trip keeps records and XP, rejecting duplicate or invalid events',()=>{
 let state=complete(null,'shower',today);state=addWorkout(state,{type:'football',day:today,minutes:70},'match',today);
 assert.deepEqual(normalize(JSON.parse(JSON.stringify(state))),state);
 const corrupt=normalize({base:0,events:[...state.events,...state.events,{id:'bad',day:'oops',kind:'workout'}]});
 assert.deepEqual(corrupt,state);assert.equal(totalXP(corrupt),75);
});
test('run distance sums only runs with a known distance, not football or time-only runs',()=>{
 let state=addWorkout(null,{type:'run',day:today,distance:3},'r1',today);
 state=addWorkout(state,{type:'run',day:today,minutes:20},'r2',today);
 state=addWorkout(state,{type:'football',day:today,minutes:70,distance:8},'f1',today);
 assert.equal(personalRecords(state).kilometers,3);assert.equal(personalRecords(state).runs,2);assert.equal(personalRecords(state).workouts,3);
});

test('10, 100 and 1000 pushups award 1, 10 and 100 XP; small amounts are retained',()=>{
 for(const count of [1,10,100,1000])assert.equal(workoutXP(workoutData({type:'home',exercise:'pushups',reps:[count]},today)),count/10);
 assert.equal(workoutXP(workoutData({type:'football',minutes:120},today)),120);
 assert.equal(workoutXP(workoutData({type:'run',minutes:30},today)),15);
});
test('level costs increase: 100,125,150,175 with correct boundaries',()=>{
 for(const [total,level,current,required] of [[0,1,0,100],[99.9,1,99.9,100],[100,2,0,125],[224.9,2,124.9,125],[225,3,0,150],[375,4,0,175],[550,5,0,200]]){
  const value=levelProgress(total);assert.deepEqual({level:value.level,current:value.current,required:value.required},{level,current,required});
 }
});
test('pace uses both inputs and carries seconds into minutes',()=>{
 assert.equal(runningPace({distance:3,minutes:18}),'6:00 мин/км');
 assert.equal(runningPace({distance:1,minutes:5.999}),'6:00 мин/км');
 assert.equal(runningPace({distance:3,minutes:null}),null);
});
test('already earned legacy workout XP and single gym records survive normalization',()=>{
 const state=normalize({base:5,events:[{id:'old-run',day:today,kind:'workout',data:{type:'run',day:today,distance:20,minutes:120},xp:50},{id:'old-gym',day:today,kind:'workout',data:{type:'gym',day:today,group:'back',exercise:'Тяга',weight:30,sets:3,reps:10},xp:60}]});
 assert.equal(totalXP(state),115);assert.equal(state.events[1].data.exercises.length,1);
 assert.equal(totalXP(normalize(JSON.parse(JSON.stringify(state)))),115);
});
test('plans grant chosen XP only once and never change the daily-set bonus',()=>{
 let state=addPlan(null,{title:'Пройти урок',size:'medium'},'p1',today);
 assert.equal(totalXP(state),0);state=completePlan(state,'p1',today);assert.equal(totalXP(state),10);
 assert.deepEqual(completePlan(state,'p1',today),state);assert.deepEqual(bonusDays(state),[]);
 assert.deepEqual(removePlan(state,'p1'),state);
 state=addPlan(state,{title:'Сходить на работу',size:'large'},'p2',today);
 assert.equal(removePlan(state,'p2').plans.length,1);
 assert.equal(totalXP(normalize(JSON.parse(JSON.stringify(state)))),10);
 assert.throws(()=>addPlan(state,{title:'   ',size:'large'},'bad',today));
});
test('gym records keep distinct exercises and muscle groups and compare real weights',()=>{
 let state=addWorkout(null,{type:'gym',day:'2026-10-14',exercises:[{group:'back',exercise:'Тяга',weight:30,sets:3,reps:10},{group:'chest',exercise:'Жим',weight:40,sets:3,reps:10}]},'g1',today);
 state=addWorkout(state,{type:'gym',day:today,exercises:[{group:'back',exercise:'тяга',weight:35,sets:3,reps:10}]},'g2',today);
 const records=personalRecords(state).gym;assert.equal(records.length,2);assert.deepEqual(records[0],{group:'back',exercise:'Тяга',firstWeight:30,latestWeight:35,bestWeight:35,bestVolume:1050});
});

test('smaller task/plan rewards apply to new completions while old earned XP is retained',()=>{
 const old=normalize({events:[{id:today+':warmup',day:today,kind:'task',task:'warmup',xp:10},{id:'plan:p',day:today,kind:'plan',plan:{id:'p',day:today,title:'Курс',size:'medium'},xp:15}]});
 assert.equal(totalXP(old),25);assert.equal(totalXP(complete(null,'warmup',today)),5);
 let newPlan=addPlan(null,{title:'Работа',size:'large'},'new',today);newPlan=completePlan(newPlan,'new',today);assert.equal(totalXP(newPlan),20);
});
test('achievements award once, including across reloads, without becoming activity days',()=>{
 const state=addWorkout(null,{type:'run',day:today,distance:10},'run',today);
 const earned=awardAchievements(state,today);assert.equal(totalXP(earned),145);
 assert.equal(achievements(earned).filter(item=>item.awarded).length,2);
 assert.deepEqual(awardAchievements(normalize(JSON.parse(JSON.stringify(earned))),today),earned);
 assert.equal(activeStreak(earned,today).days,1);
});
test('calendar arithmetic and weekly volume stay correct across month boundaries',()=>{
 assert.equal(shiftDay('2026-10-31',1),'2026-11-01');assert.equal(weekStart('2026-11-01'),'2026-10-26');
 let state=addWorkout(null,{type:'run',day:'2026-10-12',distance:3,minutes:18},'r',today);
 state=addWorkout(state,{type:'gym',day:today,exercises:[{group:'back',exercise:'Тяга',weight:30,sets:3,reps:10},{group:'chest',exercise:'Жим',weight:40,sets:2,reps:10}]},'g',today);
 const week=weeklySummary(state,today);assert.equal(week.workouts,2);assert.equal(week.kilometers,3);assert.equal(week.minutes,18);assert.equal(week.volume,1700);assert.equal(week.groups.back,3);assert.equal(week.groups.chest,2);
});
test('ten active consecutive days unlock the streak even after a later gap',()=>{
 let state=normalize(null);for(let i=0;i<10;i++)state=complete(state,'warmup',shiftDay(today,-i));
 assert.equal(activeStreak(state,today).current,10);assert.equal(activeStreak(state,shiftDay(today,3)).current,0);assert.equal(activeStreak(state,shiftDay(today,3)).longest,10);
 const earned=awardAchievements(state,today);assert.equal(achievements(earned).find(item=>item.id==='streak-10').awarded,true);
});
