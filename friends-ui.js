import {garminURL} from './garmin.js?v=0.11.0';
import {normalize,awardAchievements,formatXP,mergeHabits} from './progress.js?v=0.11.0';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;};
const accountKey='my-character-account-v1',backupKey='my-character-before-account-v1';
const localKeys=['my-character-v2','my-character-profile-v1','my-character-garmin-v1','my-character-garmin-health-v1'];
const needsUpdatedProgress=state=>Array.isArray(state.habits)||state.events.some(e=>['habit','habit-bonus'].includes(e.kind)||(e.kind==='workout'&&e.data.type==='swim'));
const updateMessage='Для привычек и плавания обнови коннектор на сервере. Новые записи пока сохранены на этом устройстве.';
const messages={invalid_invite:'Приглашение недействительно. Попроси новую ссылку у владельца.',username_taken:'Этот логин уже занят.',invalid_credentials:'Логин: 3–32 латинские буквы, цифры или _. Пароль: 12–200 символов.',bad_login:'Проверь логин и пароль.',account_required:'Войди в аккаунт заново.',owner_required:'Для создания группы нужно подключение к своему серверу Garmin.',group_exists:'Группа уже создана. Войди в свой аккаунт.',rate_limited:'Много попыток. Подожди минуту.',invalid_progress:'Не удалось проверить записи дневника.',invalid_profile:'Проверь данные персонажа.',group_full:'В группе достигнут лимит участников.',sync_conflict:'Дневник изменился на другом устройстве. Выбери, как продолжить.'};
const bundle=()=>Object.fromEntries(localKeys.map(key=>[key,localStorage.getItem(key)]));
function restore(value){for(const key of localKeys){if(typeof value?.[key]==='string')localStorage.setItem(key,value[key]);else localStorage.removeItem(key);}}
function invitation(url,invite){const link=new URL(location.href);link.hash=new URLSearchParams({join:JSON.stringify({url,invite})}).toString();return link.href;}
function parseInvitation(){try{const value=JSON.parse(new URLSearchParams(location.hash.slice(1)).get('join'));if(typeof value.invite==='string'&&/^[A-Za-z0-9_-]{20,128}$/.test(value.invite))return {url:garminURL(value.url),invite:value.invite};}catch{}return null;}

