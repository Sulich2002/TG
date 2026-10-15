import {healthMetrics,healthPeriod,healthSummary,metricValue,formatHealth} from './health-analysis.js?v=0.8.0';
import {dayKey} from './progress.js?v=0.8.0';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;};
const dateLabel=day=>new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'}).format(new Date(day+'T12:00:00'));

export function setupHealthAnalysis({onNavigate}){
  let rows=[],connected=false,key='sleep',selectedDay=dayKey(),days=7;
  try{const saved=Number(localStorage.getItem('my-character-garmin-period'));if([2,3,7,30].includes(saved))days=saved;}catch{}
  $('garmin-analysis-period').value=String(days);
  $('garmin-analysis-period').addEventListener('change',()=>{days=Number($('garmin-analysis-period').value);try{localStorage.setItem('my-character-garmin-period',String(days));}catch{}render();});
  function chooseTab(tab){
    for(const button of document.querySelectorAll('[data-progress-tab]')){const active=button.dataset.progressTab===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
    for(const name of ['activities','garmin','friends'])$('progress-'+name).hidden=tab!==name;
  }
  for(const button of document.querySelectorAll('[data-progress-tab]'))button.addEventListener('click',()=>{chooseTab(button.dataset.progressTab);render();});
  document.querySelector('.progress-tabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const buttons=[...document.querySelectorAll('[data-progress-tab]')],index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();
  });
  $('garmin-analysis-connect').addEventListener('click',()=>onNavigate('workout'));
  function open(metric='sleep',day){key=healthMetrics[metric]?metric:'sleep';selectedDay=day||dayKey();chooseTab('garmin');onNavigate('progress');render();}
  function render(){
    const today=dayKey(),week=healthPeriod(rows,today,days),metric=healthMetrics[key],summary=healthSummary(week,key,today);
    if(!week.some(p=>p.day===selectedDay))selectedDay=today;
    $('garmin-analysis-empty').hidden=connected&&rows.length>0;
    $('garmin-analysis-content').hidden=!connected||!rows.length;
    $('garmin-analysis-empty-text').textContent=!connected?'Подключи Garmin во вкладке «Занятие». Здесь появятся сон, пульс, стресс и другие показатели.':'Подключение есть. Сервер пока не передал данные о сне и самочувствии.';
    if(!connected||!rows.length)return;
    $('garmin-analysis-chart').classList.toggle('health-chart-wide',days===30);
    $('garmin-analysis-chart').style.setProperty('--health-days',days);
    $('garmin-analysis-range').textContent=`${dateLabel(week[0].day)} — ${dateLabel(today)}`;
    $('garmin-metric-picker').replaceChildren(...Object.entries(healthMetrics).map(([id,item])=>{const button=node('button',item.label);button.type='button';button.classList.toggle('active',id===key);button.setAttribute('aria-pressed',String(id===key));button.addEventListener('click',()=>{key=id;render();});return button;}));
    $('garmin-analysis-title').textContent=metric.label;
    $('garmin-analysis-description').textContent=metric.description;
    $('garmin-analysis-average').textContent=formatHealth(summary.average,key);
    $('garmin-analysis-unit').textContent=key==='sleep'?'в среднем за ночь':metric.unit;
    const nights=key==='sleep'||key==='hrv',forms=nights?{one:'ночь',few:'ночи',many:'ночей',other:'ночи'}:{one:'день',few:'дня',many:'дней',other:'дня'},countLabel=forms[new Intl.PluralRules('ru').select(summary.count)];
    $('garmin-analysis-coverage').textContent=`Данные: ${summary.available} из ${days} дней. В среднем учтено: ${summary.count} ${countLabel}.`+(metric.partial?' Сегодняшний день в среднее не входит.':'');
    $('garmin-analysis-chart').replaceChildren(...summary.points.map(point=>{
      const button=node('button',null,'health-bar');button.type='button';button.classList.toggle('selected',point.day===selectedDay);button.setAttribute('aria-pressed',String(point.day===selectedDay));button.setAttribute('aria-label',`${dateLabel(point.day)}: ${formatHealth(point.value,key)}${point.partial?' · день ещё идёт':''}`);
      button.append(node('span',point.value===null?'—':key==='sleep'?new Intl.NumberFormat('ru',{maximumFractionDigits:1}).format(point.value/3600):formatHealth(point.value,key),'health-bar-value'));
      const track=node('span',null,'health-bar-track'),bar=node('i');bar.style.height=point.value===null?'0':`${Math.max(3,point.value/Math.max(1,...summary.points.map(p=>p.value??0))*100)}%`;track.classList.toggle('missing',point.value===null);track.classList.toggle('partial',point.partial);track.append(bar);button.append(track,node('small',point.day.slice(8)));button.addEventListener('click',()=>{selectedDay=point.day;render();});return button;
    }));
    const chart=$('garmin-analysis-chart'),selected=chart.querySelector('.selected');
    if(days===30&&selected&&chart.clientWidth){chart.scrollLeft+=selected.getBoundingClientRect().left-chart.getBoundingClientRect().left-(chart.clientWidth-selected.clientWidth)/2;}
    $('garmin-analysis-extremes').textContent=summary.count?`Минимум: ${formatHealth(summary.minimum,key)} · максимум: ${formatHealth(summary.maximum,key)}`:'Для среднего пока нет завершённых дней с данными.';
    const {left,right}=summary.comparison;
    $('garmin-analysis-change').textContent=summary.change===null?'Для сравнения нужны данные за все дни двух равных частей периода. Незавершённый день не участвует.':`Изменение среднего за ${dateLabel(right[0])}${right.length>1?'–'+dateLabel(right.at(-1)):''} по сравнению с ${dateLabel(left[0])}${left.length>1?'–'+dateLabel(left.at(-1)):''}: ${summary.change>0?'+':''}${formatHealth(summary.change,key)}${key==='sleep'?'':` ${metric.unit}`}.`;

    const current=week.find(p=>p.day===selectedDay)?.row,value=metricValue(current,key);
    $('garmin-analysis-day-title').textContent=dateLabel(selectedDay)+(selectedDay===today?' · сегодня':'');
    const detail=$('garmin-analysis-day');detail.replaceChildren(node('b',`${formatHealth(value,key)}${key==='sleep'?'':` ${metric.unit}`}`));
    if(value===null)detail.append(node('p',current?.warnings.includes(metric.section)?'Обновление этого показателя не удалось. Он исключён из расчётов.':'За эту дату показателя нет. Пропуски не считаются нулями.'));
    if(current&&value!==null&&key==='sleep'){
      if(current.sleepScore!==null)detail.append(node('p',`Оценка сна Garmin: ${current.sleepScore} / 100`));
      for(const [id,label] of Object.entries({deep:'Глубокий',light:'Лёгкий',rem:'REM',awake:'Бодрствование'}))detail.append(node('p',`${label}: ${formatHealth(current.sleepStages[id],'sleep')}`));
    }
    if(current&&key==='pulse'&&value!==null)detail.append(node('p',`Пульс за день: минимум ${formatHealth(current.minimumHeartRate,'pulse')}, максимум ${formatHealth(current.maximumHeartRate,'pulse')} уд/мин`));
    if(current&&key==='battery'&&!current.warnings.includes('daily'))detail.append(node('p',`Заряд на момент обновления: ${formatHealth(current.bodyBattery,'battery')} / 100`));
    if(metric.partial&&selectedDay===today)detail.append(node('p','День ещё идёт — значение предварительное.'));
    if(current?.updated)detail.append(node('small',`Обновлено ${new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(current.updated))}`));
  }
  chooseTab('activities');render();
  return {open,update(next,isConnected){rows=next;connected=isConnected;render();}};
}
