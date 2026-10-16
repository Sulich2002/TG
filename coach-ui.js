import {garminURL} from './garmin.js?v=0.11.1';
import {normalize,dayKey,shiftDay,workoutTypes,workoutDescription,formatXP} from './progress.js?v=0.11.1';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;};
const errors={account_required:'Войди в аккаунт приложения заново.',not_found:'Обнови коннектор на сервере, чтобы включить тренера.',coach_not_configured:'Владелец группы ещё не подключил ИИ.',coach_consent_required:'Сначала разреши передачу данных в настройках тренера.',coach_busy:'Тренер ещё обрабатывает запрос. Подожди немного.',coach_daily_limit:'Лимит сообщений на сегодня исчерпан. Он обновится завтра по московскому времени.',coach_quota:'Бесплатная квота Groq временно исчерпана. Попробуй позже; платный сервис не подключается.',coach_key_invalid:'Groq не принял ключ. Владельцу нужно проверить подключение.',coach_key_format:'Нужен ключ Groq, начинающийся с gsk_, и подтверждение бесплатного тарифа.',coach_model_unavailable:'Доступная модель не найдена. Проверь доступ к моделям в аккаунте Groq.',coach_unavailable:'ИИ сейчас не ответил. Текст сохранён в поле — можно повторить отправку.',coach_workout_missing:'Тренировка недоступна в контексте. Выбери запись за последние 30 дней.',coach_conflict:'Разговор изменился на другом устройстве. История обновлена, твой текст остался в поле.',coach_request_conflict:'Это сообщение уже отправлялось с другим содержимым. Измени текст и отправь снова.',coach_message_invalid:'Напиши сообщение длиной до 2000 символов.',coach_settings_invalid:'Проверь цель и дату события.',owner_required:'Подключение ИИ настраивает владелец группы.',invalid_progress:'Проверь дневник: не удалось прочитать одну из записей.'};

