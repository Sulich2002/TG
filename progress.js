import {garminSource,garminWorkout} from './garmin.js?v=0.15.1';
export const tasks = [
  { id:'warmup', title:'Размяться', description:'Немного движения в комфортном темпе', xp:5, icon:'sun' },
  { id:'shower', title:'Принять душ', description:'Освежиться и начать день', xp:5, icon:'water' },
  { id:'breakfast', title:'Позавтракать', description:'Выделить время на завтрак', xp:5, icon:'cup' },
  { id:'reading', title:'Почитать', description:'Несколько страниц для себя', xp:10, icon:'book' }
];
export const workoutTypes = { run:'Бег', football:'Футбол', swim:'Плавание', home:'Домашняя тренировка', gym:'Зал', other:'Занятие с Garmin' };
export const exercises = { pushups:'Отжимания', pullups:'Подтягивания', squats:'Приседания' };
export const muscleGroups = { back:'Спина', chest:'Грудь', legs:'Ноги', shoulders:'Плечи', arms:'Руки', full:'Всё тело' };
const legacyRewards = {run:50,football:50,home:40,gym:60};
export const planSizes = { small:{title:'Небольшое',xp:5}, medium:{title:'Обычное',xp:10}, large:{title:'Большое',xp:20} };
const roundXP = value => Math.round(value*10)/10;
function habitRecord(raw){
  if(!raw||typeof raw.id!=='string'||!/^[A-Za-z0-9:_-]{1,100}$/.test(raw.id))return null;
  const standard=tasks.find(task=>task.id===raw.id);
  const title=standard?.title||(typeof raw.title==='string'?raw.title.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80):'');
  const xp=standard?.xp??raw.xp;
  return title&&[5,10].includes(xp)&&(standard||raw.id.startsWith('custom:'))?{id:raw.id,title,xp}:null;
}
function normalizeHabits(raw){
  const seen=new Set();return raw.slice(0,100).flatMap(item=>{const habit=habitRecord(item);if(!habit||seen.has(habit.id))return [];seen.add(habit.id);return [{...habit,archived:item.archived===true,updatedAt:Number.isSafeInteger(item.updatedAt)&&item.updatedAt>=0?item.updatedAt:0}];});
}
export function habitDefinitions(value){return Array.isArray(value?.habits)?normalizeHabits(value.habits):tasks.map(({id,title,xp})=>({id,title,xp,archived:false,updatedAt:0}));}
export function dailyHabits(value){return habitDefinitions(value).filter(habit=>!habit.archived).map(habit=>({...habit,description:tasks.find(task=>task.id===habit.id)?.description||'Твоя ежедневная привычка',icon:tasks.find(task=>task.id===habit.id)?.icon||'check'}));}
export function mergeHabits(remote,local){
  if(!Array.isArray(remote.habits)&&!Array.isArray(local.habits))return undefined;
  const merged=new Map();for(const habit of [...habitDefinitions(remote),...habitDefinitions(local)]){const old=merged.get(habit.id);if(!old||habit.updatedAt>=old.updatedAt)merged.set(habit.id,habit);}return [...merged.values()];
}
export const formatXP = value => new Intl.NumberFormat('ru',{maximumFractionDigits:1}).format(value);
export const dayBonus = 20;
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && dayKey(parsed) === value;
}
function number(value, label, max, optional = false, integer = false, zero = false) {
  if (optional && (value === '' || value == null)) return null;
  if (value === '' || value == null) throw new Error(`Заполни поле «${label}»`);
  const result = typeof value === 'number' ? value : Number(String(value).replace(',','.'));
  if (!Number.isFinite(result) || result < (zero ? 0 : Number.MIN_VALUE) || result > max || (integer && !Number.isInteger(result))) throw new Error(`Проверь поле «${label}»`);
  return result;
}
export function workoutData(input, today = dayKey()) {
  if (!Object.hasOwn(workoutTypes,input?.type)) throw new Error('Выбери вид тренировки');
  const day = input.day || today;
  if (!validDay(day) || day > today) throw new Error('Выбери дату не позднее сегодняшней');
  const data = {type:input.type, day};
  if (input.type === 'run' || input.type === 'football' || input.type==='swim') {
    data.distance = number(input.distance,'Расстояние',input.type==='swim'?100:500,true);
    data.minutes = number(input.minutes,'Время',1440,input.type === 'run');
    if (data.distance === null && data.minutes === null) throw new Error('Укажи расстояние или время пробежки');
  } else if (input.type === 'home') {
    if (!Object.hasOwn(exercises,input.exercise)) throw new Error('Выбери упражнение');
    data.exercise = input.exercise;
    const raw = Array.isArray(input.reps) ? input.reps : String(input.reps || '').trim().split(/[,;\s]+/);
    if (raw.length < 1 || raw.length > 30) throw new Error('Укажи от 1 до 30 подходов');
    data.reps = raw.map(rep => number(rep,'Повторения',1000,false,true));
  } else if(input.type==='other') {
    if(!garminSource(input.source))throw new Error('Неизвестный источник занятия');
    data.distance=number(input.distance,'Расстояние',5000,true);
    data.minutes=number(input.minutes,'Время',10080,true);
    if(data.distance===null&&data.minutes===null)throw new Error('В записи часов нет времени или расстояния');
  } else {
    // Accept both the original single-exercise record and new grouped sessions.
    const entries = Array.isArray(input.exercises) ? input.exercises : [input];
    if (!entries.length || entries.length > 40) throw new Error('Добавь от 1 до 40 упражнений');
    data.exercises = entries.map(entry => {
      if (!Object.hasOwn(muscleGroups,entry.group)) throw new Error('Выбери группу мышц');
      const exercise = String(entry.exercise || '').trim().slice(0,80);
      if (!exercise) throw new Error('Напиши название упражнения');
      return {group:entry.group,exercise,weight:number(entry.weight,'Вес',1000,false,false,true),sets:number(entry.sets,'Подходы',30,false,true),reps:number(entry.reps,'Повторения',1000,false,true)};
    });
  }
  if(input.source){const source=garminSource(input.source);if(source)data.source=source;}
  return data;
}
export function normalize(value) {
  const base = Number.isSafeInteger(value?.base) && value.base >= 0 ? value.base : 0;
  const seen = new Set();
  const events = [];
  if (Array.isArray(value?.events)) for (const raw of value.events) {
    if (!raw || typeof raw.id !== 'string' || seen.has(raw.id) || !validDay(raw.day)) continue;
    let event;
    if (raw.kind === 'task') {
      const task = tasks.find(item=>item.id===raw.task);
      if (!task || raw.id !== `${raw.day}:${task.id}`) continue;
      event = {id:raw.id,day:raw.day,kind:'task',task:task.id,xp:raw.rewardVersion===2?task.xp:task.id==='reading'?20:10,...(raw.rewardVersion===2?{rewardVersion:2}:{})};
    } else if (raw.kind === 'workout') {
      try { const data = workoutData(raw.data); if(data.day!==raw.day) continue; event={id:raw.id,day:raw.day,kind:'workout',data,xp:raw.xpRule==='volume-v1'?workoutXP(data):(legacyRewards[data.type]??0),...(raw.xpRule==='volume-v1'?{xpRule:'volume-v1'}:{})}; } catch {continue;}
    } else if(raw.kind==='plan') {
      const plan=normalizePlans([raw.plan])[0];
      if(!plan || raw.id!==`plan:${plan.id}`)continue;
      event={id:raw.id,day:raw.day,kind:'plan',plan,xp:raw.rewardVersion===2?planSizes[plan.size].xp:({small:5,medium:15,large:30})[plan.size],...(raw.rewardVersion===2?{rewardVersion:2}:{})};
    } else if(raw.kind==='achievement') {
      const item=achievementCatalog.find(item=>item.id===raw.achievement);
      if(!item || raw.id!==`achievement:${item.id}`)continue;
      event={id:raw.id,day:raw.day,kind:'achievement',achievement:item.id,xp:item.xp};
    } else if(raw.kind==='habit') {
      const habit=habitRecord(raw.habit);if(!habit||raw.id!==`${raw.day}:habit:${habit.id}`)continue;
      event={id:raw.id,day:raw.day,kind:'habit',habit,xp:habit.xp};
    } else if(raw.kind==='habit-bonus') {
      if(raw.id!==`${raw.day}:habit-bonus`||!Array.isArray(raw.required)||!raw.required.length||raw.required.length>100||raw.required.some(id=>typeof id!=='string'||!/^[A-Za-z0-9:_-]{1,100}$/.test(id))||new Set(raw.required).size!==raw.required.length)continue;
      event={id:raw.id,day:raw.day,kind:'habit-bonus',required:[...raw.required],xp:dayBonus};
    } else continue;
    seen.add(event.id);
    events.push(event);
  }
  const legacyIds=new Set(events.filter(event=>event.kind==='task').map(event=>event.day+':'+event.task));
  const unique=events.filter(event=>event.kind!=='habit'||!legacyIds.has(event.day+':'+event.habit.id));
  const done=new Map(),legacy=new Map();for(const event of unique){if(event.kind==='task'||event.kind==='habit'){if(!done.has(event.day))done.set(event.day,new Set());done.get(event.day).add(event.task||event.habit.id);}if(event.kind==='task'){if(!legacy.has(event.day))legacy.set(event.day,new Set());legacy.get(event.day).add(event.task);}}
  const verified=unique.filter(event=>event.kind!=='habit-bonus'||(legacy.get(event.day)?.size!==tasks.length&&event.required.every(id=>done.get(event.day)?.has(id))));
  return {base,events:verified,plans:normalizePlans(value?.plans),...(Array.isArray(value?.habits)?{habits:normalizeHabits(value.habits)}:{})};
}
export function migrate(legacy) {
  return {base:Number.isSafeInteger(legacy?.total) && legacy.total>=0 ? legacy.total : 0,events:[],plans:[]};
}
export function completed(value, day=dayKey()) {
  return [...new Set(normalize(value).events.filter(event=>['task','habit'].includes(event.kind)&&event.day===day).map(event=>event.task||event.habit.id))];
}
export function bonusDays(value) {
  const days = new Map();
  for (const event of normalize(value).events) if(event.kind==='task') {
    if(!days.has(event.day)) days.set(event.day,new Set());
    days.get(event.day).add(event.task);
  }
  return [...days].filter(([,items])=>items.size===tasks.length).map(([day])=>day);
}
export function totalXP(value) {
  const state=normalize(value);
  return roundXP(state.base + state.events.reduce((sum,event)=>sum+event.xp,0) + bonusDays(state).length*dayBonus);
}
export function dayHasBonus(value,day=dayKey()){const state=normalize(value);return bonusDays(state).includes(day)||state.events.some(event=>event.kind==='habit-bonus'&&event.day===day);}
function settleHabitBonus(value,day){
  const state=normalize(value);if(!Array.isArray(state.habits)||dayHasBonus(state,day))return state;
  const active=dailyHabits(state),done=new Set(completed(state,day));
  return active.length&&active.every(habit=>done.has(habit.id))?{...state,events:[...state.events,{id:`${day}:habit-bonus`,day,kind:'habit-bonus',required:active.map(habit=>habit.id),xp:dayBonus}]}:state;
}
export function addHabit(value,input,id,day=dayKey()){
  const state=normalize(value),habits=habitDefinitions(state),habit=habitRecord({...input,id:'custom:'+id});
  if(!habit||!validDay(day))throw new Error('Напиши название привычки и выбери 5 или 10 XP');
  if(habits.length>=100)throw new Error('Можно сохранить до 100 привычек вместе с удалёнными');
  if(habits.some(item=>item.id===habit.id))return state;
  return settleHabitBonus({...state,habits:[...habits,{...habit,archived:false,updatedAt:Date.now()}]},day);
}
export function archiveHabit(value,id,archived=true,day=dayKey()){
  const state=normalize(value),habits=habitDefinitions(state);if(!habits.some(item=>item.id===id)||!validDay(day))return state;
  return settleHabitBonus({...state,habits:habits.map(habit=>habit.id===id?{...habit,archived,updatedAt:Date.now()}:habit)},day);
}
export function complete(value,id,day=dayKey()) {
  const state=normalize(value),task=dailyHabits(state).find(item=>item.id===id);
  if(!task || !validDay(day) || completed(state,day).includes(id)) return state;
  if(Array.isArray(state.habits))return settleHabitBonus({...state,events:[...state.events,{id:`${day}:habit:${id}`,day,kind:'habit',habit:{id:task.id,title:task.title,xp:task.xp},xp:task.xp}]},day);
  return {...state,events:[...state.events,{id:`${day}:${id}`,day,kind:'task',task:id,xp:task.xp,rewardVersion:2}]};
}
export function addWorkout(value,input,id,today=dayKey()) {
  const state=normalize(value);
  if(typeof id!=='string'||!id) throw new Error('Не удалось создать запись');
  if(state.events.some(event=>event.id===id)) return state;
  const data=workoutData(input,today);
  return {...state,events:[...state.events,{id,day:data.day,kind:'workout',data,xp:workoutXP(data),xpRule:'volume-v1'}]};
}
const format=value=>new Intl.NumberFormat('ru',{maximumFractionDigits:2}).format(value);
export function workoutDescription(data) {
  if(data.type==='swim')return [data.distance!=null?`${format(data.distance*1000)} м`:null,`${format(data.minutes)} мин`,swimmingPace(data)].filter(Boolean).join(' · ');
  if(data.type==='other')return [data.source?.title||'Занятие с Garmin',data.distance!=null?`${format(data.distance)} км`:null,data.minutes!=null?`${format(data.minutes)} мин`:null].filter(Boolean).join(' · ');
  if(data.type==='run'||data.type==='football') return [data.distance!=null?`${format(data.distance)} км`:null,data.minutes!=null?`${format(data.minutes)} мин`:null,data.type==='run'?runningPace(data):null].filter(Boolean).join(' · ');
  if(data.type==='home') return `${exercises[data.exercise]} · ${data.reps.join(' / ')}`;
  return data.exercises.map(entry=>`${muscleGroups[entry.group]} · ${entry.exercise} · ${format(entry.weight)} кг · ${entry.sets} × ${entry.reps}`).join(' / ');
}
export function personalRecords(value) {
  const workouts=normalize(value).events.filter(event=>event.kind==='workout');
  const record=(exercise)=> {
    const entries=workouts.filter(event=>event.data.type==='home'&&event.data.exercise===exercise).sort((a,b)=>a.day.localeCompare(b.day));
    if(!entries.length) return null;
    return {best:Math.max(...entries.flatMap(event=>event.data.reps)),first:Math.max(...entries[0].data.reps),latest:Math.max(...entries.at(-1).data.reps)};
  };
  const gymMap=new Map();
  for(const event of [...workouts].sort((a,b)=>a.day.localeCompare(b.day))) if(event.data.type==='gym') for(const entry of event.data.exercises) {
    const key=entry.group+':'+entry.exercise.toLocaleLowerCase('ru');
    const item=gymMap.get(key)||{group:entry.group,exercise:entry.exercise,bestWeight:0,bestVolume:0,firstWeight:entry.weight,latestWeight:entry.weight};
    item.bestWeight=Math.max(item.bestWeight,entry.weight);item.bestVolume=Math.max(item.bestVolume,entry.weight*entry.sets*entry.reps);item.latestWeight=entry.weight;gymMap.set(key,item);
  }
  return {gym:[...gymMap.values()],pushups:record('pushups'),pullups:record('pullups'),runs:workouts.filter(event=>event.data.type==='run').length,kilometers:workouts.filter(event=>event.data.type==='run').reduce((sum,event)=>sum+(event.data.distance||0),0),workouts:workouts.length};
}

