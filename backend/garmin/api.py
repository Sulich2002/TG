"""Authenticated loopback-only API; HTTPS is supplied by the separate tunnel."""
import hashlib
import hmac
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGIN = "https://sulich2002.github.io"


def password_record(password, salt=None):
    if len(password) < 12 or len(password) > 200:
        raise ValueError("Use a separate password of 12–200 characters")
    salt = salt or secrets.token_hex(24)
    return {"salt": salt, "digest": hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000).hex()}


def check_password(password, record):
    if not isinstance(password, str) or not 12 <= len(password) <= 200 or not record:
        return False
    actual = password_record(password, record["salt"])
    return hmac.compare_digest(actual["digest"], record["digest"])


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def make_server(store, address=("127.0.0.1", 8765), origin=ORIGIN, garmin_service=None):
    from accounts import Accounts, AccountError
    from user_garmin import UserGarmin
    accounts = Accounts(store, password_record, check_password, token_digest)
    watches = garmin_service or UserGarmin(store)
    attempts = []
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "DiaryGarmin"

        def log_message(self, *_):
            pass  # No URLs, credentials, tokens or account payloads in request logs.

        def respond(self, status, body):
            data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Vary", "Origin")
            if self.headers.get("Origin") == origin:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.end_headers()
            self.wfile.write(data)

        def allowed_origin(self):
            return self.headers.get("Origin") in (None, origin)

        def authenticated(self):
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer ") or not 20 <= len(auth[7:]) <= 128:
                return False
            with store.connect() as db:
                row = db.execute("SELECT expires FROM sessions WHERE digest=?", (token_digest(auth[7:]),)).fetchone()
            return bool(row and row[0] > time.time())

        def do_OPTIONS(self):
            if not self.allowed_origin():
                return self.respond(403, {"error": "origin"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def do_GET(self):
            if self.path == "/healthz":
                return self.respond(200, {"service": "diary-garmin", "version": 1})
            if not self.allowed_origin():
                return self.respond(403, {"error": "origin"})
            if self.path.startswith('/v2/'):
                return self.account_request('GET')
            if not self.authenticated():
                return self.respond(401, {"error": "unauthorized"})
            if self.path == "/v1/activities":
                return self.respond(200, {"activities": store.activities(), "health": store.health(), "lastSync": store.get("lastSync"), "syncError": store.get("syncError")})
            return self.respond(404, {"error": "not_found"})

        def do_POST(self):
            if not self.allowed_origin():
                return self.respond(403, {"error": "origin"})
            if self.path.startswith('/v2/'):
                return self.account_request('POST')
            if self.path == "/v1/logout":
                if not self.authenticated():
                    return self.respond(401, {"error": "unauthorized"})
                with store.connect() as db:
                    db.execute("DELETE FROM sessions WHERE digest=?", (token_digest(self.headers["Authorization"][7:]),))
                return self.respond(200, {"ok": True})
            if self.path != "/v1/login":
                return self.respond(404, {"error": "not_found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 2048 or self.headers.get_content_type() != "application/json":
                    return self.respond(400, {"error": "invalid_request"})
                with lock:
                    now = time.time()
                    attempts[:] = [t for t in attempts if now - t < 60]
                    if len(attempts) >= 8:
                        return self.respond(429, {"error": "rate_limited"})
                    attempts.append(now)
                body = json.loads(self.rfile.read(length))
                password = body.get("password") if isinstance(body, dict) else None
            except (ValueError, UnicodeError):
                return self.respond(400, {"error": "invalid_request"})
            if not check_password(password, store.get("appPassword")):
                return self.respond(401, {"error": "unauthorized"})
            token = secrets.token_urlsafe(36)
            with store.connect() as db:
                db.execute("DELETE FROM sessions WHERE expires<=?", (time.time(),))
                db.execute("INSERT INTO sessions VALUES (?,?)", (token_digest(token), time.time() + 30 * 86400))
            self.respond(200, {"token": token})

        def account_request(self, method):
            try:
                public = self.path in ('/v2/register', '/v2/login', '/v2/create-group') and method == 'POST'
                if public:
                    with lock:
                        now = time.time()
                        attempts[:] = [t for t in attempts if now - t < 60]
                        if len(attempts) >= 8:
                            raise AccountError('rate_limited', 429)
                        attempts.append(now)
                    if self.path == '/v2/create-group' and not self.authenticated():
                        raise AccountError('owner_required', 403)
                else:
                    auth = self.headers.get('Authorization', '')
                    if not auth.startswith('Bearer ') or not 20 <= len(auth[7:]) <= 128:
                        raise AccountError('account_required', 401)
                    user = accounts.user(auth[7:])
                if method == 'POST':
                    length = int(self.headers.get('Content-Length', '0'))
                    maximum = 2*1024*1024 if self.path in ('/v2/sync','/v2/register','/v2/create-group') else 4096
                    if not 0 < length <= maximum or self.headers.get_content_type() != 'application/json':
                        raise AccountError('invalid_request')
                    def invalid_constant(_):
                        raise ValueError('non-finite JSON')
                    body = json.loads(self.rfile.read(length), parse_constant=invalid_constant)
                    if not isinstance(body, dict):
                        raise AccountError('invalid_request')
                    if self.path == '/v2/garmin/connect':
                        return self.respond(200, watches.start(user, body.get('email'), body.get('password')))
                    if self.path == '/v2/garmin/mfa':
                        return self.respond(200, watches.mfa(user, body.get('job'), body.get('code')))
                    if self.path == '/v2/garmin/cancel':
                        return self.respond(200, watches.cancel(user, body.get('job')))
                    if self.path == '/v2/garmin/disconnect':
                        return self.respond(200, watches.disconnect(user))
                    if self.path in ('/v2/register', '/v2/create-group'):
                        return self.respond(200, accounts.register(body, owner=self.path == '/v2/create-group'))
                    if self.path == '/v2/login':
                        return self.respond(200, accounts.login(body))
                    if self.path == '/v2/sync':
                        return self.respond(200, {'account': accounts.sync(user, body)})
                    if self.path == '/v2/invite':
                        return self.respond(200, accounts.invite(user))
                    if self.path == '/v2/logout':
                        with store.connect() as db:
                            db.execute('DELETE FROM friend_sessions WHERE digest=?', (token_digest(auth[7:]),))
                        return self.respond(200, {'ok': True})
                elif self.path == '/v2/me':
                    return self.respond(200, {'account': accounts.snapshot(user), 'features':{'customHabits':True,'swimming':True}})
                elif self.path == '/v2/garmin/activities':
                    return self.respond(200, watches.data(user))
                elif self.path.startswith('/v2/garmin/jobs/'):
                    return self.respond(200, watches.get_job(user, self.path.rsplit('/',1)[1]).snapshot())
                elif self.path in ('/v2/leaderboard/week','/v2/leaderboard/month'):
                    return self.respond(200, accounts.leaderboard(user, self.path.rsplit('/',1)[1]))
                raise AccountError('not_found',404)
            except AccountError as error:
                return self.respond(error.status, {'error':error.code})
            except (ValueError, TypeError, UnicodeError):
                return self.respond(400, {'error':'invalid_request'})

    class Server(ThreadingHTTPServer):
        slots = threading.BoundedSemaphore(32)

        def process_request(self, connection, peer):
            if not self.slots.acquire(blocking=False):
                return self.shutdown_request(connection)
            try:
                super().process_request(connection, peer)
            except Exception:
                self.slots.release()
                raise

        def process_request_thread(self, connection, peer):
            try:
                super().process_request_thread(connection, peer)
            finally:
                self.slots.release()

        def get_request(self):
            connection, peer = super().get_request()
            connection.settimeout(15)
            return connection, peer

    server = Server(address, Handler)
    server.daemon_threads = True
    return server
