import {setupAccountGarmin} from './garmin-account.js?v=0.14.2';
import {mergeHealthHistory} from './health-analysis.js?v=0.14.2';
import {setupHealthAnalysis} from './health-analysis-ui.js?v=0.14.2';
import {garminURL,garminRequest} from './garmin.js?v=0.14.2';
import {garminCandidates,importGarmin,dayKey,workoutDescription,workoutXP,formatXP} from './progress.js?v=0.14.2';
const $=id=>document.getElementById(id),storageKey='my-character-garmin-v1';
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;};

export function appendGarminDetails(container,source){
  container.append(node('small','Garmin Connect','garmin-source'));
  const details=node('details',null,'garmin-details');details.append(node('summary','Пульс и данные часов'));
  const metrics=node('p');metrics.textContent=[source.averageHeartRate!==null?`Средний пульс: ${Math.round(source.averageHeartRate)} уд/мин`:null,source.maximumHeartRate!==null?`Максимальный: ${Math.round(source.maximumHeartRate)} уд/мин`:null].filter(Boolean).join(' · ')||'Пульс в этой записи отсутствует';details.append(metrics);
  const samples=source.heartRateSamples;
  if(samples.length>1){
    const minimum=Math.min(...samples.map(s=>s.bpm)),maximum=Math.max(...samples.map(s=>s.bpm)),span=Math.max(1,samples.at(-1).timestamp-samples[0].timestamp),range=Math.max(10,maximum-minimum),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 240 85');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Пульс по ходу занятия: от ${minimum} до ${maximum} ударов в минуту`);
    const path=document.createElementNS(svg.namespaceURI,'polyline');path.setAttribute('points',samples.map(s=>`${((s.timestamp-samples[0].timestamp)/span*236+2).toFixed(1)},${(77-(s.bpm-minimum)/range*68).toFixed(1)}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#ffa67e');path.setAttribute('stroke-width','2');svg.append(path);details.append(svg,node('small',`${minimum}–${maximum} уд/мин · от начала к концу занятия`));
  }
  if(source.movingDurationSeconds!==null)details.append(node('p',`В движении: ${formatXP(source.movingDurationSeconds/60)} мин`));
  if(source.elapsedDurationSeconds!==null)details.append(node('p',`С учётом пауз: ${formatXP(source.elapsedDurationSeconds/60)} мин`));
  container.append(details);
}

export function setupGarmin({getState,persist,notify,getProfile,onImport,onDialog,onNavigate}){
  let settings=null,busy=false,generation=0,preview=[],payload=[],stopped=false,health=[],healthDay,connected=false,legacyFallback=false;
  try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&typeof saved.token==='string'&&/^[A-Za-z0-9_-]{20,128}$/.test(saved.token)){settings={url:garminURL(saved.url),token:saved.token,knownIds:Array.isArray(saved.knownIds)?saved.knownIds.filter(id=>typeof id==='string').slice(-5000):[],initialReviewed:saved.initialReviewed===true,automatic:saved.automatic===true,mode:saved.mode,scope:saved.scope,connectionId:saved.connectionId,connected:saved.connected===true,connectedDay:/^\d{4}-\d{2}-\d{2}$/.test(saved.connectedDay)?saved.connectedDay:dayKey()};}}catch{}
  const previous=settings;
  const accountClient=setupAccountGarmin({onDialog,notify,onConnected:async()=>{generation++;busy=false;connected=true;settings={...settings,connected:true,initialReviewed:false,automatic:true};save(settings);render();await poll(true);}});
  if(accountClient){const {account}=accountClient;const same=settings?.scope===account.id||(account.owner&&settings?.url===account.url&&!settings?.scope);settings={url:account.url,token:account.token,scope:account.id,mode:'account',knownIds:same?settings.knownIds:[],initialReviewed:same?settings.initialReviewed:false,automatic:same?settings.automatic:true,connectedDay:same?settings.connectedDay:dayKey(),connectionId:same?settings.connectionId:null,connected:same&&settings.connected===true};connected=settings.connected;}
  else connected=Boolean(settings);
  const isConnected=()=>Boolean(settings)&&connected;
  try{const saved=JSON.parse(localStorage.getItem('my-character-garmin-health-v1'));if(settings&&saved?.url===settings.url&&(!accountClient||saved.scope===settings.scope||(accountClient.account.owner&&!saved.scope)))health=mergeHealthHistory([],Array.isArray(saved.rows)?saved.rows.slice(0,120):[],dayKey());}catch{}
  const analysis=setupHealthAnalysis({onNavigate});
  $('garmin-analysis-open').addEventListener('click',()=>analysis.open('sleep',healthDay));
  function renderHealth(){
    analysis.update(health,isConnected());
    $('garmin-health').hidden=!isConnected()||!health.length;if(!isConnected()||!health.length)return;
    if(!health.some(item=>item.day===healthDay))healthDay=health[0].day;
    const current=health.find(item=>item.day===healthDay),fmt=new Intl.NumberFormat('ru',{maximumFractionDigits:0});
    $('garmin-health-day').replaceChildren(...health.map(item=>{const option=node('option',new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'}).format(new Date(item.day+'T12:00:00')));option.value=item.day;return option;}));$('garmin-health-day').value=healthDay;
    const duration=seconds=>{if(seconds===null)return '—';const minutes=Math.round(seconds/60);return minutes>=60?`${Math.floor(minutes/60)} ч ${minutes%60} мин`:`${minutes} мин`;};
    const metric=(key,label,value,unit)=>{const tile=node('button');tile.type='button';tile.setAttribute('aria-label',label+' — открыть график');tile.addEventListener('click',()=>analysis.open(key,healthDay));tile.append(node('small',label),node('b',value===null?'—':typeof value==='string'?value:fmt.format(value)),node('span',unit));return tile;};
    $('garmin-health-metrics').replaceChildren(metric('sleep','Сон',duration(current.sleepSeconds),'ночь к выбранной дате'),metric('pulse','Пульс в покое',current.restingHeartRate,'уд/мин'),metric('steps','Шаги',current.steps,'за выбранный день'),metric('battery',current.bodyBattery!==null?'Body Battery':'Пик Body Battery',current.bodyBattery??current.bodyBatteryHighest,'по шкале Garmin / 100'),metric('stress','Средний стресс',current.averageStress,'по шкале Garmin / 100'),metric('hrv','Ночной HRV',current.hrvNightAverage,'мс'));
    $('garmin-sleep-stages').replaceChildren(...Object.entries({deep:'Глубокий',light:'Лёгкий',rem:'REM',awake:'Бодрствование'}).map(([key,label])=>node('p',`${label}: ${duration(current.sleepStages[key])}`)));
    if(current.sleepScore!==null)$('garmin-sleep-stages').prepend(node('p',`Оценка сна Garmin: ${fmt.format(current.sleepScore)} / 100`));
    $('garmin-sleep-details').hidden=current.sleepSeconds===null;
    const range=[current.minimumHeartRate!==null?`Минимальный пульс за день: ${fmt.format(current.minimumHeartRate)}`:null,current.maximumHeartRate!==null?`максимальный: ${fmt.format(current.maximumHeartRate)} уд/мин`:null].filter(Boolean).join(' · ');
    $('garmin-daily-heart').textContent=range;
    $('garmin-health-updated').textContent=(current.warnings.length?'Часть данных временно недоступна. ':'')+(current.updated?`Данные Garmin от ${new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(current.updated))}. `:'')+'Пустое значение означает, что данных пока нет. Эти показатели не дают XP.';
  }
  $('garmin-health-day').addEventListener('change',()=>{healthDay=$('garmin-health-day').value;renderHealth();});
  function save(next){const stored=legacyFallback&&previous&&next?.mode==='account'?{...next,url:previous.url,token:previous.token,mode:previous.mode,scope:previous.scope}:next;try{if(next)localStorage.setItem(storageKey,JSON.stringify(stored));else localStorage.removeItem(storageKey);}catch{throw new Error('Не удалось сохранить подключение на устройстве');}settings=next;}
  function status(text){$('garmin-status').textContent=text;}
  function render(){
    $('garmin-connect').textContent=isConnected()?'Войти в Garmin заново':'Подключить Garmin';
    $('garmin-refresh').hidden=!isConnected();$('garmin-disconnect').hidden=!isConnected();
    $('garmin-refresh').disabled=busy;
    if(!settings)status('Подключи свои часы: занятия, сон, пульс и другие доступные показатели.');
    renderHealth();
  }
  function mark(ids){const next={...settings,knownIds:[...new Set([...settings.knownIds,...ids])].slice(-5000)};save(next);}
  function showPreview(activities){
    payload=activities;
    const known=new Set(settings.knownIds);preview=garminCandidates(getState(),activities).filter(item=>!known.has(item.id));
    $('garmin-import-list').replaceChildren(...preview.map(item=>{
      const label=node('label',null,'garmin-import-row'),input=node('input');input.type='checkbox';input.value=item.id;input.checked=!item.duplicate;
      const text=node('span');text.append(node('b',item.title),node('small',`${item.data.day} · ${workoutDescription(item.data)} · +${formatXP(workoutXP(item.data))} XP`));
      if(item.data.type==='other')text.append(node('em','Сохранится в истории без опыта за объём'));
      if(item.duplicate)text.append(node('em','Похоже на уже записанное занятие — проверь перед импортом'));
      label.append(input,text);return label;
    }));
    $('garmin-import-note').textContent=preview.length?'Выбери занятия для дневника. За них начислится опыт и могут открыться достижения.':'Новых занятий пока нет. Уже импортированные записи повторно не добавляются.';
    $('garmin-automatic').checked=settings.automatic;$('garmin-import-error').textContent='';
    $('garmin-import-dialog').showModal();onDialog();
  }
  async function poll(review=false){
    if(!settings||busy||!getProfile()||stopped)return;
    const ticket=generation,current=settings;busy=true;render();status('Проверяю записи Garmin…');
    try{
      let result;
      if(accountClient){try{result=await accountClient.activities();legacyFallback=false;}
        catch(error){if(accountClient.account.owner&&previous?.mode!=='account'&&previous?.token&&['not_found','unauthorized'].includes(error.code)){result=await garminRequest(previous.url,'/v1/activities',{token:previous.token});legacyFallback=true;result.connected=true;}else throw error;}
      }else result=await garminRequest(current.url,'/v1/activities',{token:current.token});
      if(ticket!==generation||stopped)return;
      connected=accountClient?result.connected===true:true;
      if(!connected){health=[];try{localStorage.removeItem('my-character-garmin-health-v1');}catch{}renderHealth();status('Garmin пока не подключён. Нажми «Подключить Garmin».');return;}
      if(accountClient&&result.connectionId){if(settings.connectionId&&settings.connectionId!==result.connectionId){settings.knownIds=[];settings.initialReviewed=false;health=[];}settings.connectionId=result.connectionId;settings.connected=true;save(settings);}

      if(ticket!==generation||stopped)return;
      if(!Array.isArray(result.activities)||result.activities.length>100)throw new Error('Garmin-сервис вернул неожиданный ответ');
      if(Array.isArray(result.health)){health=mergeHealthHistory(health,result.health.slice(0,120),dayKey());try{localStorage.setItem('my-character-garmin-health-v1',JSON.stringify({url:settings.url,scope:settings.scope,rows:health}));}catch{}renderHealth();}
      if(review){showPreview(result.activities);return;}
      if(!settings.initialReviewed){status('Подключено. Нажми «Новые занятия», чтобы выбрать записи для первого импорта.');return;}
      const known=new Set(settings.knownIds),candidates=garminCandidates(getState(),result.activities).filter(item=>!known.has(item.id));
      const automatic=settings.automatic?candidates.filter(item=>!item.duplicate&&item.data.day>=settings.connectedDay):[];
      if(automatic.length){
        if(!persist(importGarmin(getState(),result.activities,automatic.map(item=>item.id)),`Garmin: добавлено ${automatic.length} занятий`))return;
        mark(automatic.map(item=>item.id));
      }
      const pending=candidates.length-automatic.length;
      const errors={login_required:accountClient?'Нужно войти в Garmin заново через кнопку подключения':'На сервере нужен повторный вход в Garmin',rate_limited:'Garmin ограничил запросы; сервер повторит позже',unavailable:'Garmin временно недоступен; показаны последние загруженные записи'};
      status(errors[result.syncError]||(pending?`Есть ${pending} записей для проверки. Нажми «Новые занятия».`:result.lastSync?`Обновлено: ${new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(result.lastSync))}`:'Сервер ещё не загрузил занятия'));
    }catch(error){if(ticket===generation)status(error instanceof TypeError?'Не удалось связаться с Garmin-сервисом. Проверь его адрес и работу сервера.':error.message);}
    finally{if(ticket===generation){busy=false;render();}}
  }
  $('garmin-connect').addEventListener('click',()=>{if(accountClient){accountClient.open();return;}$('garmin-form').reset();$('garmin-url').value=settings?.url||'';$('garmin-error').textContent='';$('garmin-dialog').showModal();onDialog();});
  $('close-garmin').addEventListener('click',()=>$('garmin-dialog').close());
  $('garmin-dialog').addEventListener('close',()=>{$('garmin-password').value='';onDialog();});
  $('garmin-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('garmin-submit');if(button.disabled)return;button.disabled=true;$('garmin-error').textContent='';
    let url,newToken;
    try{
      url=garminURL($('garmin-url').value.trim());
      const result=await garminRequest(url,'/v1/login',{method:'POST',password:$('garmin-password').value});
      if(typeof result.token!=='string'||!/^[A-Za-z0-9_-]{20,128}$/.test(result.token))throw new Error('Некорректный ответ сервиса');
      newToken=result.token;
      if(!$('garmin-dialog').open){garminRequest(url,'/v1/logout',{method:'POST',token:newToken}).catch(()=>{});return;}
      const previous=settings;
      save({url,token:newToken,knownIds:previous?.url===url?previous.knownIds:[],initialReviewed:false,automatic:true,connectedDay:previous?.url===url?previous.connectedDay:dayKey()});
      if(previous?.url!==url){health=[];try{localStorage.removeItem('my-character-garmin-health-v1');}catch{}}
      generation++;busy=false;connected=true;$('garmin-dialog').close();render();await poll(true);
      if(previous)garminRequest(previous.url,'/v1/logout',{method:'POST',token:previous.token}).catch(()=>{});
    }catch(error){if(newToken&&settings?.token!==newToken)garminRequest(url,'/v1/logout',{method:'POST',token:newToken}).catch(()=>{});$('garmin-error').textContent=error instanceof TypeError?'Сервис не отвечает. Проверь HTTPS-адрес.':error.message;}
    finally{button.disabled=false;$('garmin-password').value='';}
  });
  $('garmin-refresh').addEventListener('click',()=>poll(true));
  $('garmin-disconnect').addEventListener('click',async()=>{
    if(accountClient&&!legacyFallback){try{await accountClient.disconnect();generation++;busy=false;connected=false;health=[];settings={...settings,connected:false};save(settings);localStorage.removeItem('my-character-garmin-health-v1');render();status('Garmin отключён. Можно подключиться заново.');notify('Garmin отключён. Дневник занятий сохранён.');}catch(error){notify(error.message);}return;}
    const previous=settings;try{save(null);localStorage.removeItem('my-character-garmin-health-v1');}catch(error){notify(error.message);return;}generation++;busy=false;connected=false;health=[];render();
    if(previous)garminRequest(previous.url,'/v1/logout',{method:'POST',token:previous.token}).catch(()=>{});
    notify('Подключение на этом устройстве удалено. Записи в дневнике сохранены.');
  });
  $('close-garmin-import').addEventListener('click',()=>$('garmin-import-dialog').close());
  $('garmin-import-dialog').addEventListener('close',onDialog);
  $('garmin-import-form').addEventListener('submit',event=>{
    event.preventDefault();if(!settings)return;
    const selected=[...$('garmin-import-list').querySelectorAll('input:checked')].map(input=>input.value);
    if(selected.length&&!persist(importGarmin(getState(),payload,selected),`Garmin: добавлено ${selected.length} занятий`))return;
    try{mark(preview.map(item=>item.id));save({...settings,initialReviewed:true,automatic:$('garmin-automatic').checked});}
    catch(error){$('garmin-import-error').textContent=error.message;return;}
    $('garmin-import-dialog').close();status('Подключено. Новые записи проверяются при открытии приложения.');
    if(selected.length)onImport(preview.find(item=>selected.includes(item.id)).data.day);
    if(!selected.length)notify('Выбор сохранён. Опыт за пропущенные записи не начислен.');
  });
  function onVisible(){if(!document.hidden)poll();}
  document.addEventListener('visibilitychange',onVisible);
  const timer=setInterval(()=>{if(!document.hidden)poll();},300000);render();if(settings&&getProfile())poll();
  return {refresh:()=>poll(),stop:()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);}};
}