export function workoutXP(data) {
  if(data.type==='other')return 0;
  if(data.type==='run') return roundXP(data.distance!=null ? data.distance*10 : data.minutes/2);
  if(data.type==='football'||data.type==='swim') return roundXP(data.minutes);
  if(data.type==='home') return roundXP(data.reps.reduce((sum,rep)=>sum+rep,0)*(data.exercise==='pullups'?.5:.1));
  return roundXP(data.exercises.reduce((sum,entry)=>sum+entry.sets*2+entry.weight*entry.sets*entry.reps/100,0));
}
export function swimmingPace(data){if(!data.distance||!data.minutes)return null;const seconds=Math.round(data.minutes*60/(data.distance*10));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} мин/100 м`;}
export function runningPace(data) {
  if(!data.distance || !data.minutes) return null;
  const seconds=Math.round(data.minutes*60/data.distance);
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} мин/км`;
}
export function levelCost(level){
  return 100*Math.ceil(Math.max(1,level)/2);
}
export function xpBeforeLevel(level){
  const completed=Math.max(0,level-1),pairs=Math.floor(completed/2),odd=completed%2;
  return 100*(pairs*(pairs+1)+odd*(pairs+1));
}
export function levelProgress(total) {
  const xp=Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Number.isFinite(total)?total:0));
  let low=1,high=2;
  while(xpBeforeLevel(high)<=xp)high*=2;
  while(high-low>1){const middle=Math.floor((low+high)/2);if(xpBeforeLevel(middle)<=xp)low=middle;else high=middle;}
  const start=xpBeforeLevel(low);
  return {level:low,current:roundXP(xp-start),required:levelCost(low),start};
}
function normalizePlans(plans) {
  const seen=new Set();
  return (Array.isArray(plans)?plans:[]).filter(plan=>{
    if(!plan||typeof plan.id!=='string'||!plan.id||seen.has(plan.id)||!validDay(plan.day)||typeof plan.title!=='string'||!plan.title.trim()||!Object.hasOwn(planSizes,plan.size))return false;
    seen.add(plan.id);return true;
  }).map(plan=>({id:plan.id,day:plan.day,title:plan.title.trim().slice(0,100),size:plan.size}));
}
export function addPlan(value,input,id,day=dayKey()) {
  const state=normalize(value);
  if(state.plans.some(plan=>plan.id===id))return state;
  const plan=normalizePlans([{...input,id,day}])[0];
  if(!plan)throw new Error('Напиши дело и выбери его размер');
  return {...state,plans:[...state.plans,plan]};
}
export function completePlan(value,id,today=dayKey()) {
  const state=normalize(value),plan=state.plans.find(plan=>plan.id===id);
  if(!plan||plan.day>today||state.events.some(event=>event.id===`plan:${id}`))return state;
  return {...state,events:[...state.events,{id:`plan:${id}`,day:today,kind:'plan',plan,xp:planSizes[plan.size].xp,rewardVersion:2}]};
}
export function removePlan(value,id) {
  const state=normalize(value);
  if(state.events.some(event=>event.id===`plan:${id}`))return state;
  return {...state,plans:state.plans.filter(plan=>plan.id!==id)};
}

