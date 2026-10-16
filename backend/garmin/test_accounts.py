import http.client
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
from accounts import validate_state, earned, AccountError
from api import make_server, token_digest
from core import Store
from user_garmin import UserGarmin
from test_user_garmin import FakeGarmin
import time

PROFILE={'name':'Антон','sex':'male','age':28,'height':180,'weight':80}
PASSWORD='fixture-account-password'
OWNER_TOKEN='fixture_owner_garmin_token_123456789'
TODAY='2026-10-15'

def state(events=None):return {'base':200,'events':events or [],'plans':[]}
def task(day,kind='warmup'):return {'id':day+':'+kind,'kind':'task','task':kind,'day':day,'xp':99999,'rewardVersion':2}

class AccountTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'diary.sqlite3')
  with self.store.connect() as db:db.execute('INSERT INTO sessions VALUES (?,?)',(token_digest(OWNER_TOKEN),9999999999))
  self.clock=patch('accounts.today_key',return_value=TODAY);self.clock.start()
  self.server=make_server(self.store,('127.0.0.1',0),garmin_service=UserGarmin(self.store,FakeGarmin));self.worker=threading.Thread(target=self.server.serve_forever,daemon=True);self.worker.start()
 def tearDown(self):
  self.server.shutdown();self.server.server_close();self.worker.join();self.clock.stop();self.temp.cleanup()
 def req(self,path,body=None,token=None):
  connection=http.client.HTTPConnection(*self.server.server_address,timeout=10)
  headers={'Origin':'https://sulich2002.github.io'}
  if token:headers['Authorization']='Bearer '+token
  if body is not None:headers['Content-Type']='application/json'
  connection.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,headers)
  response=connection.getresponse();result=(response.status,json.loads(response.read()));connection.close();return result
 def register(self,username='owner',invite=None,events=None):
  return self.req('/v2/register' if invite else '/v2/create-group',{'username':username,'password':PASSWORD,'profile':{**PROFILE,'name':username},'state':state(events),'invite':invite},None if invite else OWNER_TOKEN)
 def test_owner_invitation_two_users_privacy_and_calendar_ranking(self):
  status,owner=self.register(events=[task('2026-10-05'),task(TODAY)])
  self.assertEqual(status,200);self.assertNotIn(PASSWORD,json.dumps(owner))
  status,friend=self.register('anton',owner['invite'],[task(TODAY),task(TODAY,'reading')]);self.assertEqual(status,200)
  self.assertEqual(self.req('/v1/activities',token=friend['token'])[0],401)
  self.assertEqual(self.req('/v2/me',token=OWNER_TOKEN)[0],401)
  self.assertEqual(self.req('/v2/invite',{},friend['token'])[0],403)
  weekly=self.req('/v2/leaderboard/week',token=owner['token'])[1];monthly=self.req('/v2/leaderboard/month',token=owner['token'])[1]
  self.assertEqual(weekly['start'],'2026-10-12');self.assertEqual(monthly['start'],'2026-10-01')
  self.assertEqual([(e['name'],e['xp']) for e in weekly['entries']],[('anton',15),('owner',5)])
  self.assertEqual(monthly['entries'][1]['xp'],10)
  self.assertEqual(set(weekly['entries'][0]),{'id','name','xp','level','rank'})
  self.assertEqual(self.req('/v2/register',{'username':'nobody','password':PASSWORD,'profile':PROFILE,'state':state(),'invite':'invalid_invite_fixture_123456'})[0],400)
  self.assertEqual(self.req('/v2/leaderboard/week')[0],401)
 def test_login_sync_revision_conflict_logout_and_equal_ranks(self):
  _,owner=self.register();_,friend=self.register('anton',owner['invite'])
  status,login=self.req('/v2/login',{'username':'ANTON','password':PASSWORD});self.assertEqual(status,200);self.assertEqual(login['account']['id'],friend['account']['id'])
  payload={'revision':1,'profile':PROFILE,'state':state([task(TODAY)])}
  status,result=self.req('/v2/sync',payload,login['token']);self.assertEqual(status,200);self.assertEqual(result['account']['revision'],2)
  self.assertEqual(self.req('/v2/sync',payload,friend['token'])[0],409)
  self.assertEqual(self.req('/v2/me',token=friend['token'])[1]['account']['state']['events'][0]['xp'],5)
  self.req('/v2/sync',payload,owner['token'])
  board=self.req('/v2/leaderboard/week',token=owner['token'])[1];self.assertEqual([e['rank'] for e in board['entries']],[1,1])
  self.assertEqual(self.req('/v2/logout',{},login['token'])[0],200);self.assertEqual(self.req('/v2/me',token=login['token'])[0],401)
  self.assertEqual(self.req('/v2/me',token=friend['token'])[0],200)
 def test_unknown_login_dummy_password_and_bad_passwords_are_rejected(self):
  self.assertEqual(self.req('/v2/login',{'username':'absent','password':'dummy-login-password'})[0],401)
  self.assertEqual(self.req('/v2/create-group',{'username':'owner','password':PASSWORD,'profile':PROFILE,'state':state()})[0],403)
 def test_personal_watch_http_mfa_and_job_ownership(self):
  _,owner=self.register();_,friend=self.register('anton',owner['invite'])
  status,job=self.req('/v2/garmin/connect',{'email':'mfa-first@fixture.invalid','password':'fixture-watch-password'},friend['token']);self.assertEqual(status,200)
  path='/v2/garmin/jobs/'+job['job'];deadline=time.time()+3
  while time.time()<deadline and self.req(path,token=friend['token'])[1]['phase']!='mfa':time.sleep(.01)
  self.assertEqual(self.req(path,token=owner['token'])[0],404)
  self.assertEqual(self.req('/v2/garmin/mfa',{'job':job['job'],'code':'123456'},owner['token'])[0],404)
  self.assertEqual(self.req('/v2/garmin/mfa',{'job':job['job'],'code':'123456'},friend['token'])[0],200)
  deadline=time.time()+3
  while time.time()<deadline and self.req(path,token=friend['token'])[1]['phase']!='connected':time.sleep(.01)
  personal=self.req('/v2/garmin/activities',token=friend['token'])[1]
  self.assertTrue(personal['connected']);self.assertEqual(personal['activities'][0]['activityId'],'123')
  self.assertFalse(self.req('/v2/garmin/activities',token=owner['token'])[1]['connected'])
  self.assertEqual(self.req('/v2/garmin/disconnect',{},friend['token'])[0],200)
  self.assertFalse(self.req('/v2/garmin/activities',token=friend['token'])[1]['connected'])
 def test_server_scores_volume_bonus_and_earned_achievements_without_trusting_xp(self):
  events=[task(TODAY,k) for k in ('warmup','shower','breakfast','reading')]
  events += [{'id':'run','kind':'workout','day':TODAY,'data':{'type':'run','day':TODAY,'distance':5,'minutes':30},'xp':99999,'xpRule':'volume-v1'}, {'id':'achievement:first-workout','kind':'achievement','day':TODAY,'achievement':'first-workout','xp':99999}, {'id':'achievement:run-marathon','kind':'achievement','day':TODAY,'achievement':'run-marathon','xp':99999}]
  normalized=validate_state(state(events),TODAY);self.assertEqual(earned(normalized,TODAY,TODAY),110)
  self.assertEqual(len(normalized['events']),6)
  with self.assertRaises(AccountError):validate_state(state([task('2026-10-16')]),TODAY)
  with self.assertRaises(AccountError):validate_state(state([task(TODAY),task(TODAY)]),TODAY)

 def test_custom_habits_and_swimming_sync_preserve_history_and_score_ranking(self):
  _,owner=self.register()
  custom={'id':'custom:walk','title':'Погулять','xp':5}
  events=[{'id':TODAY+':habit:custom:walk','kind':'habit','day':TODAY,'habit':custom,'xp':999},
          {'id':TODAY+':habit-bonus','kind':'habit-bonus','day':TODAY,'required':['custom:walk'],'xp':999},
          {'id':'swim','kind':'workout','day':TODAY,'data':{'type':'swim','day':TODAY,'distance':1.2,'minutes':30},'xpRule':'volume-v1','xp':999}]
  diary={**state(events),'habits':[{**custom,'archived':True,'updatedAt':123}]}
  status,result=self.req('/v2/sync',{'revision':1,'profile':PROFILE,'state':diary},owner['token'])
  self.assertEqual(status,200);saved=result['account']['state']
  self.assertEqual(saved['habits'],diary['habits']);self.assertEqual([e['xp'] for e in saved['events']],[5,20,30])
  fetched=self.req('/v2/me',token=owner['token'])[1]
  self.assertTrue(fetched['features']['customHabits']);self.assertTrue(fetched['features']['swimming'])
  self.assertEqual(fetched['account']['state'],saved)
  self.assertEqual(self.req('/v2/leaderboard/week',token=owner['token'])[1]['entries'][0]['xp'],55)
  # Archived definitions retain earned XP; an unfinished snapshot cannot earn a bonus.
  fake={**events[1],'required':['custom:missing']}
  self.assertEqual(earned(validate_state(state([events[0],fake]),TODAY),TODAY,TODAY),5)
  # Old and new devices completing the same default habit never double its reward or set bonus.
  old=[task(TODAY,k) for k in ('warmup','shower','breakfast','reading')]
  modern=[{'id':TODAY+':habit:'+e['task'],'day':TODAY,'kind':'habit','habit':{'id':e['task']}} for e in old]
  bonus={**events[1],'required':[e['task'] for e in old]}
  self.assertEqual(earned(validate_state(state(old+modern+[bonus]),TODAY),TODAY,TODAY),45)

if __name__=='__main__':unittest.main()
