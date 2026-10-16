"""Per-account Garmin sessions and short-lived, private web login jobs."""
import fcntl
import hashlib
import logging
import re
import secrets
import shutil
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from zoneinfo import ZoneInfo
from core import Store, synchronize
from health import synchronize_health
from accounts import AccountError


def garmin_client(email=None,password=None,prompt_mfa=None):
    from garminconnect import Garmin
    logging.getLogger('garminconnect').setLevel(logging.CRITICAL)
    return Garmin(email,password,prompt_mfa=prompt_mfa,retry_attempts=1)


@contextmanager
def operation_lock(path):
    path.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (path/'operation.lock').open('a') as handle:
        (path/'operation.lock').chmod(0o600)
        try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise AccountError('garmin_busy',409) from None
        try:yield
        finally:fcntl.flock(handle,fcntl.LOCK_UN)


class LoginJob:
    def __init__(self,user,email,password):
        self.id=secrets.token_urlsafe(24);self.user=user;self.phase='authenticating';self.error=None
        self.credentials={'email':email,'password':password};self.code=None;self.event=threading.Event()
        self.cancelled=False;self.deadline=time.time()+240;self.mfa_attempts=0
    def snapshot(self):return {'job':self.id,'phase':self.phase,**({'error':self.error} if self.error else {})}
    def mfa(self):
        self.mfa_attempts+=1
        if self.mfa_attempts>3:raise AccountError('garmin_login_failed')
        self.code=None;self.event.clear();self.phase='mfa'
        if not self.event.wait(max(0,min(120,self.deadline-time.time()))) or self.cancelled:raise AccountError('garmin_login_expired')
        code=self.code;self.code=None;self.phase='authenticating'
        return code
    def check(self):
        if self.cancelled or time.time()>self.deadline:raise AccountError('garmin_login_expired')