export function shiftDay(day,offset){const date=new Date(day+'T12:00:00');date.setDate(date.getDate()+offset);return dayKey(date);}
export function weekStart(day=dayKey()){const date=new Date(day+'T12:00:00');return shiftDay(day,-((date.getDay()+6)%7));}
export function activeStreak(value,today=dayKey()){
 const days=new Set(normalize(value).events.filter(event=>['task','habit','workout','plan'].includes(event.kind)).map(event=>event.day));
 let cursor=days.has(today)?today:shiftDay(today,-1),current=0;
 while(days.has(cursor)){current++;cursor=shiftDay(cursor,-1);}
 let longest=0,run=0,previous;
 for(const day of [...days].sort()){run=previous&&shiftDay(previous,1)===day?run+1:1;longest=Math.max(longest,run);previous=day;}
 return {current,longest,days:days.size};
}
export function weeklySummary(value,anchor=dayKey()){
 const state=normalize(value),start=weekStart(anchor),days=Array.from({length:7},(_,index)=>shiftDay(start,index));
 const events=state.events.filter(event=>days.includes(event.day)),workouts=events.filter(event=>event.kind==='workout');
 const groups=Object.fromEntries(Object.keys(muscleGroups).map(group=>[group,0]));let volume=0;
 for(const event of workouts)if(event.data.type==='gym')for(const entry of event.data.exercises){groups[entry.group]+=entry.sets;volume+=entry.weight*entry.sets*entry.reps;}
 return {start,days:days.map(day=>({day,workouts:workouts.filter(event=>event.day===day).length})),workouts:workouts.length,kilometers:roundXP(workouts.filter(event=>event.data.type==='run').reduce((sum,event)=>sum+(event.data.distance||0),0)),minutes:roundXP(workouts.filter(event=>['run','football','swim'].includes(event.data.type)).reduce((sum,event)=>sum+(event.data.minutes||0),0)),volume,groups};
}
// Existing achievement IDs and rewards remain stable for previously awarded XP.
export const achievementCatalog=[
 {id:'first-workout',category:'routine',metric:'workouts',title:'Начало положено',description:'Записать первую тренировку',xp:15,icon:'activity',target:1,unit:'занятие'},
 {id:'full-day',category:'routine',metric:'fullDays',title:'День для себя',description:'Выполнить весь базовый набор за день',xp:10,icon:'sun',target:1,unit:'день'},
 {id:'run-10',category:'run',metric:'runTotal',title:'Первые 10 километров',description:'Пробежать суммарно 10 км',xp:30,icon:'chart',target:10,unit:'км'},
 {id:'streak-10',category:'routine',metric:'streak',title:'В своём ритме',description:'10 дней подряд отмечать дела или занятия',xp:50,icon:'flame',target:10,unit:'дней'},
 {id:'gym-5',category:'strength',metric:'gymCount',title:'Пять встреч с железом',description:'Записать 5 занятий в зале',xp:30,icon:'activity',target:5,unit:'занятий'},
 {id:'pushups-1000',category:'strength',metric:'pushupsTotal',title:'Тысяча повторений',description:'Накопить 1000 отжиманий',xp:50,icon:'person',target:1000,unit:'повт.'},
 {id:'run-50',category:'run',metric:'runTotal',title:'Полсотни за спиной',description:'Пробежать суммарно 50 км',xp:40,icon:'chart',target:50,unit:'км'},
 {id:'run-100',category:'run',metric:'runTotal',title:'Первая сотня',description:'Пробежать суммарно 100 км',xp:60,icon:'chart',target:100,unit:'км'},
 {id:'run-500',category:'run',metric:'runTotal',title:'Большой путь',description:'Пробежать суммарно 500 км',xp:100,icon:'chart',target:500,unit:'км'},
 {id:'run-single-5',category:'run',metric:'runLongest',title:'Пятёрка одним махом',description:'Пробежать 5 км за одну тренировку',xp:15,icon:'activity',target:5,unit:'км'},
 {id:'run-single-10',category:'run',metric:'runLongest',title:'Десятка за раз',description:'Пробежать 10 км за одну тренировку',xp:25,icon:'activity',target:10,unit:'км'},
 {id:'run-half',category:'run',metric:'runLongest',title:'Полумарафон',description:'21,0975 км за одну пробежку',xp:75,icon:'award',target:21.0975,unit:'км'},
 {id:'run-marathon',category:'run',metric:'runLongest',title:'Марафон',description:'42,195 км за одну пробежку',xp:150,icon:'award',target:42.195,unit:'км'},
 {id:'bench-40',category:'strength',metric:'bench',title:'Первые сорок в жиме',description:'Жим штанги лёжа: записать подход с 40 кг',xp:20,icon:'activity',target:40,unit:'кг'},
 {id:'bench-60',category:'strength',metric:'bench',title:'Жим: 60',description:'Жим штанги лёжа: записать подход с 60 кг',xp:35,icon:'activity',target:60,unit:'кг'},
 {id:'bench-80',category:'strength',metric:'bench',title:'Жим: 80',description:'Жим штанги лёжа: записать подход с 80 кг',xp:50,icon:'activity',target:80,unit:'кг'},
 {id:'bench-100',category:'strength',metric:'bench',title:'Сотня в жиме',description:'Жим штанги лёжа: записать подход со 100 кг',xp:75,icon:'award',target:100,unit:'кг'},
 {id:'squat-60',category:'strength',metric:'squat',title:'Присед: 60',description:'Присед со штангой: записать подход с 60 кг',xp:25,icon:'activity',target:60,unit:'кг'},
 {id:'squat-100',category:'strength',metric:'squat',title:'Сотня в приседе',description:'Присед со штангой: записать подход со 100 кг',xp:50,icon:'award',target:100,unit:'кг'},
 {id:'pullups-10',category:'strength',metric:'pullupsBest',title:'Десятка на перекладине',description:'10 подтягиваний в одном подходе',xp:25,icon:'person',target:10,unit:'повт.'},
 {id:'pullups-15',category:'strength',metric:'pullupsBest',title:'Пятнадцать на перекладине',description:'15 подтягиваний в одном подходе',xp:40,icon:'person',target:15,unit:'повт.'},
 {id:'pushups-50',category:'strength',metric:'pushupsBest',title:'Полсотни за подход',description:'50 отжиманий в одном подходе',xp:25,icon:'person',target:50,unit:'повт.'}
];
const strengthAliases={
 bench:new Set(['жим лежа','жим штанги лежа','жим лежа со штангой','горизонтальный жим штанги','bench press','barbell bench press']),
 squat:new Set(['присед','приседания','присед со штангой','приседания со штангой','присед со штангой на спине','приседания со штангой на спине','barbell squat','back squat'])
};
function strengthMovement(entry){
 const name=entry.exercise.toLowerCase().replaceAll('ё','е').replace(/[.,:;!]/g,'').replace(/\s+/g,' ').trim();
 return Object.keys(strengthAliases).find(key=>strengthAliases[key].has(name));
}
export function achievements(value){
 const state=normalize(value),records=personalRecords(state),workouts=state.events.filter(event=>event.kind==='workout');
 const metrics={workouts:records.workouts,fullDays:new Set([...bonusDays(state),...state.events.filter(event=>event.kind==='habit-bonus').map(event=>event.day)]).size,runTotal:records.kilometers,runLongest:0,streak:activeStreak(state).longest,gymCount:0,pushupsTotal:0,pushupsBest:0,pullupsBest:0,bench:0,squat:0};
 for(const {data} of workouts){
  if(data.type==='run')metrics.runLongest=Math.max(metrics.runLongest,data.distance||0);
  if(data.type==='home'){
   if(data.exercise==='pushups')metrics.pushupsTotal+=data.reps.reduce((sum,rep)=>sum+rep,0);
   if(data.exercise==='pushups'||data.exercise==='pullups')for(const reps of data.reps)metrics[data.exercise+'Best']=Math.max(metrics[data.exercise+'Best'],reps);
  }
  if(data.type==='gym'){
   metrics.gymCount++;
   for(const entry of data.exercises){const movement=strengthMovement(entry);if(movement)metrics[movement]=Math.max(metrics[movement],entry.weight);}
  }
 }
 const awarded=new Set(state.events.filter(event=>event.kind==='achievement').map(event=>event.achievement));
 return achievementCatalog.map(item=>({...item,current:metrics[item.metric],unlocked:metrics[item.metric]+1e-9>=item.target,awarded:awarded.has(item.id)}));
}
export function awardAchievements(value,today=dayKey()){
 const state=settleHabitBonus(value,today);
 const earned=achievements(state).filter(item=>item.unlocked&&!item.awarded).map(item=>({id:`achievement:${item.id}`,day:today,kind:'achievement',achievement:item.id,xp:item.xp}));
 return {...state,events:[...state.events,...earned]};
}


