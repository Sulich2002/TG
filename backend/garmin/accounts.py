"""Small private friend groups. Account sessions never authorize Garmin endpoints."""
import json
import math
import re
import secrets
import time
from datetime import date, timedelta
from zoneinfo import ZoneInfo
from datetime import datetime
from pathlib import Path


class AccountError(Exception):
    def __init__(self, code, status=400):
        self.code, self.status = code, status


def today_key():
    return datetime.now(ZoneInfo('Europe/Moscow')).date().isoformat()


def valid_day(value, today):
    try:
        return isinstance(value, str) and date.fromisoformat(value).isoformat() == value and value <= today
    except ValueError:
        return False


def number(value, minimum, maximum, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum or (integer and int(value) != value):
        raise AccountError('invalid_progress')
    return value


def profile_data(raw):
    if not isinstance(raw, dict):
        raise AccountError('invalid_profile')
    if not isinstance(raw.get('name'),str):raise AccountError('invalid_profile')
    name = re.sub(r'[\x00-\x1f\x7f]', '', raw['name']).strip()[:30]
    if not name or raw.get('sex') not in ('male', 'female'):
        raise AccountError('invalid_profile')
    return dict(name=name, sex=raw['sex'], age=number(raw.get('age'),16,100,True), height=number(raw.get('height'),120,230), weight=number(raw.get('weight'),35,250))


def rounded(value):
    return math.floor(value*10+0.5)/10


HABIT_DEFAULTS={'warmup':('Размяться',5),'shower':('Принять душ',5),'breakfast':('Позавтракать',5),'reading':('Почитать',10)}


def habit_record(raw):
    if not isinstance(raw,dict) or not isinstance(raw.get('id'),str) or not re.fullmatch(r'[A-Za-z0-9:_-]{1,100}',raw['id']):raise AccountError('invalid_progress')
    identity=raw['id']
    if identity in HABIT_DEFAULTS:title,xp=HABIT_DEFAULTS[identity]
    else:
        title=re.sub(r'[\x00-\x1f\x7f]','',raw.get('title','')).strip()[:80] if isinstance(raw.get('title'),str) else ''
        xp=raw.get('xp')
        if not identity.startswith('custom:') or not title or type(xp) not in (int,float) or xp not in (5,10):raise AccountError('invalid_progress')
    return {'id':identity,'title':title,'xp':xp}


def legacy_bonus_days(events):
    tasks={}
    for event in events:
        if event['kind']=='task':tasks.setdefault(event['day'],set()).add(event['task'])
    return {day for day,items in tasks.items() if len(items)==4}


def validate_state(raw, today):
    if not isinstance(raw, dict) or not isinstance(raw.get('events'),list) or len(raw['events']) > 20000:
        raise AccountError('invalid_progress')
    state = {'base':number(raw.get('base',0),0,10000000,True),'events':[], 'plans':raw.get('plans',[])}
    if not isinstance(state['plans'],list) or len(state['plans'])>5000:
        raise AccountError('invalid_progress')
    if 'habits' in raw:
        if not isinstance(raw['habits'],list) or len(raw['habits'])>100:raise AccountError('invalid_progress')
        habits=[];ids=set()
        for item in raw['habits']:
            habit=habit_record(item)
            if habit['id'] in ids:raise AccountError('invalid_progress')
            ids.add(habit['id']);updated=number(item.get('updatedAt',0),0,2**53-1,True)
            habits.append({**habit,'archived':item.get('archived') is True,'updatedAt':updated})
        state['habits']=habits
    tasks={'warmup':5,'shower':5,'breakfast':5,'reading':10}
    sizes={'small':5,'medium':10,'large':20}
    seen=set()
    catalog=json.loads(Path(__file__).with_name('rewards.json').read_text())
    badges={item['id']:item for item in catalog}
    for raw_event in raw['events']:
        if not isinstance(raw_event,dict):raise AccountError('invalid_progress')
        event=dict(raw_event);identity=event.get('id');day=event.get('day');kind=event.get('kind')
        if not isinstance(identity,str) or not 1<=len(identity)<=200 or identity in seen or not valid_day(day,today):raise AccountError('invalid_progress')
        seen.add(identity)
        if kind=='task':
            task=event.get('task')
            if task not in tasks or identity!=day+':'+task:raise AccountError('invalid_progress')
            xp=tasks[task] if event.get('rewardVersion')==2 else 20 if task=='reading' else 10
        elif kind=='plan':
            plan=event.get('plan')
            if not isinstance(plan,dict) or not isinstance(plan.get('id'),str) or identity!='plan:'+plan['id'] or plan.get('size') not in sizes or not valid_day(plan.get('day'),today) or not isinstance(plan.get('title'),str) or not 1<=len(plan['title'])<=100:raise AccountError('invalid_progress')
            xp=sizes[plan['size']] if event.get('rewardVersion')==2 else {'small':5,'medium':15,'large':30}[plan['size']]
        elif kind=='workout':
            data=event.get('data')
            if not isinstance(data,dict) or data.get('day')!=day:raise AccountError('invalid_progress')
            sport=data.get('type')
            if sport in ('run','football','swim','other'):
                distance=data.get('distance');minutes=data.get('minutes')
                if distance is not None:number(distance,0.000001,5000 if sport=='other' else 100 if sport=='swim' else 500)
                if minutes is not None:number(minutes,0.000001,10080 if sport=='other' else 1440)
                if distance is None and minutes is None:raise AccountError('invalid_progress')
                if sport in ('football','swim') and minutes is None:raise AccountError('invalid_progress')
                if sport=='other' and not isinstance(data.get('source'),dict):raise AccountError('invalid_progress')
                xp=0 if sport=='other' else minutes if sport in ('football','swim') else distance*10 if distance is not None else minutes/2
            elif sport=='home':
                reps=data.get('reps')
                if data.get('exercise') not in ('pushups','pullups','squats') or not isinstance(reps,list) or not 1<=len(reps)<=30:raise AccountError('invalid_progress')
                xp=sum(number(r,1,1000,True) for r in reps)*(0.5 if data['exercise']=='pullups' else 0.1)
            elif sport=='gym':
                entries=data.get('exercises')
                if not isinstance(entries,list) or not 1<=len(entries)<=40:raise AccountError('invalid_progress')
                xp=0
                for entry in entries:
                    if not isinstance(entry,dict) or entry.get('group') not in ('back','chest','legs','shoulders','arms','full') or not isinstance(entry.get('exercise'),str) or not 1<=len(entry['exercise'])<=80:raise AccountError('invalid_progress')
                    weight=number(entry.get('weight'),0,1000);sets=number(entry.get('sets'),1,30,True);reps=number(entry.get('reps'),1,1000,True)
                    xp+=sets*2+weight*sets*reps/100
            else:raise AccountError('invalid_progress')
            if event.get('xpRule')!='volume-v1':xp={'run':50,'football':50,'home':40,'gym':60,'other':0,'swim':0}[sport]
        elif kind=='habit':
            habit=habit_record(event.get('habit'))
            if identity!=day+':habit:'+habit['id']:raise AccountError('invalid_progress')
            event['habit']=habit;xp=habit['xp']
        elif kind=='habit-bonus':
            required=event.get('required')
            if identity!=day+':habit-bonus' or not isinstance(required,list) or not 1<=len(required)<=100 or any(not isinstance(i,str) or not re.fullmatch(r'[A-Za-z0-9:_-]{1,100}',i) for i in required) or len(set(required))!=len(required):raise AccountError('invalid_progress')
            xp=20
        elif kind=='achievement':
            badge=badges.get(event.get('achievement'))
            if not badge or identity!='achievement:'+badge['id']:raise AccountError('invalid_progress')
            xp=badge['xp']
        else:raise AccountError('invalid_progress')
        event['xp']=rounded(xp);state['events'].append(event)
    old_tasks={(e['day'],e['task']) for e in state['events'] if e['kind']=='task'}
    state['events']=[e for e in state['events'] if e['kind']!='habit' or (e['day'],e['habit']['id']) not in old_tasks]
    done={}
    for event in state['events']:
        if event['kind'] in ('task','habit'):done.setdefault(event['day'],set()).add(event.get('task') or event['habit']['id'])
    legacy=legacy_bonus_days(state['events'])
    state['events']=[e for e in state['events'] if e['kind']!='habit-bonus' or (e['day'] not in legacy and all(i in done.get(e['day'],set()) for i in e['required']))]
    # Only actual completed records can justify an achievement.
    metrics=achievement_metrics(state)
    state['events']=[e for e in state['events'] if e['kind']!='achievement' or metrics[badges[e['achievement']]['metric']]+1e-9>=badges[e['achievement']]['target']]
    return state


def achievement_metrics(state):
    workouts=[e['data'] for e in state['events'] if e['kind']=='workout']
    tasks={}
    for e in state['events']:
        if e['kind']=='task':tasks.setdefault(e['day'],set()).add(e['task'])
    days=sorted({e['day'] for e in state['events'] if e['kind'] not in ('achievement','habit-bonus')})
    streak=longest=0;previous=None
    for day in days:
        streak=streak+1 if previous and (date.fromisoformat(day)-date.fromisoformat(previous)).days==1 else 1
        longest=max(longest,streak);previous=day
    result=dict(workouts=len(workouts),fullDays=len(legacy_bonus_days(state['events'])|{e['day'] for e in state['events'] if e['kind']=='habit-bonus'}),runTotal=0,runLongest=0,streak=longest,gymCount=0,pushupsTotal=0,pushupsBest=0,pullupsBest=0,bench=0,squat=0)
    aliases={'bench':{'жим лежа','жим штанги лежа','жим лежа со штангой','горизонтальный жим штанги','bench press','barbell bench press'},'squat':{'присед','приседания','присед со штангой','приседания со штангой','присед со штангой на спине','приседания со штангой на спине','barbell squat','back squat'}}
    for data in workouts:
        if data['type']=='run':
            result['runTotal']+=data.get('distance') or 0;result['runLongest']=max(result['runLongest'],data.get('distance') or 0)
        if data['type']=='home':
            if data['exercise']=='pushups':result['pushupsTotal']+=sum(data['reps']);result['pushupsBest']=max(result['pushupsBest'],*data['reps'])
            if data['exercise']=='pullups':result['pullupsBest']=max(result['pullupsBest'],*data['reps'])
        if data['type']=='gym':
            result['gymCount']+=1
            for entry in data['exercises']:
                name=re.sub(r'\s+',' ',re.sub(r'[.,:;!]','',entry['exercise'].lower().replace('ё','е'))).strip()
                for key,names in aliases.items():
                    if name in names:result[key]=max(result[key],entry['weight'])
    return result


def earned(state,start,end):
    events=[e for e in state['events'] if start<=e['day']<=end]
    return rounded(sum(e['xp'] for e in events)+20*len(legacy_bonus_days(events)))


def level_for(total):
    level=1
    while total>=100*((level+1)//2):total-=100*((level+1)//2);level+=1
    return level


class Accounts:
    def __init__(self,store,hash_password,check_password,token_digest):
        self.store,self.hash_password,self.check_password,self.digest=store,hash_password,check_password,token_digest
        with store.connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS friend_groups(id TEXT PRIMARY KEY,invite_digest TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS friend_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,group_id TEXT NOT NULL,profile TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,owner INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS friend_sessions(digest TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires REAL NOT NULL);
            ''')

    def user(self,token):
        with self.store.connect() as db:
            row=db.execute('SELECT a.* FROM friend_accounts a JOIN friend_sessions s ON a.id=s.user_id WHERE s.digest=? AND s.expires>?',(self.digest(token),time.time())).fetchone()
        if not row:raise AccountError('account_required',401)
        return row

    def snapshot(self,user):
        return dict(id=user['id'],username=user['username'],owner=bool(user['owner']),profile=json.loads(user['profile']),state=json.loads(user['state']),revision=user['revision'])

    def session(self,user_id):
        token=secrets.token_urlsafe(36)
        with self.store.connect() as db:
            db.execute('DELETE FROM friend_sessions WHERE expires<=?',(time.time(),))
            db.execute('INSERT INTO friend_sessions VALUES (?,?,?)',(self.digest(token),user_id,time.time()+30*86400))
        return token

    def register(self,body,owner=False):
        username=body.get('username','');password=body.get('password','')
        if not isinstance(username,str) or not re.fullmatch(r'[a-zA-Z0-9_]{3,32}',username) or not isinstance(password,str) or not 12<=len(password)<=200:raise AccountError('invalid_credentials')
        profile=profile_data(body.get('profile'));state=validate_state(body.get('state'),today_key());identity=secrets.token_urlsafe(18)
        record=self.hash_password(password);invite=secrets.token_urlsafe(24) if owner else body.get('invite','')
        if not isinstance(invite,str) or not 20<=len(invite)<=128:raise AccountError('invalid_invite')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if owner:
                if db.execute('SELECT 1 FROM friend_groups').fetchone():raise AccountError('group_exists',409)
                group_id=secrets.token_urlsafe(18);db.execute('INSERT INTO friend_groups VALUES (?,?)',(group_id,self.digest(invite)))
            else:
                group=db.execute('SELECT id FROM friend_groups WHERE invite_digest=?',(self.digest(invite),)).fetchone()
                if not group:raise AccountError('invalid_invite')
                group_id=group['id']
                if db.execute('SELECT count(*) FROM friend_accounts WHERE group_id=?',(group_id,)).fetchone()[0]>=200:raise AccountError('group_full')
            if db.execute('SELECT 1 FROM friend_accounts WHERE username=?',(username.lower(),)).fetchone():raise AccountError('username_taken',409)
            db.execute('INSERT INTO friend_accounts VALUES (?,?,?,?,?,?,?,?)',(identity,username.lower(),json.dumps(record),group_id,json.dumps(profile,ensure_ascii=False),json.dumps(state,ensure_ascii=False),1,int(owner)))
        token=self.session(identity);user=self.user(token)
        return dict(token=token,account=self.snapshot(user),**({'invite':invite} if owner else {}))

    def login(self,body):
        username=body.get('username','')
        with self.store.connect() as db:
            user=db.execute('SELECT * FROM friend_accounts WHERE username=?',(username.lower() if isinstance(username,str) else '',)).fetchone()
        valid=self.check_password(body.get('password'),json.loads(user['password']) if user else self.hash_password('dummy-login-password'))
        if not user or not valid:raise AccountError('bad_login',401)
        return dict(token=self.session(user['id']),account=self.snapshot(user))

    def sync(self,user,body):
        number(body.get('revision'),1,2**53-1,True)
        state=validate_state(body.get('state'),today_key());profile=profile_data(body.get('profile'))
        with self.store.connect() as db:
            result=db.execute('UPDATE friend_accounts SET profile=?,state=?,revision=revision+1 WHERE id=? AND revision=?',(json.dumps(profile,ensure_ascii=False),json.dumps(state,ensure_ascii=False),user['id'],body.get('revision')))
            if result.rowcount!=1:raise AccountError('sync_conflict',409)
            updated=db.execute('SELECT * FROM friend_accounts WHERE id=?',(user['id'],)).fetchone()
        return self.snapshot(updated)

    def invite(self,user):
        if not user['owner']:raise AccountError('owner_required',403)
        invite=secrets.token_urlsafe(24)
        with self.store.connect() as db:db.execute('UPDATE friend_groups SET invite_digest=? WHERE id=?',(self.digest(invite),user['group_id']))
        return dict(invite=invite)

    def leaderboard(self,user,period):
        today=date.fromisoformat(today_key());start=today-timedelta(days=today.weekday()) if period=='week' else today.replace(day=1)
        with self.store.connect() as db:users=db.execute('SELECT id,profile,state FROM friend_accounts WHERE group_id=?',(user['group_id'],)).fetchall()
        entries=[]
        for member in users:
            state=json.loads(member['state']);profile=json.loads(member['profile']);xp=earned(state,start.isoformat(),today.isoformat());total=state['base']+earned(state,'0001-01-01',today.isoformat())
            entries.append(dict(id=member['id'],name=profile['name'],xp=xp,level=level_for(total)))
        entries.sort(key=lambda e:(-e['xp'],e['name'].casefold(),e['id']))
        rank=0;previous=None
        for index,entry in enumerate(entries):
            if entry['xp']!=previous:rank=index+1
            entry['rank']=rank;previous=entry['xp']
        return dict(period=period,start=start.isoformat(),end=today.isoformat(),entries=entries)
