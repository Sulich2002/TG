import {garminURL} from './garmin.js?v=0.13.2';
import {normalize,dayKey,shiftDay,workoutTypes,workoutDescription,formatXP} from './progress.js?v=0.13.2';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;};
const errors={account_required:'Войди в аккаунт приложения заново.',not_found:'Обнови коннектор на сервере, чтобы включить тренера.',coach_not_configured:'Владелец группы ещё не подключил ИИ.',coach_consent_required:'Сначала разреши передачу данных в настройках тренера.',coach_busy:'Тренер ещё обрабатывает запрос. Подожди немного.',coach_daily_limit:'Лимит сообщений на сегодня исчерпан. Он обновится завтра по московскому времени.',coach_quota:'Бесплатная квота Groq временно исчерпана. Попробуй позже; платный сервис не подключается.',coach_key_invalid:'Groq не принял ключ. Владельцу нужно проверить подключение.',coach_key_format:'Нужен ключ Groq, начинающийся с gsk_, и подтверждение бесплатного тарифа.',coach_model_unavailable:'Доступная модель не найдена. Проверь доступ к моделям в аккаунте Groq.',coach_unavailable:'ИИ сейчас не ответил. Текст сохранён в поле — можно повторить отправку.',coach_workout_missing:'Тренировка недоступна в контексте. Выбери запись за последние 30 дней.',coach_conflict:'Разговор изменился на другом устройстве. История обновлена, твой текст остался в поле.',coach_request_conflict:'Это сообщение уже отправлялось с другим содержимым. Измени текст и отправь снова.',coach_message_invalid:'Напиши сообщение длиной до 2000 символов.',coach_settings_invalid:'Проверь цель и дату события.',owner_required:'Подключение ИИ настраивает владелец группы.',invalid_progress:'Проверь дневник: не удалось прочитать одну из записей.'};

