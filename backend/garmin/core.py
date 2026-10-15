"""Personal Garmin store. No network calls, credentials or web dependencies here."""
import hashlib
import json
import math
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def numeric(value, low=0, high=1e10):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (ValueError, TypeError, OverflowError):
        return None
    return result if math.isfinite(result) and low <= result <= high else None


def heart_samples(details):
    if not isinstance(details, dict):
        return []
    descriptors = details.get("metricDescriptors", [])
    indices = {d.get("key"): d.get("metricsIndex") for d in descriptors if isinstance(d, dict)}
    hr_index, time_index = indices.get("directHeartRate"), indices.get("directTimestamp")
    if not all(isinstance(i, int) and not isinstance(i, bool) and i >= 0 for i in (hr_index, time_index)):
        return []
    result = []
    for row in details.get("activityDetailMetrics", []):
        values = row.get("metrics", []) if isinstance(row, dict) else []
        if not isinstance(values, list) or max(hr_index, time_index) >= len(values):
            continue
        bpm, timestamp = numeric(values[hr_index], 20, 260), numeric(values[time_index], 1, 1e15)
        if bpm is not None and timestamp is not None:
            result.append({"timestamp": timestamp, "bpm": round(bpm)})
    # Sort and deduplicate timestamp samples, preserving the true measured values.
    result = sorted({s["timestamp"]: s for s in result}.values(), key=lambda s: s["timestamp"])
    if len(result) > 300:
        result = [result[round(i * (len(result) - 1) / 299)] for i in range(300)]
    return result


def normalize_activity(summary, activity=None, details=None):
    identity = str(summary.get("activityId", ""))
    if not identity.isascii() or not identity.isdigit() or len(identity) > 30 or int(identity) <= 0:
        raise ValueError("invalid activity ID")
    stamp = summary.get("startTimeLocal")
    if not isinstance(stamp, str):
        raise ValueError("missing local start time")
    parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    day = date.fromisoformat(stamp[:10]).isoformat()
    activity = activity if isinstance(activity, dict) else {}
    detail_summary = activity.get("summaryDTO", {})
    if not isinstance(detail_summary, dict):
        detail_summary = {}
    data = {**detail_summary, **{k: v for k, v in summary.items() if v is not None}}
    kind = summary.get("activityType", {})
    kind = kind.get("typeKey", "unknown") if isinstance(kind, dict) else "unknown"
    return {
        "activityId": identity, "day": day, "startedLocal": parsed.isoformat(),
        "title": str(summary.get("activityName") or "Тренировка Garmin")[:160],
        "typeKey": str(kind)[:80],
        "distanceMeters": numeric(data.get("distance"), high=1e7),
        "durationSeconds": numeric(data.get("duration"), high=604800),
        "movingDurationSeconds": numeric(data.get("movingDuration"), high=604800),
        "elapsedDurationSeconds": numeric(data.get("elapsedDuration"), high=604800),
        "averageHeartRate": numeric(data.get("averageHR"), 20, 260),
        "maximumHeartRate": numeric(data.get("maxHR"), 20, 260),
        "heartRateSamples": heart_samples(details or {}),
    }


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS activities (
                  id TEXT PRIMARY KEY, summary_hash TEXT NOT NULL,
                  normalized TEXT NOT NULL, original TEXT NOT NULL, updated TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS health (
                  day TEXT PRIMARY KEY, normalized TEXT NOT NULL, original TEXT NOT NULL
                );
            """)
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, key, default=None):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set(self, key, value):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, json.dumps(value, allow_nan=False)))

    def existing_hash(self, identity):
        with self.connect() as db:
            row = db.execute("SELECT summary_hash FROM activities WHERE id=?", (identity,)).fetchone()
        return row[0] if row else None

    def upsert(self, summary, activity, details):
        normalized = normalize_activity(summary, activity, details)
        original = {"summary": summary, "activity": activity, "details": details}
        with self.connect() as db:
            db.execute("""INSERT INTO activities VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                          summary_hash=excluded.summary_hash,normalized=excluded.normalized,
                          original=excluded.original,updated=excluded.updated""",
                       (normalized["activityId"], summary_hash(summary), json.dumps(normalized, allow_nan=False),
                        json.dumps(original, allow_nan=False), utcnow()))
        return normalized

    def activities(self, limit=100):
        with self.connect() as db:
            rows = db.execute("SELECT normalized FROM activities ORDER BY json_extract(normalized,'$.startedLocal') DESC LIMIT ?", (limit,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def count(self):
        with self.connect() as db:
            return db.execute("SELECT count(*) FROM activities").fetchone()[0]

    def health(self, limit=7):
        with self.connect() as db:
            rows = db.execute("SELECT normalized FROM health ORDER BY day DESC LIMIT ?", (limit,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def health_original(self, day):
        with self.connect() as db:
            row = db.execute("SELECT original FROM health WHERE day=?", (day,)).fetchone()
        return json.loads(row[0]) if row else {}

    def upsert_health(self, day, normalized, original, cutoff):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO health VALUES (?,?,?)", (day, json.dumps(normalized, allow_nan=False), json.dumps(original, allow_nan=False)))
            db.execute("UPDATE health SET original='{}' WHERE day<?", (cutoff,))


def summary_hash(summary):
    return hashlib.sha256(json.dumps(summary, sort_keys=True, allow_nan=False).encode()).hexdigest()


def synchronize(client, store, limit=20):
    """Bounded polling; details are fetched only for new or changed summaries."""
    summaries = client.get_activities(0, limit)
    if not isinstance(summaries, list):
        raise ValueError("unexpected activity list")
    added = changed = rejected = 0
    for summary in summaries[:limit]:
        try:
            normalize_activity(summary)
        except (ValueError, TypeError, AttributeError):
            rejected += 1
            continue
        identity = str(summary["activityId"])
        previous = store.existing_hash(identity)
        if previous == summary_hash(summary):
            continue
        def optional(method):
            try:
                return method()
            except Exception as error:
                if "NotFound" in type(error).__name__:
                    return {}
                raise
        activity = optional(lambda: client.get_activity(identity))
        details = optional(lambda: client.get_activity_details(identity, maxchart=1000, maxpoly=0))
        store.upsert(summary, activity, details)
        if previous is None:
            added += 1
        else:
            changed += 1
    store.set("lastSync", utcnow())
    store.set("syncError", None)
    return {"added": added, "changed": changed, "rejected": rejected}
