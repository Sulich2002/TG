"""Daily Garmin measurements; missing values stay missing and grant no XP."""
from datetime import date, timedelta
import time
from core import numeric, utcnow


def mapping(value):
    return value if isinstance(value, dict) else {}


def for_day(value, day):
    value = mapping(value)
    return value if value.get("calendarDate", day) == day else {}


def normalize_health(day, raw, warnings=None):
    date.fromisoformat(day)
    daily, heart = for_day(raw.get("daily"), day), for_day(raw.get("heart"), day)
    sleep = for_day(mapping(raw.get("sleep")).get("dailySleepDTO"), day)
    hrv = for_day(mapping(raw.get("hrv")).get("hrvSummary"), day)
    sleep_seconds = numeric(sleep.get("sleepTimeSeconds"), 1, 86400)
    scores = mapping(sleep.get("sleepScores"))
    result = {
        "day": day, "updated": utcnow(), "warnings": warnings or [],
        "steps": numeric(daily.get("totalSteps"), 0, 200000),
        "restingHeartRate": numeric(daily.get("restingHeartRate"), 20, 260),
        "minimumHeartRate": numeric(heart.get("minHeartRate"), 20, 260),
        "maximumHeartRate": numeric(heart.get("maxHeartRate"), 20, 260),
        "averageStress": numeric(daily.get("averageStressLevel"), 0, 100),
        "bodyBattery": numeric(daily.get("bodyBatteryMostRecentValue"), 0, 100),
        "bodyBatteryHighest": numeric(daily.get("bodyBatteryHighestValue"), 0, 100),
        "hrvNightAverage": numeric(hrv.get("lastNightAvg"), 1, 500),
        "sleepSeconds": sleep_seconds,
        "sleepScore": numeric(mapping(scores.get("overall")).get("value"), 0, 100) if sleep_seconds else None,
        "sleepStages": {key: numeric(sleep.get(field), 0, 86400) if sleep_seconds else None for key, field in {"deep": "deepSleepSeconds", "light": "lightSleepSeconds", "rem": "remSleepSeconds", "awake": "awakeSleepSeconds"}.items()},
    }
    if result["restingHeartRate"] is None:
        result["restingHeartRate"] = numeric(heart.get("restingHeartRate"), 20, 260)
    return result


def synchronize_health(client, store, today, force=False):
    interval = 15 * 60
    if not force and store.get("healthSyncInterval") == interval and time.time() < store.get("nextHealthSync", 0):
        return
    current = date.fromisoformat(today)
    methods = {"daily": client.get_stats, "heart": client.get_heart_rates, "sleep": client.get_sleep_data, "hrv": client.get_hrv_data}
    for offset in (1, 0):
        day = (current - timedelta(days=offset)).isoformat()
        raw = store.health_original(day)
        warnings = []
        for key, method in methods.items():
            try:
                raw[key] = method(day)
            except Exception as error:
                kind = type(error).__name__
                if "Authentication" in kind or "TooManyRequests" in kind:
                    raise
                if "NotFound" in kind:
                    raw[key] = None  # Watch/feature has no record, not a guessed value.
                else:
                    warnings.append(key)  # Retain previous data if a section fails.
        normalized = normalize_health(day, raw, warnings)
        store.upsert_health(day, normalized, raw, (current - timedelta(days=30)).isoformat())
    store.set("healthSyncInterval", interval)
    store.set("nextHealthSync", time.time() + interval)