export function setupFriends({getState,getProfile,onNavigate,onDialog,notify}){
 let settings=null,period='week',busy=false,ready=false,updatedProgress=false,conflict=false,version=0,boardGeneration=0,timer,pendingInvite=parseInvitation();
 try{const saved=JSON.parse(localStorage.getItem(accountKey));if(saved&&/^[A-Za-z0-9_-]{20,128}$/.test(saved.token)&&typeof saved.id==='string'&&Number.isSafeInteger(saved.revision)){settings={...saved,url:garminURL(saved.url)};}}catch{}
 const initialGarmin=()=>{try{return JSON.parse(localStorage.getItem('my-character-garmin-v1'));}catch{return null;}};
 function save(){localStorage.setItem(accountKey,JSON.stringify(settings));}
 async function request(url,path,{token,body}={}){
  let response;try{response=await fetch(garminURL(url)+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw new Error('Нет связи с сервером. Записи сохраняются на этом устройстве.');}
  let result;try{result=await response.json();}catch{throw new Error('Сервис аккаунтов пока не установлен. Обнови коннектор на сервере.');}
  if(!response.ok){const error=new Error(messages[result.error]||'Сервис аккаунтов пока недоступен. Проверь обновление сервера.');error.code=result.error;throw error;}return result;
 }
 function status(text){$('friends-status').textContent=text;}
 function render(){
  $('friends-start').hidden=Boolean(settings);$('friends-account').hidden=!settings;$('friends-board').hidden=!settings;
  $('friends-conflict').hidden=!conflict;
  if(settings){$('friends-name').textContent=getProfile()?.name||settings.username;$('friends-login-name').textContent='Логин: '+settings.username;$('friends-invite').hidden=!settings.owner;}
  for(const button of document.querySelectorAll('[data-friends-period]')){const active=button.dataset.friendsPeriod===period;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
 }
 function go(){onNavigate('progress');document.querySelector('[data-progress-tab=friends]').click();}
 function open(mode){
  if(settings){notify('Ты уже вошёл в аккаунт. Для другого аккаунта сначала выйди.');return;}
  if(!getProfile()){notify('Сначала создай персонажа.');return;}
  go();$('friends-form').reset();$('friends-mode').value=mode;
  $('friends-url').value=pendingInvite?.url||settings?.url||initialGarmin()?.url||'';
  $('friends-invite-code').value=pendingInvite?.invite||'';
  $('friends-error').textContent='';modeChanged();$('friends-dialog').showModal();onDialog();
 }
 function modeChanged(){const mode=$('friends-mode').value;$('friends-invite-field').hidden=mode!=='join';$('friends-invite-code').required=mode==='join';$('friends-password').autocomplete=mode==='login'?'current-password':'new-password';$('friends-account-note').textContent=mode==='login'?'Загрузим твой профиль и дневник с сервера. Текущая локальная копия останется в резерве на этом устройстве.':'Твой персонаж и дневник сохранятся в отдельном аккаунте. Друзьям будут видны имя, уровень и XP за выбранный период.';}
 $('friends-mode').addEventListener('change',modeChanged);
 $('friends-create').addEventListener('click',()=>open('create'));
 $('friends-login').addEventListener('click',()=>open('login'));
 $('friends-join').addEventListener('click',()=>open('join'));
 $('close-friends').addEventListener('click',()=>$('friends-dialog').close());
 $('friends-dialog').addEventListener('close',()=>{$('friends-password').value='';onDialog();});
 function adopt(result,url,preserveGarmin=false){
  const account=result.account;
  if(!account||typeof account.id!=='string'||!account.profile||!account.state||!Number.isSafeInteger(account.revision))throw new Error('Сервер вернул некорректный аккаунт.');
  if(!localStorage.getItem(backupKey))localStorage.setItem(backupKey,JSON.stringify(bundle()));
  let pending=null;
  if(!preserveGarmin&&settings?.id!==account.id){let cached=null;try{cached=JSON.parse(localStorage.getItem('my-character-account-cache:'+account.id));}catch{}restore(cached);if(cached?.dirty&&Number.isSafeInteger(cached.accountRevision))pending=cached;}
  if(!pending){localStorage.setItem('my-character-v2',JSON.stringify(normalize(account.state)));localStorage.setItem('my-character-profile-v1',JSON.stringify(account.profile));}
  settings={url,token:result.token,id:account.id,username:account.username,owner:account.owner,revision:pending?pending.accountRevision:account.revision,dirty:Boolean(pending),...(settings?.id===account.id&&settings.invite?{invite:settings.invite}:{}),...(result.invite?{invite:result.invite}:{})};save();
  if(pendingInvite)history.replaceState(null,'',location.pathname+location.search);
  sessionStorage.setItem('my-character-open-friends','1');location.reload();
 }
 $('friends-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('friends-submit');if(button.disabled)return;button.disabled=true;$('friends-error').textContent='';
  try{
   const mode=$('friends-mode').value,url=garminURL($('friends-url').value.trim()),owner=initialGarmin();
   if(mode==='create'&&(!owner?.token||owner.url!==url))throw new Error(messages.owner_required);
   const body={username:$('friends-username').value.trim(),password:$('friends-password').value,...(mode!=='login'?{profile:getProfile(),state:getState(),invite:$('friends-invite-code').value.trim()}:{})};
   const result=await request(url,mode==='create'?'/v2/create-group':mode==='join'?'/v2/register':'/v2/login',{token:mode==='create'?owner.token:undefined,body});
   adopt(result,url,mode!=='login');
  }catch(error){$('friends-error').textContent=error.message;}finally{button.disabled=false;$('friends-password').value='';}
 });
 async function refresh(){
  if(!settings)return;
  const ticket=++boardGeneration,selectedPeriod=period;
  try{const result=await request(settings.url,'/v2/leaderboard/'+selectedPeriod,{token:settings.token});
   if(ticket!==boardGeneration||selectedPeriod!==period)return;
   const label=day=>new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'}).format(new Date(day+'T12:00:00'));
   $('friends-range').textContent=label(result.start)+' — '+label(result.end);
   $('friends-list').replaceChildren(...result.entries.map(entry=>{const row=node('li',null,'friend-row');row.classList.toggle('friend-self',entry.id===settings.id);const text=node('div');text.append(node('b',entry.name+(entry.id===settings.id?' · ты':'')),node('small','Уровень '+entry.level));row.append(node('span',String(entry.rank),'friend-rank'),text,node('strong',formatXP(entry.xp)+' XP'));return row;}));
  }catch(error){status(error.message);}
 }
 async function initialize(){
  if(!settings||busy)return;busy=true;render();status('Проверяю сохранённый дневник…');
  try{const {account,features}=await request(settings.url,'/v2/me',{token:settings.token});updatedProgress=features?.customHabits===true&&features?.swimming===true;
   if(!getProfile()){adopt({account,token:settings.token},settings.url);return;}
   if(account.revision!==settings.revision){if(settings.dirty){conflict=true;status(messages.sync_conflict);}else{adopt({account,token:settings.token},settings.url);return;}}
   else if(JSON.stringify(normalize(account.state))!==JSON.stringify(getState())||JSON.stringify(account.profile)!==JSON.stringify(getProfile())){settings.dirty=true;save();}
   ready=true;if(!conflict)status(settings.dirty?'Есть записи для отправки.':'Дневник сохранён на сервере.');
  }catch(error){status(error.message);ready=false;}finally{busy=false;render();}
  if(ready&&!conflict&&settings.dirty)flush();refresh();
 }
 async function flush(){
  if(!settings||!settings.dirty||busy||conflict)return;
  if(!ready){await initialize();return;}
  const local=getState();if(!updatedProgress&&needsUpdatedProgress(local)){status(updateMessage);return;}
  busy=true;const ticket=version;status('Сохраняю дневник…');
  try{const {account}=await request(settings.url,'/v2/sync',{token:settings.token,body:{revision:settings.revision,profile:getProfile(),state:getState()}});settings.revision=account.revision;if(version===ticket)settings.dirty=false;save();status(settings.dirty?'Есть новые записи для отправки.':'Дневник сохранён на сервере.');await refresh();}
  catch(error){if(error.code==='sync_conflict')conflict=true;status(error.message);}finally{busy=false;render();if(settings?.dirty&&!conflict&&version!==ticket)timer=setTimeout(flush,800);}
 }
 function changed(){
  if(pendingInvite&&getProfile()&&!settings){const value=pendingInvite;setTimeout(()=>{if(!document.querySelector('dialog[open]')){pendingInvite=value;open('join');}},0);}
  if(!settings)return;version++;settings.dirty=true;try{save();}catch{status('Не удалось сохранить состояние подключения.');return;}clearTimeout(timer);timer=setTimeout(flush,800);
 }
 $('friends-refresh').addEventListener('click',async()=>{if(!ready)await initialize();await flush();await refresh();});
 for(const button of document.querySelectorAll('[data-friends-period]'))button.addEventListener('click',()=>{period=button.dataset.friendsPeriod;render();refresh();});
 $('friends-invite').addEventListener('click',async()=>{
  if(!settings?.owner)return;
  try{if(!settings.invite){const result=await request(settings.url,'/v2/invite',{token:settings.token,body:{}});settings.invite=result.invite;save();}
   const link=invitation(settings.url,settings.invite);$('friends-share-link').value=link;$('friends-share-box').hidden=false;
   try{await navigator.clipboard.writeText(link);notify('Ссылка приглашения скопирована.');}catch{notify('Скопируй ссылку из поля ниже.');}
  }catch(error){status(error.message);}
 });
 $('friends-logout').addEventListener('click',async()=>{
  if(!settings)return;
  $('friends-logout').disabled=true;
  try{localStorage.setItem('my-character-account-cache:'+settings.id,JSON.stringify({...bundle(),accountRevision:settings.revision,dirty:settings.dirty}));const previous=settings;try{await request(previous.url,'/v2/logout',{token:previous.token,body:{}});}catch{}localStorage.removeItem(accountKey);restore(JSON.parse(localStorage.getItem(backupKey)));localStorage.removeItem(backupKey);location.reload();}catch{notify('Не удалось сохранить резервную копию. Выход отменён.');$('friends-logout').disabled=false;}
 });
 async function resolve(merge){
  if(!settings)return;
  try{const {account,features}=await request(settings.url,'/v2/me',{token:settings.token});localStorage.setItem('my-character-account-conflict-backup:'+settings.id,JSON.stringify(bundle()));
   if(!merge){adopt({account,token:settings.token},settings.url);return;}
   const local=getState(),remote=account.state,events=[...new Map([...remote.events,...local.events].map(event=>[event.id,event])).values()],plans=[...new Map([...(remote.plans||[]),...(local.plans||[])].map(plan=>[plan.id,plan])).values()];
   const habits=mergeHabits(remote,local);const state=awardAchievements(normalize({base:Math.max(local.base,remote.base),events,plans,...(habits?{habits}:{})}));
   if(!(features?.customHabits===true&&features?.swimming===true)&&needsUpdatedProgress(state)){status(updateMessage);return;}
   const result=await request(settings.url,'/v2/sync',{token:settings.token,body:{revision:account.revision,profile:getProfile(),state}});adopt({account:result.account,token:settings.token},settings.url);
  }catch(error){status(error.message);}
 }
 $('friends-load-cloud').addEventListener('click',()=>resolve(false));$('friends-merge').addEventListener('click',()=>resolve(true));
 window.addEventListener('online',()=>{if(settings){if(!ready)initialize();else flush();}});
 document.querySelector('[data-progress-tab=friends]').addEventListener('click',()=>{render();if(settings){if(!ready)initialize();else{flush();refresh();}}});
 setInterval(()=>{if(settings&&!document.hidden&&!$('progress-friends').hidden&&!$('panel-progress').hidden){flush();refresh();}},60000);
 render();if(settings)initialize();
 if(pendingInvite&&settings){pendingInvite=null;history.replaceState(null,'',location.pathname+location.search);setTimeout(go,0);}
 else if(pendingInvite&&getProfile())setTimeout(()=>open('join'),0);
 if(sessionStorage.getItem('my-character-open-friends')){sessionStorage.removeItem('my-character-open-friends');go();}
 return {changed};
}