export function coachWorkouts(state,remote=[],days=30,today=dayKey()){
 const start=shiftDay(today,1-days),map=new Map(remote.filter(r=>typeof r?.id==='string'&&Object.hasOwn(workoutTypes,r.type)).map(r=>[r.id,r]));
 for(const event of normalize(state).events)if(event.kind==='workout')map.set(event.id,{id:event.id,day:event.day,type:event.data.type,title:event.data.source?.title||'',description:workoutDescription(event.data)});
 return [...map.values()].filter(r=>typeof r.day==='string'&&r.day>=start&&r.day<=today).sort((a,b)=>b.day.localeCompare(a.day)||a.id.localeCompare(b.id));
}
export const coachPrompts={today:'Что порекомендуешь на сегодня?',week:'Разбери мою нагрузку за последние семь дней.'};
const dateLabel=day=>new Intl.DateTimeFormat('ru',{day:'numeric',month:'long'}).format(new Date(day+'T12:00:00'));
function workoutLabel(row){return `${dateLabel(row.day)} · ${row.title||workoutTypes[row.type]}`;}
function workoutDetail(row){if(row.description)return row.description;return [row.distance?`${formatXP(row.distance*(row.type==='swim'?1000:1))} ${row.type==='swim'?'м':'км'}`:null,row.minutes?`${formatXP(row.minutes)} мин`:null,row.averageHeartRate?`пульс ${formatXP(row.averageHeartRate)}`:null].filter(Boolean).join(' · ')||workoutTypes[row.type];}
export function setupCoach({getState,onNavigate,onDialog,notify}){
 let data=null,busy=false,retry=null,pending=null,selected='',ready=false,renderedMessages=[],refreshPromise=null,following=true,selectionTouched=false,active=false,viewportBaseline=innerHeight;
 const scroll=$('coach-scroll'),textInput=$('coach-text');
 function account(){try{const raw=JSON.parse(localStorage.getItem('my-character-account-v1'));if(typeof raw?.token==='string'&&typeof raw.id==='string')return {...raw,url:garminURL(raw.url)};}catch{}return null;}
 async function request(path,body){
  const settings=account();if(!settings)throw new Error('Для личного чата войди в аккаунт приложения.');
  let response;try{response=await fetch(settings.url+'/v2/coach'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+settings.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(65000)});}catch{throw new Error('Нет связи с тренером. Можно повторить отправку; сохранённый ответ не продублируется.');}
  let result;try{result=await response.json();}catch{throw new Error('Обнови коннектор на сервере, чтобы включить тренера.');}
  if(!response.ok){const error=new Error(errors[result.error]||'Тренер пока недоступен. Попробуй позже.');error.code=result.error;throw error;}
  if(typeof result.configured!=='boolean'||!Array.isArray(result.messages)||!Number.isSafeInteger(result.revision))throw new Error('Не удалось прочитать историю тренера.');return result;
 }
 function status(message='',kind='info'){const el=$('coach-status');el.textContent=message;el.dataset.kind=kind;el.hidden=!message||kind==='quiet';}
 function rows(){return coachWorkouts(getState(),data?.workouts||[],30);}
 function canSend(){return ready&&data?.configured&&data?.consent&&Boolean(account());}
 function toBottom(force=false){if(force)following=true;if(following)requestAnimationFrame(()=>{scroll.scrollTop=scroll.scrollHeight;$('coach-latest').hidden=true;});}
 function updateViewport(){
  if(!active)return;const viewport=window.visualViewport,height=viewport?.height||innerHeight;
  if(document.activeElement!==textInput)viewportBaseline=Math.max(innerHeight,height);
  const keyboard=document.activeElement===textInput&&viewportBaseline-height>120;document.body.classList.toggle('coach-keyboard-open',keyboard);
  document.documentElement.style.setProperty('--coach-visible-height',height+'px');document.documentElement.style.setProperty('--coach-visible-top',(viewport?.offsetTop||0)+'px');
  $('progress-coach').style.setProperty('--chat-height',height+'px');$('progress-coach').style.setProperty('--chat-top',(viewport?.offsetTop||0)+'px');$('progress-coach').style.setProperty('--chat-nav-height','0px');if(following)toBottom();
 }
 function updateVisibility(){
  const next=!$('panel-progress').hidden&&!$('progress-coach').hidden;document.body.classList.toggle('coach-chat-open',next);
  if(!next){document.body.classList.remove('coach-keyboard-open');if(active)textInput.blur();active=false;return;}
  if(!active){following=true;viewportBaseline=innerHeight;}active=true;updateViewport();
 }
 function back(){$('coach-menu').open=false;onNavigate('progress');document.querySelector('[data-progress-tab=activities]').click();}
 function resizeInput(){textInput.style.height='auto';textInput.style.height=Math.min(80,textInput.scrollHeight)+'px';if(following)toBottom();}
 function appendAnswer(container,text){
  for(const line of text.split('\n')){const p=node('p',null,'coach-answer-line'),parts=line.replace(/^#{1,6}\s+/,'').split(/(\*\*[^*\n]+\*\*)/g);for(const part of parts)p.append(part.startsWith('**')&&part.endsWith('**')?node('strong',part.slice(2,-2)):document.createTextNode(part));if(!line)p.append(document.createElement('br'));container.append(p);}
 }
 function turn(role,text,id){const article=node('article',null,'coach-message coach-'+role);article.dataset.messageId=id;article.setAttribute('aria-label',role==='user'?'Твоё сообщение':'Ответ тренера');if(role==='user')article.append(node('p',text));else appendAnswer(article,text);return article;}
 function renderMessages(){
  const records=data?.messages||[],signatures=records.map(record=>JSON.stringify(record)),samePrefix=signatures.length>=renderedMessages.length&&renderedMessages.every((signature,index)=>signature===signatures[index]);
  if(!samePrefix||signatures.length!==renderedMessages.length){const container=$('coach-messages'),start=samePrefix?renderedMessages.length:0;if(!samePrefix)container.replaceChildren();renderedMessages=signatures;for(const record of records.slice(start))container.append(turn('user',record.question,record.request_id+':user'),turn('assistant',record.answer,record.request_id+':assistant'));}
  const outbox=$('coach-outbox');outbox.replaceChildren();if(pending){const item=turn('user',pending.text,pending.id+':pending');if(!busy){item.append(node('small','Не отправлено','coach-unsent'));const button=node('button','Повторить','coach-retry');button.type='button';button.addEventListener('click',()=>send(pending.text,pending.workoutId));item.append(button);}outbox.append(item);}
  $('coach-welcome').hidden=Boolean(records.length||pending);$('coach-pending').hidden=!busy;toBottom();
 }
 function renderContext(){const row=rows().find(r=>r.id===selected);$('coach-context').hidden=!row;$('coach-context-title').textContent=row?workoutLabel(row):'';if(!row)selected='';}
 function render(){
  const signed=Boolean(account());$('coach-login-state').hidden=signed;$('coach-body').hidden=!signed;$('coach-provider').hidden=!data?.owner;
  $('coach-configure').textContent=data?.configured?'Подключение ИИ':'Подключить ИИ';$('coach-service-note').textContent=data?.configured?`${data.model} · Groq. Квота общая для группы.`:'Подключение к бесплатному аккаунту Groq настраивает владелец группы.';
  $('coach-goal-preview').textContent=data?.goal?.text?(data.goal.text+(data.goal.eventDay?' · '+dateLabel(data.goal.eventDay):'')):'Цель пока не задана';
  $('coach-limits').textContent=data?.configured&&data.limits?`Осталось запросов сегодня: ${data.limits.remaining} из личного предела ${data.limits.dailyLimit}. У группы есть общий лимит.`:'';
  $('coach-settings').disabled=busy||!ready;$('coach-configure').disabled=busy||!ready;$('coach-clear').disabled=busy||!data?.messages.length;$('coach-send').disabled=busy||!canSend()||!textInput.value.trim();
  for(const button of document.querySelectorAll('[data-coach-prompt]'))button.disabled=busy||!canSend();
  const missing=ready&&(!data?.configured||!data?.consent);$('coach-setup-notice').hidden=!missing;
  $('coach-setup-text').textContent=!data?.configured?(data?.owner?'Подключи ИИ, чтобы начать разговор.':'Владелец группы ещё не подключил ИИ.'):'Разреши тренеру использовать твой дневник для ответов.';
  $('coach-setup-action').hidden=!data?.configured&&!data?.owner;$('coach-setup-action').textContent=!data?.configured?'Подключить ИИ':'Разрешить';
  renderContext();renderMessages();updateVisibility();
 }
 async function refresh(){
  if(refreshPromise)return refreshPromise;if(busy||!account())return;
  refreshPromise=(async()=>{status('Загружаю переписку…','quiet');try{data=await request('');ready=true;if(!selectionTouched){selected=data.messages.at(-1)?.workout_id||'';selectionTouched=true;}if(pending&&data.messages.some(r=>r.request_id===pending.id)){pending=null;retry=null;}status();}catch(error){ready=false;status(error.message,'error');}finally{render();}})();
  try{await refreshPromise;}finally{refreshPromise=null;}
 }
 function openSettings(){$('coach-menu').open=false;$('coach-goal').value=data?.goal?.text||'';$('coach-event-day').value=data?.goal?.eventDay||'';$('coach-consent').checked=Boolean(data?.consent);$('coach-settings-error').textContent='';$('coach-settings-dialog').showModal();onDialog();}
 function openProvider(){$('coach-menu').open=false;$('coach-key').value='';$('coach-free-plan').checked=false;$('coach-provider-error').textContent='';$('coach-disable-provider').hidden=!data?.configured;$('coach-provider-dialog').showModal();onDialog();}
 function renderWorkouts(){
  const query=$('coach-workout-search').value.trim().toLocaleLowerCase('ru'),list=$('coach-workout-list');list.replaceChildren();let previous='',count=0;
  for(const row of rows()){const label=workoutLabel(row),detail=workoutDetail(row);if(query&&!`${row.day} ${label} ${detail} ${workoutTypes[row.type]}`.toLocaleLowerCase('ru').includes(query))continue;
   if(previous!==row.day){list.append(node('h3',dateLabel(row.day),'coach-workout-day'));previous=row.day;}
   const button=node('button',null,'coach-workout-choice');button.type='button';button.dataset.workoutId=row.id;button.append(node('b',row.title||workoutTypes[row.type]),node('span',detail),node('small',row.possibleDuplicate?'Возможный дубль · обсудить →':'Обсудить →'));button.addEventListener('click',()=>{if(busy)return;selected=row.id;selectionTouched=true;$('coach-workout-dialog').close();send(`Разбери тренировку: ${label}.`,row.id);});list.append(button);count++;
  }
  if(!count)list.append(node('p',query?'Ничего не найдено. Попробуй другое название или дату.':'За последние 30 дней занятий пока нет. Можно спросить тренера о цели и начале тренировок.','coach-workouts-empty'));
 }
 function openWorkouts(){if(busy)return;$('coach-workout-search').value='';renderWorkouts();$('coach-workout-dialog').showModal();onDialog();}
 async function send(text,workoutId=null,fromComposer=false){
  text=text.trim();if(!text||busy)return;if(!canSend()){status('Для отправки нужны подключённый ИИ и разрешение на данные.','error');return;}
  selected=workoutId||'';selectionTouched=true;if(!retry||retry.text!==text||retry.workoutId!==(workoutId||null))retry={id:crypto.randomUUID(),text,workoutId:workoutId||null};
  const attempted={...retry};pending=attempted;busy=true;following=true;if(fromComposer){textInput.value='';resizeInput();}status();render();
  try{data=await request('/message',{...attempted,revision:data.revision,state:getState()});ready=true;pending=null;retry=null;status();}
  catch(error){status(error.message,'error');if(error.code==='coach_conflict'){busy=false;await refresh();status(errors.coach_conflict,'error');}if(error.code==='coach_request_conflict')retry=null;}
  finally{busy=false;render();}
 }
 async function open(workoutId){
  if(workoutId){selected=workoutId;selectionTouched=true;}
  onNavigate('progress');document.querySelector('[data-progress-tab=coach]').click();await refresh();
  if(workoutId){const row=rows().find(r=>r.id===workoutId);if(!row){notify('Для обсуждения доступны записи за последние 30 дней.');return;}if(canSend())send(`Разбери тренировку: ${workoutLabel(row)}.`,workoutId);}
 }
 document.querySelector('[data-progress-tab=coach]').addEventListener('click',()=>{render();refresh();});
 window.addEventListener('progress-tab-change',updateVisibility);window.addEventListener('resize',updateViewport);window.visualViewport?.addEventListener('resize',updateViewport);window.visualViewport?.addEventListener('scroll',updateViewport);
 for(const button of document.querySelectorAll('[data-coach-open]'))button.addEventListener('click',()=>open());
 $('coach-back').addEventListener('click',back);$('coach-login').addEventListener('click',()=>{onNavigate('progress');document.querySelector('[data-progress-tab=friends]').click();});
 $('coach-refresh').addEventListener('click',()=>{$('coach-menu').open=false;refresh();});$('coach-settings').addEventListener('click',openSettings);$('coach-configure').addEventListener('click',openProvider);$('coach-setup-action').addEventListener('click',()=>data?.configured?openSettings():openProvider());
 $('close-coach-settings').addEventListener('click',()=>$('coach-settings-dialog').close());$('coach-settings-dialog').addEventListener('close',onDialog);
 $('coach-settings-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('coach-settings-save');button.disabled=true;$('coach-settings-error').textContent='';try{data=await request('/settings',{goal:{text:$('coach-goal').value,eventDay:$('coach-event-day').value||null},consent:$('coach-consent').checked});ready=true;$('coach-settings-dialog').close();render();notify('Настройки тренера сохранены');}catch(error){$('coach-settings-error').textContent=error.message;}finally{button.disabled=false;}});
 $('close-coach-provider').addEventListener('click',()=>$('coach-provider-dialog').close());$('coach-provider-dialog').addEventListener('close',()=>{$('coach-key').value='';onDialog();});
 $('coach-provider-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('coach-provider-save');button.disabled=true;$('coach-provider-error').textContent='';try{data=await request('/provider',{key:$('coach-key').value,freePlan:$('coach-free-plan').checked});ready=true;$('coach-provider-dialog').close();render();notify('ИИ подключён');}catch(error){$('coach-provider-error').textContent=error.message;}finally{$('coach-key').value='';button.disabled=false;}});
 $('coach-disable-provider').addEventListener('click',async()=>{const button=$('coach-disable-provider');button.disabled=true;try{data=await request('/provider',{disable:true});$('coach-provider-dialog').close();render();notify('ИИ отключён для группы');}catch(error){$('coach-provider-error').textContent=error.message;}finally{button.disabled=false;}});
 for(const button of document.querySelectorAll('[data-coach-prompt]'))button.addEventListener('click',()=>{if(button.dataset.coachPrompt==='workout')openWorkouts();else send(coachPrompts[button.dataset.coachPrompt]);});
 $('coach-workout-search').addEventListener('input',renderWorkouts);$('close-coach-workout').addEventListener('click',()=>$('coach-workout-dialog').close());$('coach-workout-dialog').addEventListener('close',onDialog);
 $('coach-context-clear').addEventListener('click',()=>{selected='';selectionTouched=true;renderContext();});
 $('coach-form').addEventListener('submit',event=>{event.preventDefault();send(textInput.value,selected||null,true);});
 textInput.addEventListener('input',()=>{resizeInput();$('coach-send').disabled=busy||!canSend()||!textInput.value.trim();});
 textInput.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!matchMedia('(pointer:coarse)').matches){event.preventDefault();$('coach-form').requestSubmit();}});
 for(const name of ['focus','blur'])textInput.addEventListener(name,()=>requestAnimationFrame(updateViewport));
 scroll.addEventListener('scroll',()=>{following=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<70;$('coach-latest').hidden=following;},{passive:true});$('coach-latest').addEventListener('click',()=>toBottom(true));
 $('coach-clear').addEventListener('click',()=>{$('coach-clear-confirm').hidden=false;});$('coach-clear-no').addEventListener('click',()=>{$('coach-clear-confirm').hidden=true;});
 $('coach-clear-yes').addEventListener('click',async()=>{if(busy)return;busy=true;render();try{data=await request('/clear',{});pending=null;retry=null;selected='';$('coach-clear-confirm').hidden=true;$('coach-menu').open=false;status();}catch(error){status(error.message,'error');}finally{busy=false;render();}});
 render();return {open,back,updateVisibility};
}
