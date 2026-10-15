import {garminHealth} from './garmin.js?v=0.7.1';

export const healthMetrics={
  sleep:{label:'Сон',field:'sleepSeconds',section:'sleep',unit:'ч',description:'Продолжительность ночного сна. Дата — утро после этой ночи.'},
  pulse:{label:'Пульс в покое',field:'restingHeartRate',section:'heart',unit:'уд/мин',description:'Пульс в покое по данным Garmin, а не средний пульс тренировки.'},
  steps:{label:'Шаги',field:'steps',section:'daily',unit:'шагов',partial:true,description:'Шаги за каждый календарный день. Сегодняшнее значение ещё меняется.'},
  battery:{label:'Body Battery',field:'bodyBatteryHighest',section:'daily',unit:'/ 100',partial:true,description:'На графике — дневной пик Body Battery. Текущий заряд показывается отдельно и не смешивается с пиками.'},
  stress:{label:'Стресс',field:'averageStress',section:'daily',unit:'/ 100',partial:true,description:'Средний стресс за день по шкале Garmin. Сегодняшнее значение ещё меняется.'},
  hrv:{label:'Ночной HRV',field:'hrvNightAverage',section:'hrv',unit:'мс',description:'Средняя вариабельность пульса за ночь по данным Garmin.'}
};
export function shiftHealthDay(day,offset){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
export function healthPeriod(rawRows,today,days=7){
  if(![2,3,7,30].includes(days))days=7;
  const start=shiftHealthDay(today,1-days),rows=new Map();
  for(const raw of rawRows){const row=garminHealth(raw);if(!row||row.day<start||row.day>today)continue;const old=rows.get(row.day);if(!old||Date.parse(row.updated||'')>=Date.parse(old.updated||'')||!old.updated)rows.set(row.day,row);}
  return Array.from({length:days},(_,i)=>{const day=shiftHealthDay(start,i);return {day,row:rows.get(day)||null};});
}
export const healthWeek=(rows,today)=>healthPeriod(rows,today,7);
export function mergeHealthHistory(previous,incoming,today){
  return healthPeriod([...previous,...incoming],today,30).map(point=>point.row).filter(Boolean).reverse();
}
export function metricValue(row,key){
  const metric=healthMetrics[key];
  if(!row||!metric||row.warnings.includes(metric.section)||(key==='pulse'&&row.warnings.includes('daily')))return null;
  return row[metric.field];
}
export function healthSummary(week,key,today){
  const metric=healthMetrics[key],points=week.map(({day,row})=>({day,value:metricValue(row,key),partial:metric.partial===true&&day===today}));
  const available=points.filter(p=>p.value!==null),complete=available.filter(p=>!p.partial);
  const average=complete.length?complete.reduce((sum,p)=>sum+p.value,0)/complete.length:null;
  // Compare equal calendar windows; missing days must not shift the comparison.
  const comparable=points.filter(p=>!p.partial),half=Math.floor(comparable.length/2),left=comparable.slice(0,half),right=comparable.slice(half,half*2);
  const change=half>0&&left.every(p=>p.value!==null)&&right.every(p=>p.value!==null)?right.reduce((sum,p)=>sum+p.value,0)/half-left.reduce((sum,p)=>sum+p.value,0)/half:null;
  return {points,available:available.length,count:complete.length,average,change,comparison:{left:left.map(p=>p.day),right:right.map(p=>p.day)},minimum:complete.length?Math.min(...complete.map(p=>p.value)):null,maximum:complete.length?Math.max(...complete.map(p=>p.value)):null};
}
export function formatHealth(value,key){
  if(value===null)return '—';
  if(key==='sleep'){const minutes=Math.round(Math.abs(value)/60);return `${value<0?'−':''}${Math.floor(minutes/60)} ч ${minutes%60} мин`;}
  return new Intl.NumberFormat('ru',{maximumFractionDigits:key==='hrv'?1:0}).format(value);
}
