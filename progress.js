export const tasks = [
  { id:'warmup', title:'Размяться', description:'Немного движения в комфортном темпе', xp:10, icon:'sun' },
  { id:'shower', title:'Принять душ', description:'Освежиться и начать день', xp:10, icon:'water' },
  { id:'breakfast', title:'Позавтракать', description:'Выделить время на завтрак', xp:10, icon:'cup' },
  { id:'reading', title:'Почитать', description:'Несколько страниц для себя', xp:20, icon:'book' }
];
export const workoutTypes = { run:'Бег', football:'Футбол', home:'Домашняя тренировка', gym:'Зал' };
export const exercises = { pushups:'Отжимания', pullups:'Подтягивания', squats:'Приседания' };
export const muscleGroups = { back:'Спина', chest:'Грудь', legs:'Ноги', shoulders:'Плечи', arms:'Руки', full:'Всё тело' };
const rewards = {run:50,football:50,home:40,gym:60};
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
    if (!Object.hasOwn(muscleGroups,input.group)) throw new Error('Выбери группу мышц');
    data.group = input.group;
    data.exercise = String(input.exercise || '').trim().slice(0,80);
    if (!data.exercise) throw new Error('Напиши название упражнения');
    data.weight = number(input.weight,'Вес',1000,false,false,true);
    data.sets = number(input.sets,'Подходы',30,false,true);
    data.reps = number(input.reps,'Повторения',1000,false,true);
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
      event = {id:raw.id,day:raw.day,kind:'task',task:task.id,xp:task.xp};
    } else if (raw.kind === 'workout') {
      try { const data = workoutData(raw.data); if(data.day!==raw.day) continue; event={id:raw.id,day:raw.day,kind:'workout',data,xp:rewards[data.type]}; } catch {continue;}
    } else continue;
    seen.add(event.id);
    events.push(event);
  }
  return {base,events};
}
export function migrate(legacy) {
  return {base:Number.isSafeInteger(legacy?.total) && legacy.total>=0 ? legacy.total : 0,events:[]};
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
  return state.base + state.events.reduce((sum,event)=>sum+event.xp,0) + bonusDays(state).length*dayBonus;
}
export function complete(value,id,day=dayKey()) {
  const state=normalize(value);
  const task=tasks.find(item=>item.id===id);
  if(!task || !validDay(day) || completed(state,day).includes(id)) return state;
  return {...state,events:[...state.events,{id:`${day}:${id}`,day,kind:'task',task:id,xp:task.xp}]};
}
export function addWorkout(value,input,id,today=dayKey()) {
  const state=normalize(value);
  if(typeof id!=='string'||!id) throw new Error('Не удалось создать запись');
  if(state.events.some(event=>event.id===id)) return state;
  const data=workoutData(input,today);
  return {...state,events:[...state.events,{id,day:data.day,kind:'workout',data,xp:rewards[data.type]}]};
}
const format=value=>new Intl.NumberFormat('ru',{maximumFractionDigits:2}).format(value);
export function workoutDescription(data) {
  if(data.type==='run'||data.type==='football') return [data.distance!=null?`${format(data.distance)} км`:null,data.minutes!=null?`${format(data.minutes)} мин`:null].filter(Boolean).join(' · ');
  if(data.type==='home') return `${exercises[data.exercise]} · ${data.reps.join(' / ')}`;
  return `${muscleGroups[data.group]} · ${data.exercise} · ${format(data.weight)} кг · ${data.sets} × ${data.reps}`;
}
export function personalRecords(value) {
  const workouts=normalize(value).events.filter(event=>event.kind==='workout');
  const record=(exercise)=> {
    const entries=workouts.filter(event=>event.data.type==='home'&&event.data.exercise===exercise).sort((a,b)=>a.day.localeCompare(b.day));
    if(!entries.length) return null;
    return {best:Math.max(...entries.flatMap(event=>event.data.reps)),first:Math.max(...entries[0].data.reps),latest:Math.max(...entries.at(-1).data.reps)};
  };
  return {pushups:record('pushups'),pullups:record('pullups'),runs:workouts.filter(event=>event.data.type==='run').length,kilometers:workouts.filter(event=>event.data.type==='run').reduce((sum,event)=>sum+(event.data.distance||0),0),workouts:workouts.length};
}
