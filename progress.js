export const tasks = [
  { id:'warmup', title:'Размяться', description:'Немного движения в комфортном темпе', xp:5, icon:'sun' },
  { id:'shower', title:'Принять душ', description:'Освежиться и начать день', xp:5, icon:'water' },
  { id:'breakfast', title:'Позавтракать', description:'Выделить время на завтрак', xp:5, icon:'cup' },
  { id:'reading', title:'Почитать', description:'Несколько страниц для себя', xp:10, icon:'book' }
];
export const workoutTypes = { run:'Бег', football:'Футбол', home:'Домашняя тренировка', gym:'Зал' };
export const exercises = { pushups:'Отжимания', pullups:'Подтягивания', squats:'Приседания' };
export const muscleGroups = { back:'Спина', chest:'Грудь', legs:'Ноги', shoulders:'Плечи', arms:'Руки', full:'Всё тело' };
const legacyRewards = {run:50,football:50,home:40,gym:60};
export const planSizes = { small:{title:'Небольшое',xp:5}, medium:{title:'Обычное',xp:10}, large:{title:'Большое',xp:20} };
const roundXP = value => Math.round(value*10)/10;
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
  if (input.type === 'run' || input.type === 'football') {
    data.distance = number(input.distance,'Расстояние',500,true);
    data.minutes = number(input.minutes,'Время',1440,input.type === 'run');
    if (data.distance === null && data.minutes === null) throw new Error('Укажи расстояние или время пробежки');
  } else if (input.type === 'home') {
    if (!Object.hasOwn(exercises,input.exercise)) throw new Error('Выбери упражнение');
    data.exercise = input.exercise;
    const raw = Array.isArray(input.reps) ? input.reps : String(input.reps || '').trim().split(/[,;\s]+/);
    if (raw.length < 1 || raw.length > 30) throw new Error('Укажи от 1 до 30 подходов');
    data.reps = raw.map(rep => number(rep,'Повторения',1000,false,true));
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
      try { const data = workoutData(raw.data); if(data.day!==raw.day) continue; event={id:raw.id,day:raw.day,kind:'workout',data,xp:raw.xpRule==='volume-v1'?workoutXP(data):legacyRewards[data.type],...(raw.xpRule==='volume-v1'?{xpRule:'volume-v1'}:{})}; } catch {continue;}
    } else if(raw.kind==='plan') {
      const plan=normalizePlans([raw.plan])[0];
      if(!plan || raw.id!==`plan:${plan.id}`)continue;
      event={id:raw.id,day:raw.day,kind:'plan',plan,xp:raw.rewardVersion===2?planSizes[plan.size].xp:({small:5,medium:15,large:30})[plan.size],...(raw.rewardVersion===2?{rewardVersion:2}:{})};
    } else if(raw.kind==='achievement') {
      const item=achievementCatalog.find(item=>item.id===raw.achievement);
      if(!item || raw.id!==`achievement:${item.id}`)continue;
      event={id:raw.id,day:raw.day,kind:'achievement',achievement:item.id,xp:item.xp};
    } else continue;
    seen.add(event.id);
    events.push(event);
  }
  return {base,events,plans:normalizePlans(value?.plans)};
}
export function migrate(legacy) {
  return {base:Number.isSafeInteger(legacy?.total) && legacy.total>=0 ? legacy.total : 0,events:[],plans:[]};
}
export function completed(value, day=dayKey()) {
  return normalize(value).events.filter(event=>event.kind==='task'&&event.day===day).map(event=>event.task);
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
export function complete(value,id,day=dayKey()) {
  const state=normalize(value);
  const task=tasks.find(item=>item.id===id);
  if(!task || !validDay(day) || completed(state,day).includes(id)) return state;
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
  if(data.type==='run') return roundXP(data.distance!=null ? data.distance*10 : data.minutes/2);
  if(data.type==='football') return roundXP(data.minutes);
  if(data.type==='home') return roundXP(data.reps.reduce((sum,rep)=>sum+rep,0)*(data.exercise==='pullups'?.5:.1));
  return roundXP(data.exercises.reduce((sum,entry)=>sum+entry.sets*2+entry.weight*entry.sets*entry.reps/100,0));
}
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
 const days=new Set(normalize(value).events.filter(event=>['task','workout','plan'].includes(event.kind)).map(event=>event.day));
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
 return {start,days:days.map(day=>({day,workouts:workouts.filter(event=>event.day===day).length})),workouts:workouts.length,kilometers:roundXP(workouts.filter(event=>event.data.type==='run').reduce((sum,event)=>sum+(event.data.distance||0),0)),minutes:roundXP(workouts.reduce((sum,event)=>sum+(event.data.minutes||0),0)),volume,groups};
}
export const achievementCatalog=[
 {id:'first-workout',title:'Начало положено',description:'Записать первую тренировку',xp:15,icon:'activity',target:1},
 {id:'full-day',title:'День для себя',description:'Выполнить весь базовый набор за день',xp:10,icon:'sun',target:1},
 {id:'run-10',title:'Первые 10 километров',description:'Пробежать суммарно 10 км',xp:30,icon:'chart',target:10},
 {id:'streak-10',title:'В своём ритме',description:'10 дней подряд отмечать дела или занятия',xp:50,icon:'flame',target:10},
 {id:'gym-5',title:'Пять встреч с железом',description:'Записать 5 занятий в зале',xp:30,icon:'activity',target:5},
 {id:'pushups-1000',title:'Тысяча повторений',description:'Накопить 1000 отжиманий',xp:50,icon:'person',target:1000}
];
export function achievements(value){
 const state=normalize(value),records=personalRecords(state),workouts=state.events.filter(event=>event.kind==='workout');
 const metrics={'first-workout':records.workouts,'full-day':bonusDays(state).length,'run-10':records.kilometers,'streak-10':activeStreak(state).longest,'gym-5':workouts.filter(event=>event.data.type==='gym').length,'pushups-1000':workouts.filter(event=>event.data.type==='home'&&event.data.exercise==='pushups').reduce((sum,event)=>sum+event.data.reps.reduce((sum,rep)=>sum+rep,0),0)};
 return achievementCatalog.map(item=>({...item,current:metrics[item.id],unlocked:metrics[item.id]>=item.target,awarded:state.events.some(event=>event.id===`achievement:${item.id}`)}));
}
export function awardAchievements(value,today=dayKey()){
 const state=normalize(value);
 const earned=achievements(state).filter(item=>item.unlocked&&!item.awarded).map(item=>({id:`achievement:${item.id}`,day:today,kind:'achievement',achievement:item.id,xp:item.xp}));
 return {...state,events:[...state.events,...earned]};
}
