import test from 'node:test';
import assert from 'node:assert/strict';
import {coachWorkouts} from './coach-ui.js';
import {addWorkout} from './progress.js';
test('coach picker includes current unsynced sessions, preserves source data labels and applies calendar windows',()=>{
 let state=addWorkout(null,{type:'swim',day:'2026-10-16',minutes:30,distance:1.2},'new-local','2026-10-16');
 state=addWorkout(state,{type:'run',day:'2026-09-20',minutes:30,distance:5},'last-month','2026-10-16');
 const remote=[{id:'new-local',type:'swim',day:'2026-10-16',minutes:5},{id:'watch-not-imported',type:'other',day:'2026-10-15',title:'Garmin: силовая'},{id:'future',type:'run',day:'2026-10-17'},{id:'bad-type',type:'unknown',day:'2026-10-16'}];
 const week=coachWorkouts(state,remote,7,'2026-10-16');assert.equal(week.length,2);assert.equal(week.filter(r=>r.id==='new-local').length,1);assert.match(week.find(r=>r.id==='new-local').description,/30 мин.*2:30/);
 const month=coachWorkouts(state,remote,30,'2026-10-16');assert.equal(month.length,3);assert.ok(month.some(r=>r.id==='last-month'));
});
