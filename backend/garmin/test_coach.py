import http.client
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from accounts import Accounts, AccountError, validate_state
from api import make_server, password_record, check_password, token_digest
from coach import Coach, context_for, groq_request
from core import Store
import urllib.error

TODAY='2026-10-16'
KEY='gsk_fixture_0123456789'
PROFILE={'name':'Карим','sex':'male','age':28,'height':180,'weight':80}
EMPTY={'base':0,'events':[],'plans':[]}


def workout(identity,kind='run',day=TODAY,**fields):
    return {'id':identity,'day':day,'kind':'workout','xpRule':'volume-v1','data':{'type':kind,'day':day,**fields}}


class Watches:
    def __init__(self): self.rows={}
    def data(self,user): return self.rows.get(user['id'],{'activities':[],'health':[]})


class Transport:
    def __init__(self): self.calls=[];self.failure=None
    def __call__(self,path,key,payload=None):
        self.calls.append((path,key,payload))
        if self.failure: raise AccountError(self.failure,429)
        if path=='models': return {'data':[{'id':'unknown'},{'id':'llama-3.3-70b-versatile'}]}
        return {'choices':[{'message':{'content':getattr(self,'answer','По записям есть бег. Как ты сегодня себя чувствуешь?')}}]}


class CoachTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'diary.sqlite3')
        self.accounts=Accounts(self.store,password_record,check_password,token_digest)
        self.owner=self.accounts.register({'username':'owner','password':'fixture-account-password','profile':PROFILE,'state':EMPTY},owner=True)
        self.friend=self.accounts.register({'username':'anton','password':'fixture-account-password','profile':{**PROFILE,'name':'Антон'},'state':EMPTY,'invite':self.owner['invite']})
        self.user=self.accounts.user(self.owner['token']);self.other=self.accounts.user(self.friend['token'])
        self.watches=Watches();self.transport=Transport();self.coach=Coach(self.store,self.watches,self.transport)
        self.clock=patch('coach.today_key',return_value=TODAY);self.clock.start()
    def tearDown(self): self.clock.stop();self.temp.cleanup()
    def configure(self):
        self.coach.provider(self.user,{'key':KEY,'freePlan':True})
        self.coach.settings(self.user,{'goal':{'text':'Первый полумарафон','eventDay':'2027-04-10'},'consent':True})
    def message(self,**changes):
        return self.coach.message(self.user,{'id':'fixture-request-12345','text':'Что сегодня?','revision':self.coach.preferences(self.user)['revision'],**changes})

    def test_context_measured_groups_pulse_missingness_duplicates_and_selected_session(self):
        gym=workout('gym','gym',exercises=[{'group':'back','exercise':'Тяга','weight':40,'sets':3,'reps':10},{'group':'chest','exercise':'Жим','weight':30,'sets':4,'reps':8},{'group':'chest','exercise':'Гантели','weight':12,'sets':2,'reps':10}])
        run=workout('garmin:123',distance=5,minutes=30,source={'provider':'garmin','id':'123','averageHeartRate':147,'maximumHeartRate':176})
        diary=validate_state({**EMPTY,'events':[gym,run,workout('old',day='2026-10-01',distance=3,minutes=20)]},TODAY)
        watch={'activities':[{'activityId':'123','day':TODAY,'typeKey':'running','durationSeconds':1800,'distanceMeters':5000},
                              {'activityId':'321','day':TODAY,'typeKey':'strength_training','durationSeconds':2700}],
               'health':[{'day':TODAY,'sleepSeconds':25200,'restingHeartRate':52,'steps':0,'averageStress':0,'bodyBatteryHighest':60,'warnings':[]},
                         {'day':'2026-10-15','sleepSeconds':18000,'averageStress':80,'warnings':['daily']}]}
        context=context_for(self.user,diary,watch,{},'garmin:123',TODAY)
        self.assertEqual(context['week']['recordedSessions'],3)
        self.assertEqual(context['week']['muscleGroups']['chest']['sessions'],1)
        self.assertEqual(context['week']['muscleGroups']['chest']['sets'],6)
        self.assertEqual(context['week']['muscleGroups']['legs']['sessions'],0)
        self.assertEqual(context['week']['strengthSessionsWithoutKnownGroups'],1)
        self.assertEqual(context['selectedWorkout']['averageHeartRate'],147)
        self.assertEqual(context['health'][-1]['restingHeartRate'],52)
        self.assertEqual(context['health'][-1]['steps'],0);self.assertEqual(context['health'][-1]['stress'],0)
        self.assertIsNone(context['health'][0]['stress']);self.assertIsNone(context['health'][0]['hrvNightAverage'])
        self.assertTrue(context['health'][-1]['partialDay']);self.assertNotIn('garminId',context['selectedWorkout'])
        with self.assertRaises(AccountError):context_for(self.user,diary,watch,{},'somebody-elses-workout',TODAY)
        manual=validate_state({**EMPTY,'events':[workout('manual',distance=5,minutes=30)]},TODAY)
        duplicate=context_for(self.user,manual,{'activities':watch['activities'][:1]}, {},None,TODAY)
        self.assertEqual(duplicate['week']['recordedSessions'],1);self.assertEqual(duplicate['week']['possibleDuplicatesExcluded'],1)

    def test_provider_requires_owner_free_plan_and_never_exposes_key_or_sends_data_on_load(self):
        self.coach.snapshot(self.user);self.assertEqual(self.transport.calls,[])
        with self.assertRaises(AccountError):self.coach.provider(self.other,{'key':KEY,'freePlan':True})
        with self.assertRaises(AccountError):self.coach.provider(self.user,{'key':KEY,'freePlan':False})
        result=self.coach.provider(self.user,{'key':KEY,'freePlan':True})
        self.assertEqual([c[0] for c in self.transport.calls],['models'])
        self.assertNotIn(KEY,json.dumps(result));self.assertNotIn(KEY,json.dumps(self.coach.snapshot(self.other)))
        self.assertEqual(self.store.path.stat().st_mode&0o777,0o600)
        self.coach.provider(self.user,{'disable':True});self.assertFalse(self.coach.snapshot(self.other)['configured'])

    def test_consent_chat_memory_current_local_diary_and_idempotent_retry(self):
        self.configure();self.coach.settings(self.user,{'goal':{},'consent':False})
        with self.assertRaises(AccountError):self.message()
        self.assertEqual(len(self.transport.calls),1)
        self.coach.settings(self.user,{'goal':{'text':'Полумарафон'},'consent':True})
        self.transport.answer='Разбор с пояснением. '*90+'В конце — следующий шаг.'
        diary={**EMPTY,'events':[workout('recent-local',distance=5,minutes=29)]}
        first=self.message(state=diary,workoutId='recent-local');count=len(self.transport.calls)
        payload=self.transport.calls[-1][2];context=json.loads(payload['messages'][1]['content'].split('\n',1)[1])
        self.assertEqual(context['selectedWorkout']['minutes'],29);self.assertEqual(context['goal']['text'],'Полумарафон')
        self.assertNotIn(KEY,json.dumps(payload));self.assertNotIn('token',json.dumps(context));self.assertEqual(first['messages'][0]['question'],'Что сегодня?')
        retry=self.message(state=diary,workoutId='recent-local',revision=1)
        self.assertEqual(len(self.transport.calls),count);self.assertEqual(retry['messages'],first['messages'])
        with self.assertRaises(AccountError):self.message(text='Иное сообщение',state=diary,workoutId='recent-local')
        with self.store.connect() as db:db.execute('UPDATE coach_calls SET created=?',(time.time()-10,))
        second=self.message(id='fixture-followup-12345',text='А завтра?')
        roles=[m['role'] for m in self.transport.calls[-1][2]['messages']]
        self.assertEqual(roles,['system','user','user','assistant','user']);self.assertEqual(len(second['messages']),2)
        self.assertEqual(self.transport.calls[-1][2]['messages'][-2]['content'],self.transport.answer)
        self.assertEqual(self.coach.snapshot(self.other)['messages'],[])
        self.coach.clear(self.user);self.assertEqual(self.coach.snapshot(self.user)['messages'],[])
        self.assertEqual(self.coach.snapshot(self.user)['goal']['text'],'Полумарафон')

    def test_rate_limits_conflicts_empty_responses_and_unavailable_provider_do_not_fabricate_answers(self):
        self.configure()
        with self.assertRaises(AccountError) as error:self.message(revision=1)
        self.assertEqual(error.exception.code,'coach_conflict')
        self.transport.failure='coach_quota'
        with self.assertRaises(AccountError):self.message()
        self.assertEqual(self.coach.snapshot(self.user)['messages'],[])
        self.assertEqual(self.coach.snapshot(self.user)['limits']['remaining'],19)
        with self.store.connect() as db:db.execute('UPDATE coach_calls SET created=?',(time.time()-5,))
        with patch.object(self.coach,'transport',return_value={'choices':[]}):
            with self.assertRaises(AccountError) as empty:self.message(id='fixture-empty-answer-123')
        self.assertEqual(empty.exception.code,'coach_unavailable');self.assertEqual(self.coach.snapshot(self.user)['messages'],[])
        with self.store.connect() as db:
            db.executemany('INSERT INTO coach_calls VALUES (?,?,?)',[(self.user['id'],TODAY,time.time()-5)]*19)
        before=len(self.transport.calls)
        with self.assertRaises(AccountError) as error:self.message(id='fixture-newrequest-12345')
        self.assertEqual(error.exception.code,'coach_daily_limit');self.assertEqual(len(self.transport.calls),before)
        self.assertTrue(self.coach.gate.acquire(blocking=False))
        try:
            with self.assertRaises(AccountError):self.coach.clear(self.user)
        finally:self.coach.gate.release()

    def test_http_auth_isolation_origin_and_local_revision_failures(self):
        server=make_server(self.store,('127.0.0.1',0),garmin_service=self.watches,coach_transport=self.transport)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        def req(path,body=None,token=None,origin='https://sulich2002.github.io'):
            c=http.client.HTTPConnection(*server.server_address,timeout=5);headers={'Origin':origin}
            if token:headers['Authorization']='Bearer '+token
            if body is not None:headers['Content-Type']='application/json'
            c.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,headers)
            r=c.getresponse();result=r.status,json.loads(r.read());c.close();return result
        try:
            self.assertEqual(req('/v2/coach')[0],401)
            self.assertEqual(req('/v2/coach',token=self.owner['token'],origin='https://other.invalid')[0],403)
            self.assertEqual(req('/v2/coach/provider',{'key':KEY,'freePlan':True},self.friend['token'])[0],403)
            status,result=req('/v2/coach/provider',{'key':KEY,'freePlan':True},self.owner['token']);self.assertEqual(status,200);self.assertNotIn(KEY,json.dumps(result))
            _,settings=req('/v2/coach/settings',{'goal':{'text':'10 км'},'consent':True},self.owner['token'])
            body={'id':'fixture-http-message-123','text':'С чего начать?','revision':settings['revision']}
            self.assertEqual(req('/v2/coach/message',body,self.owner['token'])[0],200)
            self.assertEqual(len(req('/v2/coach',token=self.friend['token'])[1]['messages']),0)
            self.assertEqual(req('/v2/coach/clear',{},self.friend['token'])[0],200)
            self.assertEqual(len(req('/v2/coach',token=self.owner['token'])[1]['messages']),1)
        finally:server.shutdown();server.server_close();worker.join()

    def test_transport_uses_fixed_https_no_redirects_and_redacts_provider_errors(self):
        class Opener:
            def open(self,request,timeout):
                self.request=request
                raise urllib.error.HTTPError(request.full_url,401,'secret upstream '+KEY,{},None)
        opener=Opener()
        with patch('coach.urllib.request.build_opener',return_value=opener):
            with self.assertRaises(AccountError) as error:groq_request('models',KEY)
        self.assertEqual(error.exception.code,'coach_key_invalid');self.assertNotIn(KEY,str(error.exception))
        self.assertEqual(opener.request.full_url,'https://api.groq.com/openai/v1/models')
        from coach import NoRedirect
        self.assertIsNone(NoRedirect().redirect_request(None,None,302,'',{},'https://elsewhere.invalid'))


if __name__=='__main__': unittest.main()
