#!/usr/bin/env python3
"""Run on the owner's server; Garmin credentials never enter the website."""
import argparse
import getpass
import hashlib
import json
import logging
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import time
import warnings
from datetime import datetime
from zoneinfo import ZoneInfo

from api import make_server, password_record
from core import Store, synchronize
from health import synchronize_health

STATE = Path(os.environ.get("TG_GARMIN_STATE", "/var/lib/tg-garmin"))
TOKENSTORE = STATE / "session"


class OwnerMismatch(Exception):
    pass


class SetupInputError(Exception):
    pass


def verify_owner(api, store, enrolling=False):
    identity = getattr(api, "display_name", None)
    if not identity:
        raise OwnerMismatch("Garmin did not confirm the account")
    fingerprint = hashlib.sha256(str(identity).encode()).hexdigest()
    owner = store.get("owner")
    if owner != fingerprint and not (enrolling and owner is None):
        raise OwnerMismatch("Different Garmin account")
    return fingerprint


def secret(prompt):
    # Refuse an echoing fallback instead of exposing a password in a console log.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        return getpass.getpass(prompt)


def client(resume=True):
    from garminconnect import Garmin
    logging.getLogger("garminconnect").setLevel(logging.CRITICAL)
    if resume:
        api = Garmin(retry_attempts=1)
    else:
        email = input("Email Garmin: ").strip()
        password = secret("Пароль Garmin (символы скрыты): ")
        api = Garmin(email, password, prompt_mfa=lambda: secret("Код подтверждения Garmin: "), retry_attempts=1)
    api.login(str(TOKENSTORE))
    return api


def restrict_state():
    """Drop ownership of newly enrolled files to the dedicated service user."""
    if os.geteuid() != 0:
        return
    owner = pwd.getpwnam("tg-garmin")
    for path in [STATE, *STATE.rglob("*")]:
        if path.is_symlink():
            continue
        os.chown(path, owner.pw_uid, owner.pw_gid, follow_symlinks=False)
        path.chmod(0o700 if path.is_dir() else 0o600)


def sync(store, limit=20, api=None):
    if api is None and (store.get("syncError") == "login_required" or time.time() < store.get("retryAfter", 0)):
        print("Синхронизация ожидает повторного входа или следующей попытки.")
        return
    try:
        api = api or client()
        verify_owner(api, store)
        result = synchronize(api, store, limit)
        synchronize_health(api, store, datetime.now(ZoneInfo("Europe/Moscow")).date().isoformat())
        store.set("retryAfter", 0)
        print(f"Garmin: новых {result['added']}, обновлено {result['changed']}, пропущено {result['rejected']}.")
    except Exception as error:
        kind = type(error).__name__
        if "Authentication" in kind or "Login" in kind or isinstance(error, (FileNotFoundError, OwnerMismatch)):
            store.set("syncError", "login_required")
        elif "TooManyRequests" in kind:
            store.set("syncError", "rate_limited")
            store.set("retryAfter", time.time() + 3600)
        else:
            store.set("syncError", "unavailable")
            store.set("retryAfter", time.time() + 900)
        raise RuntimeError("Garmin пока недоступен. Подробности аккаунта и секреты в журнал не записываются.") from None


