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


def make_server(store, address=("127.0.0.1", 8765), origin=ORIGIN):
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
            if not self.authenticated():
                return self.respond(401, {"error": "unauthorized"})
            if self.path == "/v1/activities":
                return self.respond(200, {"activities": store.activities(), "health": store.health(), "lastSync": store.get("lastSync"), "syncError": store.get("syncError")})
            return self.respond(404, {"error": "not_found"})

        def do_POST(self):
            if not self.allowed_origin():
                return self.respond(403, {"error": "origin"})
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
