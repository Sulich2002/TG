import {habitTracker,habitMonth,habitMonthDays} from './habit-tracker.js?v=0.15.0';
import {dayKey,shiftDay} from './progress.js?v=0.15.0';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;};
const dateLabel=day=>new Intl.DateTimeFormat('ru',{day:'numeric',month:'long'}).format(new Date(day+'T12:00:00'));
const monthLabel=month=>new Intl.DateTimeFormat('ru',{month:'long',year:'numeric'}).format(new Date(month+'-01T12:00:00')).replace(' г.','');
const labels={done:'Выполнено',missed:'Без отметки',pending:'Ещё можно выполнить',unknown:'Нет истории',future:'Будущий день'};
const marks={done:'✓',missed:'·',pending:'○',unknown:'',future:''};
const plural=(n,one,few,many)=>new Intl.PluralRules('ru').select(n)==='one'?one:new Intl.PluralRules('ru').select(n)==='few'?few:many;

export function setupHabitTracker({getState,onManage,onNavigate,onDialog}){
 let months=1,anchor=habitMonth(dayKey()),shown=anchor,selected=null,result,signature='';
 function periodText(){return `${dateLabel(result.start)} — ${dateLabel(result.end>dayKey()?dayKey():result.end)}`;}
 function openDetail(id,day=null){selected={id,day};renderDetail();$('habit-detail-dialog').showModal();onDialog();}
 function renderDetail(){
  const row=result.rows.find(row=>row.id===selected?.id);if(!row)return;
  $('habit-detail-title').textContent=row.title;
  $('habit-detail-period').textContent=periodText();
  $('habit-detail-done').textContent=row.done;$('habit-detail-missed').textContent=row.missed;$('habit-detail-best').textContent=row.best;
  $('habit-detail-note').textContent=`Учёт с ${dateLabel(row.activeFrom)}.`;
  const status=$('habit-detail-status');status.replaceChildren();
  if(selected.day){status.className='habit-selected-status is-'+row.status(selected.day);status.append(node('b',dateLabel(selected.day)),node('span',labels[row.status(selected.day)]));}
  else status.className='habit-selected-status';
  $('habit-detail-month').textContent=monthLabel(shown);
  const calendar=$('habit-detail-calendar');calendar.replaceChildren();
  for(const text of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])calendar.append(node('span',text,'habit-calendar-weekday'));
  const offset=(new Date(shown+'-01T12:00:00').getDay()+6)%7;
  for(let i=0;i<offset;i++){const blank=node('span',null,'habit-calendar-blank');blank.setAttribute('aria-hidden','true');calendar.append(blank);}
  for(const day of habitMonthDays(shown)){
   const state=row.status(day),button=node('button',day.slice(8).replace(/^0/,''),'habit-calendar-day is-'+state);button.type='button';button.classList.toggle('selected',day===selected.day);button.classList.toggle('is-today',day===dayKey());button.setAttribute('aria-label',`${dateLabel(day)}: ${labels[state]}`);button.setAttribute('aria-pressed',String(day===selected.day));
   button.addEventListener('click',()=>{selected.day=day;renderDetail();});calendar.append(button);
  }
 }
 function render(){
  const today=dayKey();if(anchor>habitMonth(today))anchor=habitMonth(today);
  result=habitTracker(getState(),{today,month:anchor,months});if(!result.visibleMonths.includes(shown))shown=anchor;
  $('habit-tracker-range').textContent=periodText();$('habit-tracker-done').textContent=result.done;$('habit-tracker-missed').textContent=result.missed;$('habit-tracker-best').textContent=result.best;
  $('habit-tracker-month').textContent=monthLabel(shown);$('habit-month-next').disabled=anchor>=habitMonth(today);
  for(const button of document.querySelectorAll('[data-habit-period]')){const active=Number(button.dataset.habitPeriod)===months;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  $('habit-month-picker').hidden=months===1;
  $('habit-month-picker').replaceChildren(...result.visibleMonths.map(month=>{const button=node('button',new Intl.DateTimeFormat('ru',{month:'short'}).format(new Date(month+'-01T12:00:00')));button.type='button';button.classList.toggle('active',month===shown);button.setAttribute('aria-pressed',String(month===shown));button.addEventListener('click',()=>{shown=month;render();});return button;}));
  const days=habitMonthDays(shown),visibleRows=result.rows.filter(row=>row.activeFrom<=days.at(-1)||days.some(day=>row.status(day)==='done'));
  $('habit-tracker-empty').hidden=visibleRows.length>0;$('habit-grid-wrap').hidden=!visibleRows.length;
  $('habit-empty-title').textContent=shown<habitMonth(today)?'За этот месяц привычек нет':'Место для новых привычек';
  const table=$('habit-grid'),head=node('thead'),heading=node('tr'),corner=node('th','Привычка','habit-grid-name');corner.scope='col';heading.append(corner);
  for(const day of days){const th=node('th',null,'habit-grid-date');th.scope='col';th.classList.toggle('is-today',day===today);th.classList.toggle('is-weekend',[0,6].includes(new Date(day+'T12:00:00').getDay()));th.append(node('span',Number(day.slice(8))),node('small',new Intl.DateTimeFormat('ru',{weekday:'short'}).format(new Date(day+'T12:00:00'))));heading.append(th);}
  head.append(heading);const body=node('tbody');
  for(const row of visibleRows){
   const tr=node('tr'),th=node('th',null,'habit-grid-name');th.scope='row';const name=node('button',null,'habit-grid-title');name.type='button';name.append(node('b',row.title));const count=days.filter(day=>row.status(day)==='done').length;name.append(node('small',`${count} ${plural(count,'отметка','отметки','отметок')}`));name.addEventListener('click',()=>openDetail(row.id));th.append(name);tr.append(th);
   for(const day of days){const status=row.status(day),td=node('td'),button=node('button',marks[status],'habit-grid-cell is-'+status);button.type='button';button.dataset.day=day;button.dataset.habit=row.id;button.setAttribute('aria-label',`${row.title}, ${dateLabel(day)}: ${labels[status]}`);button.classList.toggle('is-today',day===today);button.addEventListener('click',()=>openDetail(row.id,day));td.append(button);tr.append(td);}
   body.append(tr);
  }
  const wrapper=$('habit-grid-wrap'),oldScroll=wrapper.scrollLeft;table.replaceChildren(head,body);table.setAttribute('aria-label',`Календарь привычек: ${monthLabel(shown)}`);
  const nextSignature=shown+':'+visibleRows.map(row=>row.id).join(',');
  if(nextSignature!==signature&&!$('panel-habits').hidden){signature=nextSignature;requestAnimationFrame(()=>{const target=table.querySelector('thead .is-today');wrapper.scrollLeft=target?Math.max(0,target.offsetLeft-116-(wrapper.clientWidth-116)/2):0;});}else wrapper.scrollLeft=oldScroll;
  if($('habit-detail-dialog').open)renderDetail();
 }
 for(const button of document.querySelectorAll('[data-habit-period]'))button.addEventListener('click',()=>{months=Number(button.dataset.habitPeriod);shown=anchor;render();});
 $('habit-month-prev').addEventListener('click',()=>{anchor=habitMonth(anchor+'-01',-1);shown=anchor;render();});
 $('habit-month-next').addEventListener('click',()=>{if(anchor<habitMonth(dayKey())){anchor=habitMonth(anchor+'-01',1);shown=anchor;render();}});
 $('habit-tracker-manage').addEventListener('click',onManage);$('habit-tracker-empty-add').addEventListener('click',onManage);
 $('close-habit-detail').addEventListener('click',()=>$('habit-detail-dialog').close());$('habit-detail-dialog').addEventListener('close',()=>{selected=null;onDialog();});
 $('habit-detail-today').addEventListener('click',()=>{$('habit-detail-dialog').close();onNavigate('today');});
 return {render};
}