def connect(store):
    if os.geteuid() != 0:
        raise RuntimeError("Запусти tg-garmin connect в терминале администратора сервера.")
    print("Вход напрямую в Garmin. Пароль вводится только здесь и не сохраняется.")
    try:
        api = client(resume=False)
        fingerprint = verify_owner(api, store, enrolling=True)
        store.set("owner", fingerprint)
        print("Придумай отдельный пароль для подключения приложения: минимум 12 символов.")
        password = secret("Пароль подключения приложения: ")
        if password != secret("Повтори пароль подключения: "):
            raise SetupInputError("Пароли подключения не совпали. Повтори: tg-garmin connect")
        if not 12 <= len(password) <= 200:
            raise SetupInputError("Для приложения нужен отдельный пароль длиной от 12 до 200 символов. Повтори: tg-garmin connect")
        record = password_record(password)
        sync(store, limit=5, api=api)
        store.set("appPassword", record)
        with store.connect() as db:
            db.execute("DELETE FROM sessions")
    finally:
        restrict_state()
    subprocess.run(["systemctl", "enable", "--now", "tg-garmin-api.service", "tg-garmin-sync.timer", "tg-garmin-tunnel.service"], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["systemctl", "restart", "tg-garmin-api.service"], check=True)
    print("Вход выполнен. Загрузились последние 5 доступных занятий; опрос Garmin — каждые 15 минут.")
    print("Следующая команда: tg-garmin status")


def tunnel():
    # Quick Tunnel is an HTTPS transport, never an SSH tunnel or a VPN client.
    command = ["/opt/tg-garmin/cloudflared", "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", "http://127.0.0.1:8765", "--metrics", "127.0.0.1:0"]
    (STATE / "public-url").unlink(missing_ok=True)
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env={**os.environ, "HOME": "/var/empty/tg-garmin"})
    try:
        for line in process.stdout:
            match = re.search(r"https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b", line)
            if match:
                path = STATE / "public-url"
                path.write_text(match.group(0) + "\n")
                path.chmod(0o600)
                print("HTTPS-адрес готов. Его можно посмотреть командой tg-garmin status.", flush=True)
            # Upstream output is deliberately kept out of the journal.
        return process.wait()
    finally:
        if process.poll() is None:
            process.terminate()
        (STATE / "public-url").unlink(missing_ok=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["connect", "sync", "serve", "tunnel", "status", "disconnect"])
    args = parser.parse_args()
    if args.command == "tunnel":
        return tunnel()
    store = Store(STATE / "diary.sqlite3")
    if args.command == "connect":
        connect(store)
    elif args.command == "sync":
        sync(store)
    elif args.command == "serve":
        make_server(store).serve_forever()
    elif args.command == "disconnect":
        if os.geteuid() != 0:
            raise RuntimeError("Нужен администратор сервера.")
        subprocess.run(["systemctl", "disable", "--now", "tg-garmin-sync.timer"], check=True)
        shutil.rmtree(TOKENSTORE, ignore_errors=True)
        with store.connect() as db:
            db.execute("DELETE FROM sessions")
        store.set("syncError", "login_required")
        restrict_state()
        print("Локальная сессия Garmin удалена, автоматический опрос остановлен.")
    else:
        public_url = STATE / "public-url"
        print("Занятий на сервере:", store.count())
        print("Последняя синхронизация (UTC):", store.get("lastSync") or "ещё не выполнялась")
        print("Состояние:", store.get("syncError") or "готово" if store.get("lastSync") else "нужен вход")
        print("Адрес для приложения:", public_url.read_text().strip() if public_url.exists() else "ещё не готов; повтори status через минуту")
        print("Пароли и ключи эта команда не выводит.")


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except KeyboardInterrupt:
        print("\nОстановлено.", file=sys.stderr)
        sys.exit(1)
    except SetupInputError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except OwnerMismatch:
        print("Сервис привязан к другому аккаунту Garmin. Войди в первоначальный аккаунт; записи не смешивались.", file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # Some upstream exceptions embed responses or login values. Never print them.
        kind = type(error).__name__
        if "Authentication" in kind:
            print("Garmin не принял вход. Проверь email, пароль и код подтверждения. Повтори: tg-garmin connect", file=sys.stderr)
        elif "TooManyRequests" in kind:
            print("Garmin ограничил попытки входа. Подожди час перед повторной попыткой.", file=sys.stderr)
        else:
            print("Операция не завершена. Проверь ввод и подключение; для нового входа: tg-garmin connect. Пароли в чат не присылай.", file=sys.stderr)
        sys.exit(1)
