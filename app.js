import {setupHabitTracker} from './habit-tracker-ui.js?v=0.14.1';
import {setupCoach} from './coach-ui.js?v=0.14.1';
import {setupFriends} from './friends-ui.js?v=0.14.1';
import {setupGarmin,appendGarminDetails} from './garmin-ui.js?v=0.14.1';
import {normalizeProfile} from './profile.js?v=0.14.1';
import { dailyHabits, habitDefinitions, addHabit, archiveHabit, dayHasBonus, tasks, dayKey, normalize, migrate, totalXP, completed, complete, bonusDays, dayBonus, addWorkout, workoutTypes, exercises, muscleGroups, workoutDescription, personalRecords, workoutData, workoutXP, levelProgress, formatXP, addPlan, completePlan, removePlan, planSizes, shiftDay, weekStart, weeklySummary, activeStreak, achievements, awardAchievements, achievementCatalog } from './progress.js?v=0.14.1';
const $=id=>document.getElementById(id);
const storageKey='my-character-v2';
let friends,coach,habitTracker;
let state;
try {
  const saved=localStorage.getItem(storageKey);
  state=saved ? normalize(JSON.parse(saved)) : migrate(JSON.parse(localStorage.getItem('my-player-v1')));
} catch {state=normalize(null);}
let profile;try{profile=normalizeProfile(JSON.parse(localStorage.getItem('my-character-profile-v1')));}catch{profile=null;}
let historyDay=dayKey(),calendarWeek=weekStart();
let achievementFilter='all',achievementsExpanded=false;
let avatar,avatarPromise;
let selectedPanel='today',historyFilter='all',renderedDay=dayKey(),toastTimeout,workoutType='run',workoutId;
const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
function element(tag,text,className) {const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
function notify(text) {$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('visible'),4000);}
function persist(next,message) {
  const settled=awardAchievements(next),extra=totalXP(settled)-totalXP(next);
  try {localStorage.setItem(storageKey,JSON.stringify(settled));}
  catch {notify('Не удалось сохранить. Разреши хранение данных и попробуй ещё раз.');return false;}
  state=settled;render();friends?.changed();if(message)notify(message+(extra?` · Достижение +${formatXP(extra)} XP`:''));return true;
}
function updateBack() {
  const back=window.Telegram?.WebApp?.BackButton;
  if(selectedPanel==='today'&&!document.querySelector('dialog[open]'))back?.hide();else back?.show();
}
function navigate(panel) {
  selectedPanel=panel;
  for(const name of ['today','habits','character','workout','history','progress'])$('panel-'+name).hidden=name!==panel;
  for(const button of document.querySelectorAll('[data-panel]')) {
    const active=button.dataset.panel===panel;button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  if(panel==='character')ensureAvatar();else avatar?.setActive(false);
  if(panel==='habits')habitTracker?.render();
  updateBack();coach?.updateVisibility();window.scrollTo({top:0,behavior:'instant'});
}
function renderHistory() {
  renderCalendar();
  const events=[...state.events,...bonusDays(state).map(day=>({id:day+':bonus',day,kind:'bonus',xp:dayBonus}))].reverse().sort((a,b)=>b.day.localeCompare(a.day));
  const filtered=events.filter(event=>(historyDay===null||event.day===historyDay)&&(historyFilter==='all'||(historyFilter==='task'?['task','habit','plan','bonus','habit-bonus'].includes(event.kind):event.kind==='workout')));
  const container=$('history-list');container.replaceChildren();
  if(!filtered.length) {
    const empty=element('div',null,'empty-state');empty.innerHTML=icon('history');empty.append(element('h2',historyFilter==='workout'?'Пока без тренировок':'Твоя история впереди'),element('p','Отметь дело или запиши занятие. Здесь появятся дата, результат и полученный опыт.'));container.append(empty);return;
  }
  let previous;
  for(const event of filtered) {
    if(event.day!==previous){container.append(element('h2',new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric'}).format(new Date(event.day+'T12:00:00')),'history-date'));previous=event.day;}
    const task=tasks.find(task=>task.id===event.task),badge=achievementCatalog.find(item=>item.id===event.achievement);
    const row=element('article',null,'history-item'),symbol=element('span',null,'history-icon');
    symbol.innerHTML=icon(event.kind==='workout'?'activity':['bonus','habit-bonus'].includes(event.kind)?'sun':event.kind==='achievement'?'award':(task?.icon||'check'));
    const content=element('div');content.append(element('b',event.kind==='workout'?workoutTypes[event.data.type]:['bonus','habit-bonus'].includes(event.kind)?'Все привычки на сегодня выполнены':event.kind==='habit'?event.habit.title:event.kind==='plan'?event.plan.title:event.kind==='achievement'?badge.title:task.title));
    content.append(element('small',event.kind==='workout'?workoutDescription(event.data):['bonus','habit-bonus'].includes(event.kind)?'Бонус за полный набор':event.kind==='habit'?'Ежедневная привычка':event.kind==='plan'?'Свой план · '+planSizes[event.plan.size].title:event.kind==='achievement'?'Достижение · '+badge.description:'Базовое дело: разминка, душ, завтрак или чтение'));
    if(event.kind==='workout'&&event.data.source?.provider==='garmin')appendGarminDetails(content,event.data.source);
    if(event.kind==='workout'){const discuss=element('button','Обсудить с тренером →','coach-discuss');discuss.type='button';discuss.addEventListener('click',()=>coach?.open(event.id));content.append(discuss);}
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
  const swims=state.events.filter(event=>event.kind==='workout'&&event.data.type==='swim');
  if(swims.length){const card=element('article',null,'record'),top=element('div'),meters=swims.reduce((sum,event)=>sum+(event.data.distance||0)*1000,0),minutes=swims.reduce((sum,event)=>sum+event.data.minutes,0);top.append(element('h3','Плавание за всё время'),element('b',`${formatXP(meters)} м`));card.append(top,element('p',`Занятий: ${swims.length} · ${formatXP(minutes)} мин. Самая длинная дистанция: ${formatXP(Math.max(...swims.map(event=>(event.data.distance||0)*1000)))} м.`));container.append(card);}
  if(state.base>0)container.append(element('p',`Сохранено ${state.base} XP из раннего прототипа. Эти очки не считаются реальными тренировками.`,'gentle-note'));
}
function render() {
  state=normalize(state);renderedDay=dayKey();
  const total=totalXP(state),{level,current:xp,required}=levelProgress(total),done=completed(state),habits=dailyHabits(state),earnedBonus=dayHasBonus(state);
  $('date').textContent=new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',weekday:'long'}).format(new Date()).toUpperCase();
  $('summary-level').textContent=`Уровень ${level} · ${formatXP(xp)} / ${required} XP`;$('level').textContent=`Уровень ${level} · ${level<8?'Новичок':level<20?'В ритме':'Уверенный шаг'}`;$('xp-text').textContent=`${formatXP(xp)} / ${required} XP`;$('xp-bar').style.width=`${xp/required*100}%`;$('total-xp').textContent=formatXP(total);avatar?.setLevel(level);$('body-stage').textContent=level<8?'НАЧАЛО ПУТИ':level<20?'ВХОДИШЬ В РИТМ':level<40?'НАБИРАЕШЬ ФОРМУ':'УВЕРЕННЫЙ РИТМ';
  $('daily-count').textContent=`${habits.filter(habit=>done.includes(habit.id)).length} / ${habits.length}`;
  $('bonus-card').classList.toggle('earned',earnedBonus);
  $('bonus-title').textContent=earnedBonus?'Бонус получен. Ты справился!':'Бонус за весь набор';
  $('bonus-note').textContent=earnedBonus?'Завтра будет новый день. Опыт останется.':habits.length?'Выполни свой набор привычек за день':'Добавь привычки, чтобы собрать свой набор';
  $('daily-tasks').replaceChildren(...habits.map(task=>{
    const isDone=done.includes(task.id),button=element('button',null,`daily-task${isDone?' done':''}`);
    const shownXP=state.events.find(event=>((event.kind==='task'&&event.task===task.id)||(event.kind==='habit'&&event.habit.id===task.id))&&event.day===dayKey())?.xp??task.xp;
    button.disabled=isDone;button.setAttribute('aria-label',`${isDone?'Выполнено':'Выполнить'}: ${task.title}`);
    const symbol=element('span',null,'task-symbol');symbol.innerHTML=icon(task.icon);
    const label=element('span',null,'daily-label');label.append(element('b',task.title),element('small',task.description));
    const end=element('span',null,'task-end'),check=element('span',null,'task-check');if(isDone)check.innerHTML=icon('check');end.append(element('b',`+${shownXP} XP`),check);button.append(symbol,label,end);
    button.addEventListener('click',()=>{
      const next=complete(state,task.id),gain=totalXP(next)-totalXP(state);
      if(persist(next,`Дело сделано! +${formatXP(gain)} XP${gain>task.xp?' — с бонусом за день':''}`)) window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    });return button;
  }));if(!habits.length)$('daily-tasks').append(element('p','Добавь первую привычку через «Настроить».','plans-empty'));renderPlans();renderHistory();renderRecords();renderProgress();renderProfile();habitTracker?.render();
}
function renderProfile(){
  document.querySelector('main').hidden=!profile;document.querySelector('.bottom-nav').hidden=!profile;
  $('welcome-screen').hidden=Boolean(profile);
  if(!profile)return;
  $('character-name').textContent=profile.name;
  $('home-greeting').textContent=`Твой день, ${profile.name}.`;
  $('metric-weight').textContent=`${profile.weight} кг`;$('metric-height').textContent=`${profile.height} см`;$('metric-age').textContent=`${profile.age}`;
  const streak=activeStreak(state);$('home-streak').innerHTML=icon('flame');$('home-streak').append(element('b',streak.current),element('span','дней'));
}
function editProfile(){
  $('profile-form').reset();$('profile-error').textContent='';
  $('close-profile').hidden=false;$('profile-submit').textContent=profile?'Сохранить изменения':'Создать и начать';
  if(profile){$('profile-name').value=profile.name;$('profile-age').value=profile.age;$('profile-height').value=profile.height;$('profile-weight').value=profile.weight;document.querySelector(`input[name=sex][value=${profile.sex}]`).checked=true;}
  $('profile-dialog').showModal();updateBack();
}
$('profile-form').addEventListener('submit',async event=>{
  event.preventDefault();const next=normalizeProfile(Object.fromEntries(new FormData(event.currentTarget)));
  if(!next){$('profile-error').textContent='Проверь имя, возраст, рост и вес.';return;}
  try{localStorage.setItem('my-character-profile-v1',JSON.stringify(next));}catch{$('profile-error').textContent='Не удалось сохранить. Разреши хранение данных на устройстве.';return;}
  profile=next;$('profile-dialog').close();render();persist(state);if(avatar)try{await avatar.setProfile(profile);}catch{notify('Профиль сохранён. Модель загрузится при следующем открытии.');}navigate('character');
});
$('edit-profile').addEventListener('click',editProfile);$('welcome-create').addEventListener('click',editProfile);
$('close-profile').addEventListener('click',()=>$('profile-dialog').close());
$('profile-dialog').addEventListener('close',updateBack);
function renderCalendar(){
  const days=Array.from({length:7},(_,index)=>shiftDay(calendarWeek,index));
  $('calendar-month').textContent=new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',year:'numeric'}).formatRange(new Date(calendarWeek+'T12:00:00'),new Date(shiftDay(calendarWeek,6)+'T12:00:00'));
  $('calendar-next').disabled=calendarWeek>=weekStart();$('history-date').max=dayKey();$('history-date').value=historyDay||'';
  $('calendar-all').classList.toggle('active',historyDay===null);
  $('calendar-days').replaceChildren(...days.map(day=>{
    const date=new Date(day+'T12:00:00'),button=element('button',null,'calendar-day');button.disabled=day>dayKey();button.classList.toggle('selected',historyDay===day);button.classList.toggle('today',day===dayKey());button.setAttribute('aria-pressed',historyDay===day);button.setAttribute('aria-label',`История за ${new Intl.DateTimeFormat('ru',{day:'numeric',month:'long'}).format(date)}`);
    button.append(element('small',new Intl.DateTimeFormat('ru',{weekday:'short'}).format(date)),element('b',date.getDate()),element('i',null,state.events.some(event=>event.day===day)?'has-events':''));button.addEventListener('click',()=>{historyDay=day;renderHistory();});return button;
  }));
}
$('calendar-prev').addEventListener('click',()=>{calendarWeek=shiftDay(calendarWeek,-7);renderCalendar();});$('calendar-next').addEventListener('click',()=>{calendarWeek=shiftDay(calendarWeek,7);renderCalendar();});$('calendar-all').addEventListener('click',()=>{historyDay=null;renderHistory();});$('history-date').addEventListener('change',()=>{if($('history-date').value){historyDay=$('history-date').value;calendarWeek=weekStart(historyDay);renderHistory();}});
function renderProgress(){
  const summary=weeklySummary(state),weekday=new Intl.DateTimeFormat('ru',{weekday:'short'}),fmt=new Intl.NumberFormat('ru',{maximumFractionDigits:1});
  $('week-range').textContent=`${new Date(summary.start+'T12:00:00').getDate()}–${new Date(shiftDay(summary.start,6)+'T12:00:00').getDate()}`;
  const max=Math.max(1,...summary.days.map(day=>day.workouts));
  $('week-bars').replaceChildren(...summary.days.map(day=>{const bar=element('div',null,'week-bar');bar.classList.toggle('is-today',day.day===dayKey());bar.setAttribute('aria-label',`${day.day}: ${day.workouts} занятий`);const track=element('div',null,'bar-track'),fill=element('i');fill.style.height=`${day.workouts/max*100}%`;track.append(fill);bar.append(element('b',day.workouts),track,element('small',weekday.format(new Date(day.day+'T12:00:00'))));return bar;}));
  $('week-km').textContent=fmt.format(summary.kilometers);$('week-minutes').textContent=fmt.format(summary.minutes);$('week-volume').textContent=fmt.format(summary.volume);
  const largest=Math.max(1,...Object.values(summary.groups));$('muscle-bars').replaceChildren(...Object.entries(summary.groups).filter(([,sets])=>sets>0).map(([group,sets])=>{const row=element('div',null,'muscle-row'),label=element('div');label.append(element('span',muscleGroups[group]),element('b',`${sets} подх.`));const track=element('div',null,'muscle-track'),fill=element('i');fill.style.width=`${sets/largest*100}%`;track.append(fill);row.append(label,track);return row;}));
  renderAchievements();
}
function renderAchievements(){
  const badges=achievements(state),fmt=new Intl.NumberFormat('ru',{maximumFractionDigits:4});
  $('achievement-count').textContent=`${badges.filter(item=>item.awarded).length} / ${badges.length}`;
  const filtered=badges.filter(item=>achievementFilter==='all'||item.category===achievementFilter)
    .sort((a,b)=>Number(b.awarded)-Number(a.awarded)||(b.current/b.target)-(a.current/a.target));
  const visible=achievementsExpanded?filtered:filtered.slice(0,6);
  $('achievements').replaceChildren(...visible.map(item=>{
    const card=element('article',null,`achievement${item.awarded?' unlocked':''}`),symbol=element('span',null,'badge-icon');symbol.innerHTML=icon(item.icon);
    const text=element('div');text.append(element('b',item.title),element('small',item.description),element('em',item.awarded?'Получено':`${fmt.format(Math.min(item.current,item.target))} / ${fmt.format(item.target)} ${item.unit}`));
    const track=element('div',null,'achievement-track'),fill=element('i');fill.style.width=`${Math.min(100,item.current/item.target*100)}%`;track.append(fill);text.append(track);
    card.append(symbol,text,element('strong',`+${item.xp} XP`));return card;
  }));
  for(const button of document.querySelectorAll('[data-achievement-filter]')){const active=button.dataset.achievementFilter===achievementFilter;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);}
  $('show-achievements').hidden=filtered.length<=6;
  $('show-achievements').textContent=achievementsExpanded?'Свернуть список':`Показать все (${filtered.length})`;
  $('show-achievements').setAttribute('aria-expanded',achievementsExpanded);
}
for(const button of document.querySelectorAll('[data-achievement-filter]'))button.addEventListener('click',()=>{achievementFilter=button.dataset.achievementFilter;achievementsExpanded=false;renderAchievements();});
$('show-achievements').addEventListener('click',()=>{achievementsExpanded=!achievementsExpanded;renderAchievements();});

function renderPlans(){
  const list=$('plans-list'),plans=state.plans.filter(plan=>plan.day===dayKey());list.replaceChildren();
  if(!plans.length){list.append(element('p','Добавь своё первое дело. Например, пройти урок или сходить на работу.','plans-empty'));return;}
  for(const plan of plans){
    const earned=state.events.find(event=>event.id===`plan:${plan.id}`),done=Boolean(earned),row=element('div',null,'plan-row'),button=element('button',null,`daily-task${done?' done':''}`);
    button.disabled=done;button.setAttribute('aria-label',`${done?'Выполнено':'Выполнить план'}: ${plan.title}`);
    const symbol=element('span',null,'task-symbol');symbol.innerHTML=icon('check');
    const label=element('span',null,'daily-label');label.append(element('b',plan.title),element('small',planSizes[plan.size].title));
    const end=element('span',null,'task-end');end.append(element('b',`+${earned?.xp??planSizes[plan.size].xp} XP`));const check=element('span',null,'task-check');if(done)check.innerHTML=icon('check');end.append(check);button.append(symbol,label,end);
    button.addEventListener('click',()=>persist(completePlan(state,plan.id),`План выполнен! +${planSizes[plan.size].xp} XP`));row.append(button);
    if(!done){const remove=element('button','×','plan-remove');remove.setAttribute('aria-label',`Удалить план: ${plan.title}`);remove.addEventListener('click',()=>persist(removePlan(state,plan.id),'План удалён'));row.append(remove);}list.append(row);
  }
}
async function ensureAvatar(){
  if(avatar){
    avatar.setLevel(levelProgress(totalXP(state)).level);avatar.setActive(true);
    try{await avatar.setProfile(profile);$('avatar-hint').textContent='Проведи пальцем, чтобы повернуть';}
    catch{$('avatar-hint').textContent='Модель не загрузилась. Открой персонажа ещё раз, чтобы повторить.';}
    return;
  }
  if(avatarPromise)return;
  $('avatar-viewport').replaceChildren();
  avatarPromise=import('./avatar.js?v=0.14.1').then(async({createAvatar})=>{
    avatar=await createAvatar($('avatar-viewport'),levelProgress(totalXP(state)).level,profile||{sex:'male',height:175,weight:78});
    // The profile can change while the initial geometry is downloading.
    await avatar.setProfile(profile);avatar.setLevel(levelProgress(totalXP(state)).level);
    $('avatar-hint').textContent='Проведи пальцем, чтобы повернуть';avatar.setActive(selectedPanel==='character');
  }).catch(()=>{avatarPromise=null;$('avatar-hint').textContent='3D не загрузилась. Остальные функции доступны.';$('avatar-viewport').dataset.unavailable='true';});
}
$('add-plan').addEventListener('click',()=>{$('plan-form').reset();$('plan-error').textContent='';$('plan-dialog').showModal();updateBack();});
$('close-plan').addEventListener('click',()=>$('plan-dialog').close());$('plan-dialog').addEventListener('close',updateBack);
$('plan-form').addEventListener('submit',event=>{event.preventDefault();try{const next=addPlan(state,Object.fromEntries(new FormData(event.currentTarget)),crypto.randomUUID());if(persist(next,'План добавлен'))$('plan-dialog').close();}catch(error){$('plan-error').textContent=error.message;}});
function renderHabitManager(){
  const definitions=habitDefinitions(state);
  for(const [id,archived] of [['habit-active-list',false],['habit-removed-list',true]]){
    const list=$(id);list.replaceChildren(...definitions.filter(habit=>habit.archived===archived).map(habit=>{const row=element('div',null,'habit-manager-row'),label=element('span');label.append(element('b',habit.title),element('small',`+${habit.xp} XP каждый день`));const button=element('button',archived?'Вернуть':'Удалить','garmin-action-button');button.type='button';button.setAttribute('aria-label',`${archived?'Вернуть':'Удалить'} привычку: ${habit.title}`);button.addEventListener('click',()=>{if(persist(archiveHabit(state,habit.id,!archived),archived?'Привычка возвращена':'Привычка убрана из списка'))renderHabitManager();});row.append(label,button);return row;}));
  }
  $('habit-removed').hidden=!definitions.some(habit=>habit.archived);
}
$('manage-habits').addEventListener('click',()=>{$('habit-form').reset();$('habit-error').textContent='';renderHabitManager();$('habit-dialog').showModal();updateBack();});
$('close-habits').addEventListener('click',()=>$('habit-dialog').close());$('habit-dialog').addEventListener('close',updateBack);
$('habit-form').addEventListener('submit',event=>{event.preventDefault();$('habit-error').textContent='';try{if(persist(addHabit(state,{title:$('habit-name').value,xp:Number($('habit-xp').value)},crypto.randomUUID()),'Ежедневная привычка добавлена')){$('habit-form').reset();renderHabitManager();}}catch(error){$('habit-error').textContent=error.message;}});
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
  if(workoutType==='swim'){input.distance=input.meters?Number(String(input.meters).replace(',','.'))/1000:null;delete input.meters;}
  if(workoutType==='gym')input.exercises=[...document.querySelectorAll('.gym-group')].flatMap(group=>[...group.querySelectorAll('.gym-exercise')].map(entry=>({group:group.querySelector('.gym-group-select').value,...Object.fromEntries([...entry.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]))})));
  return input;
}
function previewWorkout(){
  const rules={swim:'1 XP за минуту плавания. Метры сохраняются без повторного XP.',run:'10 XP/км; без расстояния — 1 XP за 2 мин.',football:'1 XP за минуту. Расстояние не начисляется повторно.',home:$('exercise')?.value==='pullups'?'1 XP за 2 подтягивания.':'1 XP за 10 повторений.',gym:'2 XP за подход + 1 XP за 100 кг объёма.'};
  try{const data=workoutData(readWorkout());$('workout-reward').textContent=`Награда: +${formatXP(workoutXP(data))} XP · ${rules[workoutType]}`;}
  catch{$('workout-reward').textContent=rules[workoutType]+' Заполни поля — увидишь свою награду.';}
}
$('workout-fields').addEventListener('input',previewWorkout);$('workout-fields').addEventListener('change',previewWorkout);$('workout-day').addEventListener('change',previewWorkout);
function openWorkout(type) {
  workoutType=type;workoutId=crypto.randomUUID();$('workout-title').textContent=workoutTypes[type];$('workout-form').reset();$('workout-day').value=dayKey();$('workout-day').max=dayKey();$('form-error').textContent='';$('save-workout').disabled=false;
  const fields=$('workout-fields');
  if(type==='swim'){
    fields.innerHTML='<label for="swim-minutes">Время плавания, минуты</label><input id="swim-minutes" name="minutes" type="number" min="0.1" max="1440" step="0.1" inputmode="decimal" required placeholder="Например, 30"><label for="swim-meters">Расстояние, метры (необязательно)</label><input id="swim-meters" name="meters" type="number" min="1" max="100000" step="1" inputmode="numeric" placeholder="Например, 1000"><p class="field-hint">Укажи время плавания без длинных перерывов. При наличии расстояния история покажет темп на 100 м.</p>';
  }else if(type==='run'||type==='football') {
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
    if(persist(next,`Тренировка в истории. +${formatXP(gain)} XP`)) {historyDay=input.day;calendarWeek=weekStart(historyDay);renderHistory();$('workout-dialog').close();navigate('history');window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');}else $('save-workout').disabled=false;
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
function refreshDay(){if(renderedDay!==dayKey()){if(historyDay===renderedDay){historyDay=dayKey();calendarWeek=weekStart();}render();}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDay();});setInterval(refreshDay,30000);
let telegramInitialized=false;
function initializeTelegram(){
  const app=window.Telegram?.WebApp;if(!app||telegramInitialized)return;telegramInitialized=true;app.ready();app.expand();
  if(app.isVersionAtLeast?.('6.1')){app.setHeaderColor('#171b21');app.setBackgroundColor('#171b21');}
  if(app.isVersionAtLeast?.('7.10'))app.setBottomBarColor('#1a1e26');
  function applyInsets(){const top=(app.safeAreaInset?.top||0)+(app.contentSafeAreaInset?.top||0),bottom=Math.max(app.safeAreaInset?.bottom||0,app.contentSafeAreaInset?.bottom||0);document.documentElement.style.setProperty('--safe-top',`${top}px`);document.documentElement.style.setProperty('--safe-bottom',`max(env(safe-area-inset-bottom, 0px), ${bottom}px)`);}
  applyInsets();app.onEvent?.('safeAreaChanged',applyInsets);app.onEvent?.('contentSafeAreaChanged',applyInsets);app.BackButton?.onClick(()=>{document.querySelector('dialog[open]')?document.querySelector('dialog[open]').close():document.body.classList.contains('coach-chat-open')?coach.back():navigate('today');});updateBack();
}
document.querySelector('script[src*="telegram-web-app"]').addEventListener('load',initializeTelegram);initializeTelegram();render();if(profile)persist(state);

setupGarmin({getState:()=>state,persist,notify,getProfile:()=>profile,onDialog:updateBack,onNavigate:navigate,onImport:day=>{historyDay=day;calendarWeek=weekStart(day);renderHistory();navigate('history');}});

friends=setupFriends({getState:()=>state,getProfile:()=>profile,onNavigate:navigate,onDialog:updateBack,notify});
$('welcome-login').addEventListener('click',()=>friends.login());

coach=setupCoach({getState:()=>state,onNavigate:navigate,onDialog:updateBack,notify});

habitTracker=setupHabitTracker({getState:()=>state,onManage:()=>$('manage-habits').click(),onNavigate:navigate,onDialog:updateBack});habitTracker.render();
