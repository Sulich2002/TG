import { tasks, dayKey, normalize, migrate, totalXP, completed, complete, bonusDays, dayBonus, addWorkout, workoutTypes, exercises, muscleGroups, workoutDescription, personalRecords } from './progress.js';
const $=id=>document.getElementById(id);
const storageKey='my-character-v2';
let state;
try {
  const saved=localStorage.getItem(storageKey);
  state=saved ? normalize(JSON.parse(saved)) : migrate(JSON.parse(localStorage.getItem('my-player-v1')));
} catch {state=normalize(null);}
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
  if(selectedPanel==='today'&&!$('workout-dialog').open)back?.hide();else back?.show();
}
function navigate(panel) {
  selectedPanel=panel;
  for(const name of ['today','character','workout','history','progress'])$('panel-'+name).hidden=name!==panel;
  for(const button of document.querySelectorAll('[data-panel]')) {
    const active=button.dataset.panel===panel;button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
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
    symbol.innerHTML=icon(event.kind==='workout'?'activity':event.kind==='bonus'?'sun':task.icon);
    const content=element('div');content.append(element('b',event.kind==='workout'?workoutTypes[event.data.type]:event.kind==='bonus'?'Все дела на сегодня выполнены':task.title));
    content.append(element('small',event.kind==='workout'?workoutDescription(event.data):event.kind==='bonus'?'Бонус за полный набор':'Ежедневное дело'));
    row.append(symbol,content,element('strong',`+${event.xp} XP`));container.append(row);
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
  if(state.base>0)container.append(element('p',`Сохранено ${state.base} XP из раннего прототипа. Эти очки не считаются реальными тренировками.`,'gentle-note'));
}
function render() {
  state=normalize(state);renderedDay=dayKey();
  const total=totalXP(state),level=Math.floor(total/100)+1,xp=total%100,done=completed(state);
  $('date').textContent=new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',weekday:'long'}).format(new Date()).toUpperCase();
  $('summary-level').textContent=`Уровень ${level} · ${xp} / 100 XP`;$('level').textContent=`Уровень ${level}`;$('xp-text').textContent=`${xp} / 100 XP`;$('xp-bar').style.width=`${xp}%`;$('total-xp').textContent=total;
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
      if(persist(next,`Дело сделано! +${gain} XP${gain>task.xp?' — с бонусом за день':''}`)) window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    });return button;
  }));renderHistory();renderRecords();
}
function openWorkout(type) {
  workoutType=type;workoutId=crypto.randomUUID();$('workout-title').textContent=workoutTypes[type];$('workout-form').reset();$('workout-day').value=dayKey();$('workout-day').max=dayKey();$('form-error').textContent='';$('save-workout').disabled=false;
  const fields=$('workout-fields');
  if(type==='run'||type==='football') {
    fields.innerHTML=`<label for="distance">Расстояние, км ${type==='football'?'(необязательно)':''}</label><input id="distance" name="distance" type="number" min="0.01" max="500" step="0.01" inputmode="decimal" placeholder="Например, 3"><label for="minutes">Время, минуты ${type==='run'?'(необязательно)':''}</label><input id="minutes" name="minutes" type="number" min="0.1" max="1440" step="0.1" inputmode="decimal" placeholder="Например, 30" ${type==='football'?'required':''}><p class="field-hint">${type==='run'?'Можно указать только время или только расстояние.':'Расстояние можно оставить пустым.'}</p>`;
  } else if(type==='home') {
    fields.innerHTML=`<label for="exercise">Упражнение</label><select id="exercise" name="exercise">${Object.entries(exercises).map(([value,title])=>`<option value="${value}">${title}</option>`).join('')}</select><label for="reps">Повторения по подходам</label><input id="reps" name="reps" required maxlength="180" placeholder="15, 12, 10"><p class="field-hint">Впиши повторения через запятую: 15, 12, 10 — это три подхода.</p>`;
  } else {
    fields.innerHTML=`<label for="group">Группа мышц</label><select id="group" name="group">${Object.entries(muscleGroups).map(([value,title])=>`<option value="${value}">${title}</option>`).join('')}</select><label for="exercise">Упражнение</label><input id="exercise" name="exercise" required maxlength="80" placeholder="Например, тяга верхнего блока"><div class="form-row triple-row"><div><label for="weight">Вес, кг</label><input id="weight" name="weight" type="number" min="0" max="1000" step="0.25" inputmode="decimal" required></div><div><label for="sets">Подходы</label><input id="sets" name="sets" type="number" min="1" max="30" inputmode="numeric" required></div><div><label for="reps">Повторения</label><input id="reps" name="reps" type="number" min="1" max="1000" inputmode="numeric" required></div></div>`;
  }
  $('workout-reward').textContent=`+${type==='gym'?60:type==='home'?40:50} XP за запись занятия. Результаты сохранятся отдельно.`;
  $('workout-dialog').showModal();updateBack();
}
$('workout-form').addEventListener('submit',event=>{
  event.preventDefault();if($('save-workout').disabled)return;
  $('form-error').textContent='';
  try {
    const input={...Object.fromEntries(new FormData(event.currentTarget)),type:workoutType};
    const next=addWorkout(state,input,workoutId),gain=totalXP(next)-totalXP(state);$('save-workout').disabled=true;
    if(persist(next,`Тренировка в истории. +${gain} XP`)) {$('workout-dialog').close();navigate('history');window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');}else $('save-workout').disabled=false;
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
  applyInsets();app.onEvent?.('safeAreaChanged',applyInsets);app.onEvent?.('contentSafeAreaChanged',applyInsets);app.BackButton?.onClick(()=>{$('workout-dialog').open?$('workout-dialog').close():navigate('today');});updateBack();
}
document.querySelector('script[src*="telegram-web-app"]').addEventListener('load',initializeTelegram);initializeTelegram();render();
