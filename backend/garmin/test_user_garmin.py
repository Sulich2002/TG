import hashlib
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from accounts import AccountError
from core import Store
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from user_garmin import UserGarmin, operation_lock


class FakeGarmin:
    def __init__(self,email=None,password=None,prompt_mfa=None):
        self.email=email;self.password=password;self.prompt=prompt_mfa;self.display_name=None
    def login(self,path):
        folder=Path(path)
        if self.email:
            if self.password!='fixture-watch-password':raise RuntimeError('private upstream body must never escape')
            if self.email.startswith('mfa') and self.prompt()!='123456':raise RuntimeError('bad code and private upstream body')
            self.display_name=self.email
            folder.mkdir(parents=True,exist_ok=True)
            (folder/'fixture.json').write_text(json.dumps({'fixture':self.display_name}))
        else:self.display_name=json.loads((folder/'fixture.json').read_text())['fixture']
    def get_activities(self,start,limit):
        return [{'activityId':123 if self.display_name.startswith('mfa') else 456,'startTimeLocal':'2026-10-16 10:00:00','activityName':'Fixture '+self.display_name,'activityType':{'typeKey':'running'},'distance':5000,'duration':1800}]
    def get_activity(self,identity):return {}
    def get_activity_details(self,*args,**kwargs):return {}
    def get_stats(self,day):return {'totalSteps':5000 if self.display_name.startswith('mfa') else 9000}
    def get_heart_rates(self,day):return {'restingHeartRate':52}
    def get_sleep_data(self,day):return {'dailySleepDTO':{'sleepTimeSeconds':25200}}
    def get_hrv_data(self,day):return None


class UserGarminTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'diary.sqlite3');self.service=UserGarmin(self.store,FakeGarmin)
        self.first={'id':'fixture-first','owner':0};self.second={'id':'fixture-second','owner':0}
    def tearDown(self):
        for job in self.service.jobs.values():job.cancelled=True;job.event.set()
        time.sleep(.03);self.temp.cleanup()
    def wait(self,user,identity,phase):
        deadline=time.time()+4
        while time.time()<deadline:
            value=self.service.get_job(user,identity).snapshot()
            if value['phase']==phase:return value
            if value['phase']=='error':self.fail(str(value))
            time.sleep(.01)
        self.fail('job did not reach '+phase)
    def connect(self,user,email):
        job=self.service.start(user,email,'fixture-watch-password');self.wait(user,job['job'],'connected');return job['job']
    def test_selected_context_requests_are_private_bounded_and_do_not_fetch_garmin_on_read(self):
        self.connect(self.first,'first@fixture.invalid')
        self.connect(self.second,'second@fixture.invalid')
        today=datetime.now(ZoneInfo('Europe/Moscow')).date();selected=(today-timedelta(days=16)).isoformat()
        self.service.request_context(self.first,selected,'456')
        first,_,_=self.service.target(self.first);second,_,_=self.service.target(self.second)
        self.assertEqual(set(first.get('healthRequestedDays')),{selected,(today-timedelta(days=15)).isoformat()})
        self.assertEqual(second.get('healthRequestedDays',[]),[]);self.assertEqual(self.store.get('healthRequestedDays',[]),[])
        before=first.get('healthRequestedDays');self.service.request_context(self.first,'1900-01-01','../../private')
        self.assertEqual(first.get('healthRequestedDays'),before)
        for offset in range(5,10):self.service.request_context(self.first,(today-timedelta(days=offset)).isoformat())
        self.assertLessEqual(len(first.get('healthRequestedDays')),4)

    def test_mfa_private_sessions_isolated_data_and_disconnect(self):
        first=self.service.start(self.first,'mfa-first@fixture.invalid','fixture-watch-password');self.wait(self.first,first['job'],'mfa')
        with self.assertRaises(AccountError):self.service.get_job(self.second,first['job'])
        with self.assertRaises(AccountError):self.service.mfa(self.second,first['job'],'123456')
        with self.assertRaises(AccountError):self.service.start(self.second,'second@fixture.invalid','fixture-watch-password')
        self.service.mfa(self.first,first['job'],'123456');self.wait(self.first,first['job'],'connected')
        self.connect(self.second,'second@fixture.invalid')
        data_a=self.service.data(self.first);data_b=self.service.data(self.second)
        self.assertEqual(data_a['activities'][0]['activityId'],'123');self.assertEqual(data_b['activities'][0]['activityId'],'456')
        self.assertEqual(data_a['health'][0]['steps'],5000);self.assertEqual(data_b['health'][0]['steps'],9000)
        self.assertEqual(self.store.count(),0)
        self.service.disconnect(self.first);self.assertFalse(self.service.data(self.first)['connected']);self.assertTrue(self.service.data(self.second)['connected'])
        self.assertFalse((self.service.user_path(self.first['id'])/'session').exists())
        self.assertNotIn('fixture-watch-password',repr(first))
    def test_existing_owner_is_used_only_for_owner_and_duplicate_garmin_is_rejected(self):
        identity=hashlib.sha256('original-owner'.encode()).hexdigest();self.store.set('owner',identity)
        (self.store.path.parent/'session').mkdir();owner={'id':'fixture-owner','owner':1}
        self.assertTrue(self.service.data(owner)['connected']);self.assertFalse(self.service.data(self.first)['connected'])
        self.assertEqual(self.service.binding(owner)['mode'],'legacy')
        with self.assertRaises(AccountError):self.service.bind(self.first,identity,'native')
        self.connect(self.first,'first@fixture.invalid')
        job=self.service.start(self.second,'first@fixture.invalid','fixture-watch-password')
        deadline=time.time()+4
        while time.time()<deadline and self.service.get_job(self.second,job['job']).phase!='error':time.sleep(.01)
        self.assertEqual(self.service.get_job(self.second,job['job']).error,'garmin_already_linked')
        self.assertFalse(self.service.data(self.second)['connected']);self.assertTrue(self.service.data(self.first)['connected'])
    def test_login_cancel_errors_and_worker_resume_without_storing_password(self):
        job=self.service.start(self.first,'mfa-first@fixture.invalid','fixture-watch-password');self.wait(self.first,job['job'],'mfa')
        self.service.cancel(self.first,job['job']);time.sleep(.05)
        self.assertFalse(self.service.data(self.first)['connected']);self.assertEqual(self.service.jobs[job['job']].credentials,{})
        self.connect(self.second,'second@fixture.invalid')
        private_store=Store(self.service.user_path(self.second['id'])/'diary.sqlite3')
        private_store.set('nextHealthSync',0);self.service.sync_all()
        self.assertEqual(private_store.count(),1)
        for path in Path(self.temp.name).rglob('*'):
            if path.is_file() and path.suffix!='.sqlite3':self.assertNotIn('fixture-watch-password',path.read_text())
    def test_file_lock_prevents_simultaneous_sync_and_disconnect(self):
        self.connect(self.first,'first@fixture.invalid');path=self.service.user_path(self.first['id'])
        with operation_lock(path):
            with self.assertRaises(AccountError):self.service.disconnect(self.first)
        self.assertTrue(self.service.data(self.first)['connected'])
        class GarminConnectTooManyRequestsError(Exception):pass
        class LimitedGarmin(FakeGarmin):
            def login(self,path):raise GarminConnectTooManyRequestsError('private fixture error')
        self.service.factory=LimitedGarmin
        job=self.service.start(self.second,'limited@fixture.invalid','fixture-watch-password')
        deadline=time.time()+3
        while time.time()<deadline and self.service.jobs[job['job']].phase!='error':time.sleep(.01)
        self.assertEqual(self.service.jobs[job['job']].error,'garmin_rate_limited')
        with self.assertRaises(AccountError):self.service.start(self.second,'limited@fixture.invalid','fixture-watch-password')

if __name__=='__main__':unittest.main()
