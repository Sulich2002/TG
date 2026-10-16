import {habitDefinitions,tasks,normalize,dayKey,shiftDay} from './progress.js?v=0.14.0';

export function habitMonth(day,offset=0){
 const date=new Date(day+'T12:00:00');date.setDate(1);date.setMonth(date.getMonth()+offset);return dayKey(date).slice(0,7);
}
export function habitMonthDays(month){
 const start=month+'-01',next=habitMonth(start,1)+'-01',days=[];
 for(let day=start;day<next;day=shiftDay(day,1))days.push(day);
 return days;
}
const timestampDay=(value,today)=>{if(!Number.isSafeInteger(value)||value<=0)return null;const date=new Date(value);return Number.isFinite(date.getTime())&&dayKey(date)<=today?dayKey(date):null;};
export function habitTracker(value,{today=dayKey(),month=habitMonth(today),months=1}={}){
 months=[1,2,3].includes(months)?months:1;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month>habitMonth(today))month=habitMonth(today);
 const state=normalize(value),standard=new Set(tasks.map(habit=>habit.id)),definitions=habitDefinitions(state),byId=new Map(definitions.map(habit=>[habit.id,{...habit,known:true,dates:new Set()}]));
 let baseStart=null;
 for(const event of state.events){
  if(!['task','habit'].includes(event.kind)||event.day>today)continue;
  const id=event.task||event.habit.id;
  if(!byId.has(id))byId.set(id,{...event.habit,id,archived:true,updatedAt:0,known:false,dates:new Set()});
  byId.get(id).dates.add(event.day);
  if(standard.has(id)&&(!baseStart||event.day<baseStart))baseStart=event.day;
 }
 const start=habitMonth(month+'-01',1-months)+'-01',days=[];
 for(let day=start;day<habitMonth(month+'-01',1)+'-01';day=shiftDay(day,1))days.push(day);
 const rows=[...byId.values()].map(habit=>{
  // updatedAt is the most recent activation/archive, not a reliable creation date.
  // Only the current known active span can justify an unmarked day.
  const changed=timestampDay(habit.updatedAt,today);
  const activeFrom=habit.archived?null:changed||(standard.has(habit.id)?baseStart||today:today);
  const status=day=>habit.dates.has(day)?'done':day>today?'future':activeFrom&&day>=activeFrom?(day===today?'pending':'missed'):'unknown';
  const cells=days.map(day=>({day,status:status(day)})),done=cells.filter(cell=>cell.status==='done').length,missed=cells.filter(cell=>cell.status==='missed').length;
  let best=0,run=0;
  for(const cell of cells){run=cell.status==='done'?run+1:0;best=Math.max(best,run);}
  return {id:habit.id,title:habit.title,archived:habit.archived,activeFrom,cells,done,missed,best,status};
 }).filter(row=>!row.archived||row.done>0).sort((a,b)=>Number(a.archived)-Number(b.archived));
 const visibleMonths=Array.from({length:months},(_,i)=>habitMonth(start,i));
 return {month,months,start,end:days.at(-1),days,visibleMonths,rows,done:rows.reduce((sum,row)=>sum+row.done,0),missed:rows.reduce((sum,row)=>sum+row.missed,0),best:Math.max(0,...rows.map(row=>row.best)),activeDays:days.filter(day=>rows.some(row=>row.status(day)==='done')).length};
}