export function garminCandidates(value,activities,today=dayKey()){
 const state=normalize(value),seen=new Set(state.events.filter(e=>e.kind==='workout'&&e.data.source?.provider==='garmin').map(e=>e.data.source.id)),result=[];
 for(const activity of (Array.isArray(activities)?activities:[]).slice(0,100)){
  const input=garminWorkout(activity);if(!input||input.day>today||seen.has(input.source.id))continue;
  let data;try{data=workoutData(input,today);}catch{continue;}
  seen.add(input.source.id);
  const duplicate=state.events.some(e=>e.kind==='workout'&&!e.data.source&&e.data.type===data.type&&e.day===data.day&&((e.data.distance!=null&&data.distance!=null&&Math.abs(e.data.distance-data.distance)<=.1)||(e.data.minutes!=null&&data.minutes!=null&&Math.abs(e.data.minutes-data.minutes)<=2)));
  result.push({id:input.source.id,data,duplicate,title:data.source.title});
 }
 return result;
}
export function refreshGarminSources(value,activities){
 const state=normalize(value),sources=new Map();
 for(const raw of activities){const data=garminWorkout(raw);if(data)sources.set(data.source.id,data);}
 return {...state,events:state.events.map(event=>{
  if(event.kind!=='workout'||event.data.source?.provider!=='garmin')return event;
  const fresh=sources.get(event.data.source.id);if(!fresh||fresh.day!==event.day)return event;
  const source={...event.data.source};
  for(const [key,value] of Object.entries(fresh.source)){
   if(value===null||Array.isArray(value)&&!value.length||key==='metricsVersion'&&value<source.metricsVersion)continue;
   source[key]=value;
  }
  if(fresh.source.metricsVersion>=2)source.metricWarnings=fresh.source.metricWarnings;
  return {...event,data:{...event.data,source}};
 })};
}
export function importGarmin(value,activities,selected,today=dayKey()){
 let state=refreshGarminSources(value,activities);const ids=new Set(selected);
 for(const item of garminCandidates(state,activities,today))if(ids.has(item.id)&&!state.events.some(e=>e.id==='garmin:'+item.id))state=addWorkout(state,item.data,'garmin:'+item.id,today);
 return state;
}
