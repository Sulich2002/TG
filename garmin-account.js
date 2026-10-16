import {garminURL} from './garmin.js?v=0.12.2';
const $=id=>document.getElementById(id);
const errors={garmin_credentials:'Проверь email и пароль Garmin.',garmin_login_failed:'Garmin не подтвердил вход. Проверь пароль и код; иногда Garmin временно ограничивает вход с сервера.',garmin_rate_limited:'Garmin ограничил попытки. Повтори позже.',garmin_login_expired:'Время входа истекло. Начни подключение заново.',garmin_login_cancelled:'Вход отменён.',garmin_busy:'Сейчас выполняется другая операция Garmin. Попробуй чуть позже.',garmin_job_missing:'Подключение прервалось. Начни вход заново.',garmin_mfa_invalid:'Введи код подтверждения из 6–10 цифр.',garmin_already_linked:'Этот Garmin уже связан с другим аккаунтом приложения.',garmin_account_mismatch:'К этому аккаунту приложения уже привязан другой Garmin. Войди в первоначальный аккаунт Garmin.',account_required:'Войди в аккаунт приложения заново.',not_found:'Для подключения часов обнови коннектор на сервере.'};
export function setupAccountGarmin({onDialog,onConnected,notify}){
 let account;try{account=JSON.parse(localStorage.getItem('my-character-account-v1'));if(!account?.id||!/^[A-Za-z0-9_-]{20,128}$/.test(account.token))return null;account.url=garminURL(account.url);}catch{return null;}
 let job=null,pollTimer,running=false,epoch=0;
 async function request(path,body){
  let response;try{response=await fetch(account.url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+account.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw new Error('Нет связи с сервером. Проверь подключение к интернету.');}
  let result;try{result=await response.json();}catch{throw new Error('Сервис часов пока недоступен. Обнови коннектор.');}
  if(!response.ok){const error=new Error(errors[result.error]||'Подключение часов пока недоступно. Обнови коннектор на сервере.');error.code=result.error;throw error;}return result;
 }
 function display(result){
  if(result.phase==='error')throw new Error(errors[result.error]||errors.garmin_login_failed);
  const mfa=result.phase==='mfa';$('garmin-account-credentials').hidden=Boolean(job);$('garmin-account-mfa').hidden=!mfa;
  $('garmin-account-code').required=mfa;$('garmin-account-email').required=!job;$('garmin-account-password').required=!job;
  $('garmin-account-submit').hidden=Boolean(job)&&!mfa;$('garmin-account-submit').disabled=false;$('garmin-account-submit').textContent=mfa?'Подтвердить код':'Подключить Garmin';
  $('garmin-account-status').textContent=mfa?'Garmin запросил код подтверждения. Проверь почту или способ подтверждения, настроенный в Garmin.':result.phase==='syncing'?'Вход выполнен. Загружаю последние занятия и показатели…':'Выполняется вход в Garmin…';
 }
 async function poll(ticket){
  if(ticket!==epoch||!job||!$('garmin-account-dialog').open)return;
  try{const result=await request('/v2/garmin/jobs/'+job);if(ticket!==epoch)return;
   if(result.phase==='connected'){job=null;$('garmin-account-dialog').close();await onConnected();notify('Garmin подключён к твоему аккаунту.');return;}
   display(result);pollTimer=setTimeout(()=>poll(ticket),1500);
  }catch(error){if(ticket!==epoch)return;job=null;$('garmin-account-error').textContent=error.message;resetFields();}
 }
 function resetFields(){running=false;$('garmin-account-credentials').hidden=false;$('garmin-account-mfa').hidden=true;$('garmin-account-code').required=false;$('garmin-account-email').required=true;$('garmin-account-password').required=true;$('garmin-account-submit').hidden=false;$('garmin-account-submit').disabled=false;$('garmin-account-submit').textContent='Подключить Garmin';$('garmin-account-status').textContent='';}
 function open(){epoch++;job=null;running=false;clearTimeout(pollTimer);$('garmin-account-form').reset();$('garmin-account-error').textContent='';resetFields();$('garmin-account-dialog').showModal();onDialog();}
 $('close-garmin-account').addEventListener('click',()=>$('garmin-account-dialog').close());
 $('garmin-account-dialog').addEventListener('close',()=>{epoch++;clearTimeout(pollTimer);if(job)request('/v2/garmin/cancel',{job}).catch(()=>{});job=null;running=false;$('garmin-account-password').value='';$('garmin-account-code').value='';onDialog();});
 $('garmin-account-form').addEventListener('submit',async event=>{
  event.preventDefault();if(running)return;running=true;$('garmin-account-submit').disabled=true;$('garmin-account-error').textContent='';const ticket=epoch;
  try{
   let result;
   if(job){result=await request('/v2/garmin/mfa',{job,code:$('garmin-account-code').value.trim()});$('garmin-account-code').value='';}
   else{result=await request('/v2/garmin/connect',{email:$('garmin-account-email').value.trim(),password:$('garmin-account-password').value});if(ticket!==epoch){if(result.job)request('/v2/garmin/cancel',{job:result.job}).catch(()=>{});return;}if(typeof result.job!=='string'||!/^[A-Za-z0-9_-]{20,128}$/.test(result.job))throw new Error('Сервис вернул некорректный ответ.');job=result.job;}
   if(ticket!==epoch)return;display(result);clearTimeout(pollTimer);pollTimer=setTimeout(()=>poll(ticket),500);
  }catch(error){if(ticket!==epoch)return;$('garmin-account-error').textContent=error.message;if(!job)resetFields();else $('garmin-account-submit').disabled=false;}
  finally{running=false;$('garmin-account-password').value='';}
 });
 return {account,open,activities:()=>request('/v2/garmin/activities'),disconnect:()=>request('/v2/garmin/disconnect',{})};
}
