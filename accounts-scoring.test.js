import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {achievementCatalog,normalize,complete,addWorkout,awardAchievements,totalXP,bonusDays,addPlan,completePlan} from './progress.js';

test('server reward catalogue and XP agree with the app for routines, plans, workouts and achievements',async()=>{
 const expected=achievementCatalog.map(({id,metric,target,xp})=>({id,metric,target,xp}));
 assert.deepEqual(JSON.parse(await readFile('backend/garmin/rewards.json','utf8')),expected);
 const today='2026-10-15',states=[];
 let state=normalize({base:200,events:[]});
 for(const task of ['warmup','shower','breakfast','reading'])state=complete(state,task,today);
 state=addPlan(state,{title:'Учёба',size:'medium'},'plan-fixture',today);state=completePlan(state,'plan-fixture',today);states.push(awardAchievements(state,today));
 const inputs=[{type:'run',distance:21.0975,minutes:125},{type:'run',minutes:27},{type:'football',minutes:90},{type:'home',exercise:'pushups',reps:[50,25,12]},{type:'home',exercise:'pullups',reps:[15,10]},{type:'gym',exercises:[{group:'chest',exercise:'Жим штанги лёжа',weight:60,sets:3,reps:8},{group:'legs',exercise:'Присед со штангой',weight:100,sets:4,reps:8}]}];
 for(const [index,input] of inputs.entries())states.push(awardAchievements(addWorkout(null,{...input,day:today},'fixture-'+index,today),today));
 const result=spawnSync('python3',['-c',`import sys,json
sys.path.insert(0,'backend/garmin')
from accounts import validate_state,earned
states=json.load(sys.stdin)
print(json.dumps([{'total':s['base']+earned(s,'0001-01-01','2026-10-15'),'period':earned(s,'2026-10-15','2026-10-15')} for s in [validate_state(raw,'2026-10-15') for raw in states]]))`],{input:JSON.stringify(states),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),states.map(state=>({total:totalXP(state),period:Math.round((state.events.filter(e=>e.day===today).reduce((sum,e)=>sum+e.xp,0)+bonusDays(state).filter(day=>day===today).length*20)*10)/10})));
});
