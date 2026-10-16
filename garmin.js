// Shared validation for browser imports and persisted source metadata.
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
function validDay(day){
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
  const parsed=new Date(day+'T12:00:00');return !Number.isNaN(parsed.getTime())&&parsed.getFullYear()===Number(day.slice(0,4))&&parsed.getMonth()+1===Number(day.slice(5,7))&&parsed.getDate()===Number(day.slice(8,10));
}
export function garminHealth(raw){
  if(!validDay(raw?.day))return null;
  const output={day:raw.day,updated:typeof raw.updated==='string'&&Number.isFinite(Date.parse(raw.updated))?raw.updated:null,warnings:Array.isArray(raw.warnings)?raw.warnings.filter(s=>['daily','heart','sleep','hrv'].includes(s)):[]};
  for(const [key,min,max] of [['steps',0,200000],['restingHeartRate',20,260],['minimumHeartRate',20,260],['maximumHeartRate',20,260],['averageStress',0,100],['bodyBattery',0,100],['bodyBatteryHighest',0,100],['hrvNightAverage',1,500],['sleepSeconds',1,86400],['sleepScore',0,100]])output[key]=finite(raw[key],min,max);
  output.sleepStages=Object.fromEntries(['deep','light','rem','awake'].map(key=>[key,output.sleepSeconds===null?null:finite(raw.sleepStages?.[key],0,86400)]));
  if(output.sleepSeconds===null)output.sleepScore=null;
  return output;
}
export function garminURL(value){
  let url;try{url=new URL(value);}catch{throw new Error('Проверь адрес Garmin-сервиса');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('Нужен HTTPS-адрес сервиса без пароля и дополнительных путей');
  return url.origin;
}
export function garminSource(raw){
  if(raw?.provider!=='garmin'||typeof raw.id!=='string'||! /^[1-9][0-9]{0,29}$/.test(raw.id))return null;
  const samples=(Array.isArray(raw.heartRateSamples)?raw.heartRateSamples:[]).slice(0,300).filter(s=>finite(s?.timestamp,1,1e15)!==null&&finite(s?.bpm,20,260)!==null).map(s=>({timestamp:s.timestamp,bpm:s.bpm})).sort((a,b)=>a.timestamp-b.timestamp);
  return {provider:'garmin',id:raw.id,typeKey:typeof raw.typeKey==='string'?raw.typeKey.slice(0,80):null,title:typeof raw.title==='string'?raw.title.slice(0,160):'Тренировка Garmin',averageHeartRate:finite(raw.averageHeartRate,20,260),maximumHeartRate:finite(raw.maximumHeartRate,20,260),movingDurationSeconds:finite(raw.movingDurationSeconds,0,604800),elapsedDurationSeconds:finite(raw.elapsedDurationSeconds,0,604800),heartRateSamples:samples};
}
const running=new Set(['running','trail_running','treadmill_running','track_running','street_running','indoor_running','virtual_run','ultra_run']);
export function garminWorkout(activity){
  if(!validDay(activity?.day))return null;
  const type=running.has(activity.typeKey)?'run':activity.typeKey==='soccer'?'football':['lap_swimming','open_water_swimming','swimming','pool_swimming'].includes(activity.typeKey)?'swim':'other';
  const source=garminSource({provider:'garmin',id:activity.activityId,title:activity.title,typeKey:activity.typeKey,...Object.fromEntries(['averageHeartRate','maximumHeartRate','movingDurationSeconds','elapsedDurationSeconds','heartRateSamples'].map(key=>[key,activity[key]]))});if(!source)return null;
  const meters=finite(activity.distanceMeters,0,type==='other'?5000000:500000),seconds=finite(type==='swim'&&activity.movingDurationSeconds>0?activity.movingDurationSeconds:activity.durationSeconds,0,type==='other'?604800:86400);
  const distance=meters>0?meters/1000:null,minutes=seconds>0?seconds/60:null;
  if((distance===null&&minutes===null)||(['football','swim'].includes(type)&&minutes===null))return null;
  return {type,day:activity.day,distance,minutes,source};
}
export async function garminRequest(url,path,{token,password,method='GET'}={}){
  const response=await fetch(garminURL(url)+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(password!==undefined?{'Content-Type':'application/json'}:{})},...(password!==undefined?{body:JSON.stringify({password})}:{}),cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status===401)throw new Error('Проверь пароль подключения или подключись заново');
  if(response.status===429)throw new Error('Слишком много попыток. Подожди минуту');
  if(!response.ok)throw new Error('Garmin-сервис сейчас недоступен');
  try{return await response.json();}catch{throw new Error('Сервис вернул неожиданный ответ. Проверь его адрес');}
}
