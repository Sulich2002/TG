"""Personal Garmin store. No network calls, credentials or web dependencies here."""
import hashlib
import json
import math
import sqlite3
import time
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


ACTIVITY_METRICS_VERSION = 2


def normalize_zones(raw):
    """Keep Garmin's activity-specific zone bounds; never infer personal zones."""
    if isinstance(raw, dict):
        raw = raw.get('hrTimeInZones', raw.get('heartRateZones', raw.get('zones')))
    if not isinstance(raw, list): return []
    zones = {}
    for item in raw[:20]:
        if not isinstance(item, dict): continue
        number = numeric(item.get('zoneNumber'), 1, 5)
        seconds = numeric(item.get('secsInZone'), 0, 604800)
        if number is None or number != int(number) or seconds is None: continue
        zones[int(number)] = {'zone': int(number), 'seconds': seconds,
            'lowerBpm': numeric(item.get('zoneLowBoundary'), 20, 260),
            'upperBpm': numeric(item.get('zoneHighBoundary'), 20, 260)}
    return [zones[key] for key in sorted(zones)]


def normalize_activity(summary, activity=None, details=None, zones=None):
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
    def metric(*keys, low=0, high=1e10):
        for source in (summary, detail_summary, activity):
            for key in keys:
                value = numeric(source.get(key), low, high)
                if value is not None: return value
        return None
    kind = summary.get("activityType", {})
    kind = kind.get("typeKey", "unknown") if isinstance(kind, dict) else "unknown"
    return {
        "activityId": identity, "day": day, "startedLocal": parsed.isoformat(),
        "title": str(summary.get("activityName") or "Тренировка Garmin")[:160],
        "typeKey": str(kind)[:80],
        "distanceMeters": metric("distance", high=1e7),
        "durationSeconds": metric("duration", high=604800),
        "movingDurationSeconds": metric("movingDuration", high=604800),
        "elapsedDurationSeconds": metric("elapsedDuration", high=604800),
        "averageHeartRate": metric("averageHR", "averageHeartRate", low=20, high=260),
        "maximumHeartRate": metric("maxHR", "maxHeartRate", "maximumHeartRate", low=20, high=260),
        "heartRateSamples": heart_samples(details or {}),
        "heartRateZones": normalize_zones(zones),
        "averageSpeedMps": metric('averageSpeed', high=100),
        "maximumSpeedMps": metric('maxSpeed', 'maximumSpeed', high=100),
        "averageCadence": metric('averageRunningCadenceInStepsPerMinute', high=400),
        "calories": metric('calories', high=100000),
        "elevationGainMeters": metric('elevationGain', 'totalAscent', high=100000),
        "elevationLossMeters": metric('elevationLoss', 'totalDescent', high=100000),
        "aerobicTrainingEffect": metric('aerobicTrainingEffect', 'trainingEffect', high=5),
        "anaerobicTrainingEffect": metric('anaerobicTrainingEffect', high=5),
        "metricsVersion": ACTIVITY_METRICS_VERSION,
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

    def activity_record(self, identity):
        with self.connect() as db:
            row = db.execute('SELECT normalized,original FROM activities WHERE id=?', (identity,)).fetchone()
        return (json.loads(row[0]), json.loads(row[1])) if row else (None, {})

    def upsert(self, summary, activity, details, zones=None, warnings=None):
        normalized = normalize_activity(summary, activity, details, zones)
        normalized['metricWarnings'] = warnings or []
        original = {"summary": summary, "activity": activity, "details": details, "zones": zones,
                    "retryMetricsAfter": time.time()+3600 if warnings else 0}
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

    def health(self, limit=30):
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
    """Poll summaries and repair up to two cached records per run, without new XP."""
    summaries = client.get_activities(0, limit)
    if not isinstance(summaries, list):
        raise ValueError("unexpected activity list")
    requested = store.get('activityDetailRequests', [])
    queued = []
    for identity in requested[:4]:
        _, old = store.activity_record(identity)
        if isinstance(old.get('summary'), dict): queued.append(old['summary'])
    added = changed = rejected = repaired = 0
    seen = set()
    for summary in queued+summaries[:limit]:
        try:
            normalize_activity(summary)
        except (ValueError, TypeError, AttributeError):
            rejected += 1
            continue
        identity = str(summary["activityId"])
        if identity in seen: continue
        seen.add(identity)
        previous = store.existing_hash(identity)
        cached, original = store.activity_record(identity)
        same = previous == summary_hash(summary)
        needs_repair = bool(cached and (cached.get('metricsVersion', 0)<ACTIVITY_METRICS_VERSION or
            cached.get('metricWarnings') and time.time()>=original.get('retryMetricsAfter', 0) or identity in requested))
        if same and (not needs_repair or repaired>=2): continue
        if same: repaired += 1
        warnings = []
        def optional(key, method):
            try: return method()
            except Exception as error:
                kind = type(error).__name__
                if 'Authentication' in kind or 'Login' in kind or 'TooManyRequests' in kind: raise
                warnings.append(key)
                return original.get(key) or {}
        activity = optional('activity', lambda: client.get_activity(identity))
        details = optional('details', lambda: client.get_activity_details(identity, maxchart=1000, maxpoly=0))
        zones = optional('zones', lambda: client.get_activity_hr_in_timezones(identity))
        store.upsert(summary, activity, details, zones, warnings)
        if identity in requested: requested.remove(identity)
        if previous is None: added += 1
        else: changed += 1
    store.set('activityDetailRequests', requested)
    store.set("lastSync", utcnow())
    store.set("syncError", None)
    return {"added": added, "changed": changed, "rejected": rejected}