export function coachWorkouts(state,remote=[],days=7,today=dayKey()){
 const start=shiftDay(today,1-days),map=new Map(remote.filter(r=>typeof r?.id==='string'&&Object.hasOwn(workoutTypes,r.type)).map(r=>[r.id,r]));
 for(const event of normalize(state).events)if(event.kind==='workout')map.set(event.id,{id:event.id,day:event.day,type:event.data.type,title:event.data.source?.title||'',description:workoutDescription(event.data)});
 return [...map.values()].filter(r=>typeof r.day==='string'&&r.day>=start&&r.day<=today).sort((a,b)=>b.day.localeCompare(a.day)||a.id.localeCompare(b.id)).slice(0,100);
}
export function setupCoach({getState,onNavigate,onDialog,notify}){
 let data=null,busy=false,loading=false,retry=null,selected='',ready=false,renderedMessages=[];
 function account(){try{const raw=JSON.parse(localStorage.getItem('my-character-account-v1'));if(typeof raw?.token==='string'&&typeof raw.id==='string')return {...raw,url:garminURL(raw.url)};}catch{}return null;}
 async function request(path,body){
  const settings=account();if(!settings)throw new Error('Для личного чата войди в аккаунт приложения.');
  let response;try{response=await fetch(settings.url+'/v2/coach'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+settings.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(65000)});}catch{throw new Error('Нет связи с тренером. Текст остался в поле; повторная отправка того же сообщения не создаст второй ответ.');}
  let result;try{result=await response.json();}catch{throw new Error('Обнови коннектор на сервере, чтобы включить тренера.');}
  if(!response.ok){const error=new Error(errors[result.error]||'Тренер пока недоступен. Попробуй позже.');error.code=result.error;throw error;}
  if(typeof result.configured!=='boolean'||!Array.isArray(result.messages)||!Number.isSafeInteger(result.revision))throw new Error('Не удалось прочитать историю тренера.');
  return result;
 }
 const status=text=>{$('coach-status').textContent=text;};
 function renderPicker(){
  const days=Number($('coach-period').value),rows=coachWorkouts(getState(),data?.workouts||[],days),select=$('coach-workout');
  select.replaceChildren(node('option','Общий вопрос тренеру'));select.firstElementChild.value='';
  for(const row of rows){const label=new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'}).format(new Date(row.day+'T12:00:00'))+' · '+(row.title||workoutTypes[row.type])+(row.description?' · '+row.description:row.minutes?' · '+formatXP(row.minutes)+' мин':'')+(row.possibleDuplicate?' · возможный дубль':'');const option=node('option',label);option.value=row.id;select.append(option);}
  if(rows.some(r=>r.id===selected))select.value=selected;else{selected='';select.value='';}
  $('coach-workout-note').textContent=selected?'Тренер получит данные выбранного занятия вместе с контекстом недели.':rows.length?'Выбери занятие, чтобы обсудить его, или задай общий вопрос.':'За этот период нет записанных занятий. Можно обсудить цель или начать с вопроса.';
 }
 function appendAnswer(container,text){
  for(const line of text.split('\n')){const p=node('p',null,'coach-answer-line');const cleanLine=line.replace(/^#{1,6}\s+/,'');const parts=cleanLine.split(/(\*\*[^*\n]+\*\*)/g);for(const part of parts)p.append(part.startsWith('**')&&part.endsWith('**')?node('strong',part.slice(2,-2)):document.createTextNode(part));if(!cleanLine)p.append(document.createElement('br'));container.append(p);}
 }
 function renderMessages(){
  const records=data?.messages||[],signatures=records.map(record=>JSON.stringify(record)),samePrefix=signatures.length>=renderedMessages.length&&renderedMessages.every((signature,index)=>signature===signatures[index]);
  if(samePrefix&&signatures.length===renderedMessages.length)return;
  const container=$('coach-messages'),start=samePrefix?renderedMessages.length:0;if(!samePrefix)container.replaceChildren();renderedMessages=signatures;
  for(const record of records.slice(start)){
   for(const [role,text] of [['user',record.question],['assistant',record.answer]]){const article=node('article',null,'coach-message coach-'+role),header=node('div',null,'coach-message-header');header.append(node('b',role==='user'?'Ты':'Тренер · Groq'));if(Number.isFinite(record.created))header.append(node('time',new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(record.created*1000))));article.append(header);if(role==='user')article.append(node('p',text));else appendAnswer(article,text);container.append(article);}
  }
  $('coach-welcome').hidden=Boolean(data?.messages.length);
 }
 function render(){
  const signed=Boolean(account());$('coach-login').hidden=signed;$('coach-body').hidden=!signed;$('coach-provider').hidden=!data?.owner;
  $('coach-configure').textContent=data?.configured?'Настроить ИИ':'Подключить ИИ';
  $('coach-service-note').textContent=data?.configured?'Подключён '+data.model+' · Groq. Бесплатная квота общая для группы.':data?.owner?'Подключи бесплатный аккаунт Groq: ключ вводится один раз для группы.':'Владелец группы должен подключить ИИ. После этого у каждого будет свой чат.';
  $('coach-goal-preview').textContent=data?.goal?.text?(data.goal.text+(data.goal.eventDay?' · событие '+new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric'}).format(new Date(data.goal.eventDay+'T12:00:00')):'')):'Можно поставить цель: например, подготовиться к забегу или регулярно заниматься.';
  $('coach-allow-note').hidden=!data||data.consent;$('coach-send').disabled=busy||!ready||!data?.configured||!data?.consent;
  $('coach-settings').disabled=busy||!ready;$('coach-clear').disabled=busy||!data?.messages.length;$('coach-configure').disabled=busy||!ready;
  $('coach-limits').textContent=data?.configured&&data.limits?`Осталось запросов сегодня: ${data.limits.remaining}. Личный предел — ${data.limits.dailyLimit}, у группы есть общий лимит.`:'';
  $('coach-pending').hidden=!busy;renderPicker();renderMessages();
 }
 async function refresh(){
  if(loading||busy||!account())return;loading=true;status('Загружаю личный чат…');
  try{data=await request('');ready=true;status('Разговор сохраняется в твоём аккаунте.');}catch(error){ready=false;status(error.message);}finally{loading=false;render();}
 }
 function open(workoutId){
  if(workoutId){selected=workoutId;$('coach-period').value='30';if(!coachWorkouts(getState(),data?.workouts||[],30).some(row=>row.id===workoutId))notify('Для обсуждения доступны записи за последние 30 дней.');}
  onNavigate('progress');document.querySelector('[data-progress-tab=coach]').click();renderPicker();
 }
 document.querySelector('[data-progress-tab=coach]').addEventListener('click',()=>{render();refresh();});
 for(const button of document.querySelectorAll('[data-coach-open]'))button.addEventListener('click',()=>open());
 $('coach-login').addEventListener('click',()=>{onNavigate('progress');document.querySelector('[data-progress-tab=friends]').click();});
 $('coach-refresh').addEventListener('click',refresh);
 $('coach-period').addEventListener('change',()=>{selected='';renderPicker();});$('coach-workout').addEventListener('change',()=>{selected=$('coach-workout').value;renderPicker();});
 for(const button of document.querySelectorAll('[data-coach-prompt]'))button.addEventListener('click',()=>{if(button.dataset.coachPrompt==='workout'){if(!selected){$('coach-workout').focus();status('Сначала выбери занятие из списка.');return;}$('coach-text').value='Разбери выбранную тренировку: что видно по данным, чего не хватает и что стоит учесть для восстановления?';}else{selected='';renderPicker();$('coach-text').value=button.dataset.coachPrompt==='today'?'Что порекомендуешь потренировать сегодня с учётом записей за неделю и моей цели? Если данных мало, задай вопросы.':'Разбери мою нагрузку за последние семь дней: что записано, какие группы известны, что можно улучшить и чего по этим данным нельзя сказать.';}$('coach-text').focus();});
 $('coach-settings').addEventListener('click',()=>{$('coach-goal').value=data?.goal?.text||'';$('coach-event-day').value=data?.goal?.eventDay||'';$('coach-consent').checked=Boolean(data?.consent);$('coach-settings-error').textContent='';$('coach-settings-dialog').showModal();onDialog();});
 $('close-coach-settings').addEventListener('click',()=>$('coach-settings-dialog').close());$('coach-settings-dialog').addEventListener('close',onDialog);
 $('coach-settings-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('coach-settings-save');button.disabled=true;$('coach-settings-error').textContent='';try{data=await request('/settings',{goal:{text:$('coach-goal').value,eventDay:$('coach-event-day').value||null},consent:$('coach-consent').checked});ready=true;$('coach-settings-dialog').close();render();notify('Настройки тренера сохранены');}catch(error){$('coach-settings-error').textContent=error.message;}finally{button.disabled=false;}});
 $('coach-configure').addEventListener('click',()=>{$('coach-key').value='';$('coach-free-plan').checked=false;$('coach-provider-error').textContent='';$('coach-disable-provider').hidden=!data?.configured;$('coach-provider-dialog').showModal();onDialog();});
 $('close-coach-provider').addEventListener('click',()=>$('coach-provider-dialog').close());$('coach-provider-dialog').addEventListener('close',()=>{$('coach-key').value='';onDialog();});
 $('coach-provider-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('coach-provider-save');button.disabled=true;$('coach-provider-error').textContent='';try{data=await request('/provider',{key:$('coach-key').value,freePlan:$('coach-free-plan').checked});ready=true;$('coach-provider-dialog').close();render();notify('ИИ подключён');}catch(error){$('coach-provider-error').textContent=error.message;}finally{$('coach-key').value='';button.disabled=false;}});
 $('coach-disable-provider').addEventListener('click',async()=>{const button=$('coach-disable-provider');button.disabled=true;try{data=await request('/provider',{disable:true});$('coach-provider-dialog').close();render();notify('ИИ отключён для группы');}catch(error){$('coach-provider-error').textContent=error.message;}finally{button.disabled=false;}});
 $('coach-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!ready||!data?.configured||!data.consent)return;
  const text=$('coach-text').value.trim();if(!text)return;
  const workoutId=selected||null;if(!retry||retry.text!==text||retry.workoutId!==workoutId)retry={id:crypto.randomUUID(),text,workoutId};
  const attempted={...retry};busy=true;render();status('Тренер смотрит записи и готовит ответ…');
  try{data=await request('/message',{...attempted,revision:data.revision,state:getState()});ready=true;if($('coach-text').value.trim()===text)$('coach-text').value='';retry=null;status('Ответ готов.');}
  catch(error){status(error.message);if(error.code==='coach_conflict'){busy=false;await refresh();status(errors.coach_conflict);}if(error.code==='coach_request_conflict')retry=null;}
  finally{busy=false;render();}
 });
 $('coach-clear').addEventListener('click',()=>{$('coach-clear-confirm').hidden=false;});$('coach-clear-no').addEventListener('click',()=>{$('coach-clear-confirm').hidden=true;});
 $('coach-clear-yes').addEventListener('click',async()=>{if(busy)return;busy=true;render();try{data=await request('/clear',{});retry=null;$('coach-clear-confirm').hidden=true;status('История чата удалена. Дневник и цель сохранены.');}catch(error){status(error.message);}finally{busy=false;render();}});
 render();return {open};
}