class UserGarmin:
    def __init__(self,store,client_factory=garmin_client):
        self.root=store;self.path=store.path.parent;self.factory=client_factory;self.jobs={};self.guard=threading.Lock();self.attempts=[]
        with store.connect() as db:db.execute('CREATE TABLE IF NOT EXISTS garmin_bindings(user_id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,mode TEXT NOT NULL)')
    def user_path(self,user_id):
        if not isinstance(user_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',user_id):raise AccountError('account_required',401)
        return self.path/'users'/user_id
    def binding(self,user):
        with self.root.connect() as db:row=db.execute('SELECT * FROM garmin_bindings WHERE user_id=?',(user['id'],)).fetchone()
        if not row and user['owner'] and self.root.get('owner'):
            self.bind(user,self.root.get('owner'),'legacy')
            return {'user_id':user['id'],'fingerprint':self.root.get('owner'),'mode':'legacy'}
        return dict(row) if row else None
    def bind(self,user,fingerprint,mode):
        if not user['owner'] and self.root.get('owner')==fingerprint:raise AccountError('garmin_already_linked',409)
        with self.root.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT fingerprint FROM garmin_bindings WHERE user_id=?',(user['id'],)).fetchone()
            if old and old['fingerprint']!=fingerprint:raise AccountError('garmin_account_mismatch',409)
            other=db.execute('SELECT user_id FROM garmin_bindings WHERE fingerprint=?',(fingerprint,)).fetchone()
            if other and other['user_id']!=user['id']:raise AccountError('garmin_already_linked',409)
            db.execute('INSERT INTO garmin_bindings VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode',(user['id'],fingerprint,mode))
    def target(self,user):
        binding=self.binding(user)
        if binding and binding['mode']=='legacy':return self.root,self.path,binding
        path=self.user_path(user['id']);return Store(path/'diary.sqlite3'),path,binding
    def data(self,user):
        store,path,binding=self.target(user)
        connected=bool(binding and ((path/'session').is_dir() or store.get('watchConnected') is True))
        return {'connected':connected,'activities':store.activities() if connected else [],'health':store.health() if connected else [],'lastSync':store.get('lastSync') if connected else None,'syncError':store.get('syncError') if connected else None,'connectionId':binding['fingerprint'] if binding else None}
    def start(self,user,email,password):
        if not isinstance(email,str) or not 3<=len(email)<=254 or '@' not in email or not isinstance(password,str) or not 1<=len(password)<=200:raise AccountError('garmin_credentials')
        if time.time()<self.root.get('garminLoginRetry:'+user['id'],0):raise AccountError('garmin_rate_limited',429)
        with self.guard:
            now=time.time()
            for identity,job in list(self.jobs.items()):
                if now>job.deadline:
                    job.cancelled=True;job.event.set()
                    if job.phase not in ('connected','error'):job.phase='error';job.error='garmin_login_expired'
                    if now>job.deadline+300:del self.jobs[identity]
            if any(j.phase not in ('connected','error') for j in self.jobs.values()):raise AccountError('garmin_busy',409)
            self.attempts[:]=[(uid,t) for uid,t in self.attempts if now-t<600]
            if sum(uid==user['id'] for uid,t in self.attempts)>=3 or len(self.attempts)>=12:raise AccountError('garmin_rate_limited',429)
            self.attempts.append((user['id'],now));job=LoginJob(dict(user),email.strip(),password);self.jobs[job.id]=job
        threading.Thread(target=self.login,args=(job,),daemon=True).start()
        return job.snapshot()
    def get_job(self,user,identity):
        with self.guard:job=self.jobs.get(identity)
        if not job or job.user['id']!=user['id']:raise AccountError('garmin_job_missing',404)
        if time.time()>job.deadline and job.phase not in ('connected','error'):
            job.cancelled=True;job.event.set();job.phase='error';job.error='garmin_login_expired'
        return job
    def mfa(self,user,identity,code):
        job=self.get_job(user,identity)
        if job.phase!='mfa' or not isinstance(code,str) or not re.fullmatch(r'[0-9]{6,10}',code.strip()):raise AccountError('garmin_mfa_invalid')
        job.code=code.strip();job.phase='authenticating';job.event.set();return job.snapshot()
    def cancel(self,user,identity):
        job=self.get_job(user,identity);job.cancelled=True;job.credentials.clear();job.code=None;job.event.set()
        if job.phase!='connected':job.phase='error';job.error='garmin_login_cancelled'
        return {'ok':True}
    def login(self,job):
        staging=None;api=None
        try:
            store,path,binding=self.target(job.user)
            with operation_lock(path):
                job.check();credentials=job.credentials;api=self.factory(credentials.get('email'),credentials.get('password'),job.mfa);credentials.clear()
                staging=path/('login-'+job.id);staging.mkdir(mode=0o700)
                api.login(str(staging));job.check()
                if not any(staging.iterdir()):raise AccountError('garmin_login_failed')
                display=getattr(api,'display_name',None)
                if not display:raise AccountError('garmin_login_failed')
                fingerprint=hashlib.sha256(str(display).encode()).hexdigest()
                self.bind(job.user,fingerprint,'legacy' if binding and binding['mode']=='legacy' else 'native');job.check()
                # Bind first; a different Garmin must never overwrite existing tokens/data.
                session=path/'session';backup=path/('session-backup-'+job.id)
                if session.exists():session.rename(backup)
                try:staging.rename(session);staging=None
                except Exception:
                    if backup.exists():backup.rename(session)
                    raise
                shutil.rmtree(backup,ignore_errors=True)
                for child in session.rglob('*'):
                    if not child.is_symlink():child.chmod(0o700 if child.is_dir() else 0o600)
                # Further token refreshes must target the installed session directory.
                if hasattr(api,'client'):api.client._tokenstore_path=str(session)
                store.set('watchConnected',True);store.set('syncError',None);store.set('retryAfter',0)
                self.root.set('garminLoginRetry:'+job.user['id'],0)
                job.phase='syncing';self.sync_store(store,path,fingerprint,api=api,limit=5)
                job.phase='connected'
        except Exception as error:
            code=error.code if isinstance(error,AccountError) else 'garmin_rate_limited' if 'TooManyRequests' in type(error).__name__ else 'garmin_login_failed'
            if code=='garmin_rate_limited':self.root.set('garminLoginRetry:'+job.user['id'],time.time()+3600)
            job.error=code;job.phase='error'
        finally:
            if api is not None:api.password=None
            job.credentials.clear();job.code=None
            if staging:shutil.rmtree(staging,ignore_errors=True)
    def sync_store(self,store,path,fingerprint,api=None,limit=20):
        if api is None and (not (path/'session').is_dir() or store.get('syncError')=='login_required' or time.time()<store.get('retryAfter',0)):return
        try:
            api=api or self.factory()
            if not getattr(api,'display_name',None):api.login(str(path/'session'))
            if hashlib.sha256(str(api.display_name).encode()).hexdigest()!=fingerprint:raise AccountError('garmin_account_mismatch')
            synchronize(api,store,limit)
            synchronize_health(api,store,datetime.now(ZoneInfo('Europe/Moscow')).date().isoformat())
            store.set('syncError',None);store.set('retryAfter',0)
        except Exception as error:
            kind=type(error).__name__
            login='Authentication' in kind or 'Login' in kind or isinstance(error,AccountError)
            limited='TooManyRequests' in kind
            store.set('syncError','login_required' if login else 'rate_limited' if limited else 'unavailable');store.set('retryAfter',time.time()+(3600 if limited else 900))
    def sync_all(self,budget=170):
        with self.root.connect() as db:bindings=[dict(row) for row in db.execute("SELECT * FROM garmin_bindings WHERE mode='native' ORDER BY user_id")]
        if not bindings:return
        cursor=self.root.get('garminSyncCursor',0)%len(bindings);deadline=time.monotonic()+budget
        for offset in range(len(bindings)):
            if time.monotonic()>deadline:break
            item=bindings[(cursor+offset)%len(bindings)];path=self.user_path(item['user_id'])
            try:
                with operation_lock(path):self.sync_store(Store(path/'diary.sqlite3'),path,item['fingerprint'])
            except AccountError:pass
            self.root.set('garminSyncCursor',(cursor+offset+1)%len(bindings))
    def disconnect(self,user):
        with self.guard:
            for job in self.jobs.values():
                if job.user['id']==user['id'] and job.phase not in ('connected','error'):job.cancelled=True;job.event.set()
        store,path,binding=self.target(user)
        with operation_lock(path):
            shutil.rmtree(path/'session',ignore_errors=True);store.set('watchConnected',False);store.set('syncError','login_required')
            if binding and binding['mode']=='legacy':
                with store.connect() as db:db.execute('DELETE FROM sessions')
        return {'ok':True}
