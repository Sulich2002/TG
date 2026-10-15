import { tasks, dayKey, normalize, migrate, totalXP, completed, complete, bonusDays, dayBonus, addWorkout, workoutTypes, exercises, muscleGroups, workoutDescription, personalRecords, workoutData, workoutXP, levelProgress, formatXP, addPlan, completePlan, removePlan, planSizes } from './progress.js?v=0.3.0';
const $=id=>document.getElementById(id);
const storageKey='my-character-v2';
let state;
try {
  const saved=localStorage.getItem(storageKey);
  state=saved ? normalize(JSON.parse(saved)) : migrate(JSON.parse(localStorage.getItem('my-player-v1')));
} catch {state=normalize(null);}
let avatar,avatarPromise;
let selectedPanel='today',historyFilter='all',renderedDay=dayKey(),toastTimeout,workoutType='run',workoutId;
const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
function element(tag,text,className) {const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
function notify(text) {$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('visible'),4000);}
function persist(next,message) {
  try {localStorage.setItem(storageKey,JSON.stringify(next));}
  catch {notify('Не удалось сохранить. Разреши хранение данных и попробуй ещё раз.');return false;}
  state=next;render();if(message)notify(message);return true;
}
function updateBack() {
  const back=window.Telegram?.WebApp?.BackButton;
  if(selectedPanel==='today'&&!document.querySelector('dialog[open]'))back?.hide();else back?.show();
}
function navigate(panel) {
  selectedPanel=panel;
  for(const name of ['today','character','workout','history','progress'])$('panel-'+name).hidden=name!==panel;
  for(const button of document.querySelectorAll('[data-panel]')) {
    const active=button.dataset.panel===panel;button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  if(panel==='character')ensureAvatar();else avatar?.setActive(false);
  updateBack();window.scrollTo({top:0,behavior:'instant'});
}
function renderHistory() {
  const events=[...state.events,...bonusDays(state).map(day=>({id:day+':bonus',day,kind:'bonus',xp:dayBonus}))].reverse().sort((a,b)=>b.day.localeCompare(a.day));
  const filtered=events.filter(event=>historyFilter==='all'||(historyFilter==='task'?event.kind!=='workout':event.kind==='workout'));
  const container=$('history-list');container.replaceChildren();
  if(!filtered.length) {
    const empty=element('div',null,'empty-state');empty.innerHTML=icon('history');empty.append(element('h2',historyFilter==='workout'?'Пока без тренировок':'Твоя история впереди'),element('p','Отметь дело или запиши занятие. Здесь появятся дата, результат и полученный опыт.'));container.append(empty);return;
  }
  let previous;
  for(const event of filtered) {
    if(event.day!==previous){container.append(element('h2',new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric'}).format(new Date(event.day+'T12:00:00')),'history-date'));previous=event.day;}
    const task=tasks.find(task=>task.id===event.task);
    const row=element('article',null,'history-item'),symbol=element('span',null,'history-icon');
    symbol.innerHTML=icon(event.kind==='workout'?'activity':event.kind==='bonus'?'sun':(task?.icon||'check'));
    const content=element('div');content.append(element('b',event.kind==='workout'?workoutTypes[event.data.type]:event.kind==='bonus'?'Все дела на сегодня выполнены':event.kind==='plan'?event.plan.title:task.title));
    content.append(element('small',event.kind==='workout'?workoutDescription(event.data):event.kind==='bonus'?'Бонус за полный набор':event.kind==='plan'?'Свой план · '+planSizes[event.plan.size].title:'Базовое дело: разминка, душ, завтрак или чтение'));
    row.append(symbol,content,element('strong',`+${formatXP(event.xp)} XP`));container.append(row);
  }
}
function renderRecords() {
  const records=personalRecords(state);$('total-workouts').textContent=records.workouts;
  const container=$('records');container.replaceChildren();
  for(const [key,title] of [['pushups','Отжимания за подход'],['pullups','Подтягивания за подход']]) {
    const record=records[key],card=element('article',null,'record'),top=element('div');
    top.append(element('h3',title),element('b',record?`${record.best}`:'—'));
    card.append(top,element('p',record?`Лучший результат: ${record.best}. Первая запись: ${record.first}, последняя: ${record.latest}.`:'Пока нет записей. Добавь домашнюю тренировку — здесь появятся реальные повторения.'));container.append(card);
  }
  const card=element('article',null,'record'),top=element('div');top.append(element('h3','Бег за всё время'),element('b',`${new Intl.NumberFormat('ru',{maximumFractionDigits:2}).format(records.kilometers)} км`));card.append(top,element('p',`Пробежек: ${records.runs}. Расстояние суммируется только там, где ты его указал.`));container.append(card);
  for(const record of records.gym){
    const card=element('article',null,'record'),top=element('div');top.append(element('h3',record.exercise),element('b',`${record.bestWeight} кг`));card.append(top,element('p',`${muscleGroups[record.group]} · максимальный записанный вес. Первый: ${record.firstWeight} кг, последний: ${record.latestWeight} кг. Наибольший объём: ${record.bestVolume} кг.`));container.append(card);
  }
  if(state.base>0)container.append(element('p',`Сохранено ${state.base} XP из раннего прототипа. Эти очки не считаются реальными тренировками.`,'gentle-note'));
}
function render() {
  state=normalize(state);renderedDay=dayKey();
  const total=totalXP(state),{level,current:xp,required}=levelProgress(total),done=completed(state);
  $('date').textContent=new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',weekday:'long'}).format(new Date()).toUpperCase();
  $('summary-level').textContent=`Уровень ${level} · ${formatXP(xp)} / ${required} XP`;$('level').textContent=`Уровень ${level}`;$('xp-text').textContent=`${formatXP(xp)} / ${required} XP`;$('xp-bar').style.width=`${xp/required*100}%`;$('total-xp').textContent=formatXP(total);avatar?.setLevel(level);$('body-stage').textContent=level<5?'НАЧАЛО ПУТИ':level<10?'ВХОДИШЬ В РИТМ':level<20?'НАБИРАЕШЬ ФОРМУ':'НОВЫЙ ОБЛИК';
  $('daily-count').textContent=`${done.length} / ${tasks.length}`;
  $('bonus-card').classList.toggle('earned',done.length===tasks.length);
  $('bonus-title').textContent=done.length===tasks.length?'Бонус получен. Ты справился!':'Бонус за весь набор';
  $('bonus-note').textContent=done.length===tasks.length?'Завтра будет новый день. Опыт останется.':'Выполни четыре дела в течение дня';
  $('daily-tasks').replaceChildren(...tasks.map(task=>{
    const isDone=done.includes(task.id),button=element('button',null,`daily-task${isDone?' done':''}`);
    button.disabled=isDone;button.setAttribute('aria-label',`${isDone?'Выполнено':'Выполнить'}: ${task.title}`);
    button.innerHTML=`<span class="task-symbol">${icon(task.icon)}</span><span class="daily-label"><b>${task.title}</b><small>${task.description}</small></span><span class="task-end"><b>+${task.xp} XP</b><span class="task-check">${isDone?icon('check'):''}</span></span>`;
    button.addEventListener('click',()=>{
      const next=complete(state,task.id),gain=totalXP(next)-totalXP(state);
      if(persist(next,`Дело сделано! +${formatXP(gain)} XP${gain>task.xp?' — с бонусом за день':''}`)) window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    });return button;
  }));renderPlans();renderHistory();renderRecords();
}
function renderPlans(){
  const list=$('plans-list'),plans=state.plans.filter(plan=>plan.day===dayKey());list.replaceChildren();
  if(!plans.length){list.append(element('p','Добавь своё первое дело. Например, пройти урок или сходить на работу.','plans-empty'));return;}
  for(const plan of plans){
    const done=state.events.some(event=>event.id===`plan:${plan.id}`),row=element('div',null,'plan-row'),button=element('button',null,`daily-task${done?' done':''}`);
    button.disabled=done;button.setAttribute('aria-label',`${done?'Выполнено':'Выполнить план'}: ${plan.title}`);
    const symbol=element('span',null,'task-symbol');symbol.innerHTML=icon('check');
    const label=element('span',null,'daily-label');label.append(element('b',plan.title),element('small',planSizes[plan.size].title));
    const end=element('span',null,'task-end');end.append(element('b',`+${planSizes[plan.size].xp} XP`));const check=element('span',null,'task-check');if(done)check.innerHTML=icon('check');end.append(check);button.append(symbol,label,end);
    button.addEventListener('click',()=>persist(completePlan(state,plan.id),`План выполнен! +${planSizes[plan.size].xp} XP`));row.append(button);
    if(!done){const remove=element('button','×','plan-remove');remove.setAttribute('aria-label',`Удалить план: ${plan.title}`);remove.addEventListener('click',()=>persist(removePlan(state,plan.id),'План удалён'));row.append(remove);}list.append(row);
  }
}
async function ensureAvatar(){
  if(avatar){avatar.setLevel(levelProgress(totalXP(state)).level);avatar.setActive(true);return;}
  if(avatarPromise)return;
  avatarPromise=import('./avatar.js?v=0.3.0').then(({createAvatar})=>{avatar=createAvatar($('avatar-viewport'),levelProgress(totalXP(state)).level);avatar.setActive(selectedPanel==='character');}).catch(()=>{$('avatar-hint').textContent='3D недоступна в этом браузере · упрощённый вид';$('avatar-viewport').dataset.unavailable='true';});
}
$('rotate-left').addEventListener('click',()=>avatar?.rotate(-.5));$('rotate-right').addEventListener('click',()=>avatar?.rotate(.5));$('reset-avatar').addEventListener('click',()=>avatar?.reset());
$('add-plan').addEventListener('click',()=>{$('plan-form').reset();$('plan-error').textContent='';$('plan-dialog').showModal();updateBack();});
$('close-plan').addEventListener('click',()=>$('plan-dialog').close());$('plan-dialog').addEventListener('close',updateBack);
$('plan-form').addEventListener('submit',event=>{event.preventDefault();try{const next=addPlan(state,Object.fromEntries(new FormData(event.currentTarget)),crypto.randomUUID());if(persist(next,'План добавлен'))$('plan-dialog').close();}catch(error){$('plan-error').textContent=error.message;}});
let gymEntryId=0;
function appendGymExercise(group){
  if(group.querySelectorAll('.gym-exercise').length>=15){notify('В этой группе уже 15 упражнений');return;}
  const entry=element('div',null,'gym-exercise');const index=++gymEntryId;
  entry.innerHTML=`<label for="gym-name-${index}">Упражнение</label><input id="gym-name-${index}" data-field="exercise" maxlength="80" required placeholder="Например, тяга блока"><div class="form-row triple-row"><div><label for="gym-weight-${index}">Вес, кг</label><input id="gym-weight-${index}" data-field="weight" type="number" min="0" max="1000" step="0.25" inputmode="decimal" required></div><div><label for="gym-sets-${index}">Подходы</label><input id="gym-sets-${index}" data-field="sets" type="number" min="1" max="30" value="3" inputmode="numeric" required></div><div><label for="gym-reps-${index}">Повторения</label><input id="gym-reps-${index}" data-field="reps" type="number" min="1" max="1000" value="10" inputmode="numeric" required></div></div><button type="button" class="remove-entry">Удалить упражнение</button>`;
  entry.querySelector('.remove-entry').addEventListener('click',()=>{if(group.querySelectorAll('.gym-exercise').length===1){notify('Оставь одно упражнение или удали группу');return;}entry.remove();previewWorkout();});
  group.querySelector('.gym-exercises').append(entry);
}
function appendGymGroup(){
  const list=$('gym-groups');if(list.children.length>=6){notify('В занятии уже шесть групп');return;}
  const group=element('fieldset',null,'gym-group'),index=++gymEntryId;
  group.innerHTML=`<legend>Группа мышц</legend><label for="gym-group-${index}">Выбери группу</label><select id="gym-group-${index}" class="gym-group-select">${Object.entries(muscleGroups).map(([value,title])=>`<option value="${value}">${title}</option>`).join('')}</select><div class="gym-exercises"></div><button type="button" class="outline-add add-exercise">+ Добавить упражнение</button><button type="button" class="remove-entry remove-group">Удалить группу</button>`;
  group.querySelector('.add-exercise').addEventListener('click',()=>{appendGymExercise(group);previewWorkout();});
  group.querySelector('.remove-group').addEventListener('click',()=>{if(list.children.length===1){notify('Оставь хотя бы одну группу мышц');return;}group.remove();previewWorkout();});
  list.append(group);appendGymExercise(group);
}
function readWorkout(){
  const input={...Object.fromEntries(new FormData($('workout-form'))),type:workoutType};
  if(workoutType==='gym')input.exercises=[...document.querySelectorAll('.gym-group')].flatMap(group=>[...group.querySelectorAll('.gym-exercise')].map(entry=>({group:group.querySelector('.gym-group-select').value,...Object.fromEntries([...entry.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]))})));
  return input;
}
function previewWorkout(){
  const rules={run:'10 XP/км; без расстояния — 1 XP за 2 мин.',football:'1 XP за минуту. Расстояние не начисляется повторно.',home:$('exercise')?.value==='pullups'?'1 XP за 2 подтягивания.':'1 XP за 10 повторений.',gym:'2 XP за подход + 1 XP за 100 кг объёма.'};
  try{const data=workoutData(readWorkout());$('workout-reward').textContent=`Награда: +${formatXP(workoutXP(data))} XP · ${rules[workoutType]}`;}
  catch{$('workout-reward').textContent=rules[workoutType]+' Заполни поля — увидишь свою награду.';}
}
$('workout-fields').addEventListener('input',previewWorkout);$('workout-fields').addEventListener('change',previewWorkout);$('workout-day').addEventListener('change',previewWorkout);
function openWorkout(type) {
  workoutType=type;workoutId=crypto.randomUUID();$('workout-title').textContent=workoutTypes[type];$('workout-form').reset();$('workout-day').value=dayKey();$('workout-day').max=dayKey();$('form-error').textContent='';$('save-workout').disabled=false;
  const fields=$('workout-fields');
  if(type==='run'||type==='football') {
    fields.innerHTML=`<label for="distance">Расстояние, км ${type==='football'?'(необязательно)':''}</label><input id="distance" name="distance" type="number" min="0.01" max="500" step="0.01" inputmode="decimal" placeholder="Например, 3"><label for="minutes">Время, минуты ${type==='run'?'(необязательно)':''}</label><input id="minutes" name="minutes" type="number" min="0.1" max="1440" step="0.1" inputmode="decimal" placeholder="Например, 30" ${type==='football'?'required':''}><p class="field-hint">${type==='run'?'Можно указать только время или только расстояние.':'Расстояние можно оставить пустым.'}</p>`;
  } else if(type==='home') {
    fields.innerHTML=`<label for="exercise">Упражнение</label><select id="exercise" name="exercise">${Object.entries(exercises).map(([value,title])=>`<option value="${value}">${title}</option>`).join('')}</select><label for="reps">Повторения по подходам</label><input id="reps" name="reps" required maxlength="180" placeholder="15, 12, 10"><p class="field-hint">Впиши повторения через запятую: 15, 12, 10 — это три подхода.</p>`;
  } else {
    fields.innerHTML='<div id="gym-groups"></div><button type="button" id="add-gym-group" class="outline-add">+ Добавить группу мышц</button>';
    appendGymGroup();
    $('add-gym-group').addEventListener('click',()=>{appendGymGroup();previewWorkout();});
  }
  previewWorkout();
  $('workout-dialog').showModal();updateBack();
}
$('workout-form').addEventListener('submit',event=>{
  event.preventDefault();if($('save-workout').disabled)return;
  $('form-error').textContent='';
  try {
    const input=readWorkout();
    const next=addWorkout(state,input,workoutId),gain=totalXP(next)-totalXP(state);$('save-workout').disabled=true;
    if(persist(next,`Тренировка в истории. +${formatXP(gain)} XP`)) {$('workout-dialog').close();navigate('history');window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');}else $('save-workout').disabled=false;
  } catch(error){$('form-error').textContent=error.message;$('save-workout').disabled=false;}
});
$('close-dialog').addEventListener('click',()=>$('workout-dialog').close());$('workout-dialog').addEventListener('close',updateBack);
$('open-character').addEventListener('click',()=>navigate('character'));
for(const button of document.querySelectorAll('[data-panel]'))button.addEventListener('click',()=>navigate(button.dataset.panel));
for(const button of document.querySelectorAll('[data-show]'))button.addEventListener('click',()=>navigate(button.dataset.show));
for(const button of document.querySelectorAll('[data-log-workout]'))button.addEventListener('click',()=>navigate('workout'));
for(const button of document.querySelectorAll('[data-type]'))button.addEventListener('click',()=>openWorkout(button.dataset.type));
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{
  historyFilter=button.dataset.filter;for(const item of document.querySelectorAll('[data-filter]')){const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',active);}renderHistory();
});
function refreshDay(){if(renderedDay!==dayKey())render();}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDay();});setInterval(refreshDay,30000);
let telegramInitialized=false;
function initializeTelegram(){
  const app=window.Telegram?.WebApp;if(!app||telegramInitialized)return;telegramInitialized=true;app.ready();app.expand();
  if(app.isVersionAtLeast?.('6.1')){app.setHeaderColor('#171b21');app.setBackgroundColor('#171b21');}
  if(app.isVersionAtLeast?.('7.10'))app.setBottomBarColor('#1a1e26');
  function applyInsets(){const top=(app.safeAreaInset?.top||0)+(app.contentSafeAreaInset?.top||0),bottom=Math.max(app.safeAreaInset?.bottom||0,app.contentSafeAreaInset?.bottom||0);document.documentElement.style.setProperty('--safe-top',`${top}px`);document.documentElement.style.setProperty('--safe-bottom',`max(env(safe-area-inset-bottom, 0px), ${bottom}px)`);}
  applyInsets();app.onEvent?.('safeAreaChanged',applyInsets);app.onEvent?.('contentSafeAreaChanged',applyInsets);app.BackButton?.onClick(()=>{document.querySelector('dialog[open]')?document.querySelector('dialog[open]').close():navigate('today');});updateBack();
}
document.querySelector('script[src*="telegram-web-app"]').addEventListener('load',initializeTelegram);initializeTelegram();render();
