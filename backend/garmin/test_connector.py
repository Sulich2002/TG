import http.client
import json
import math
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from datetime import date, timedelta

from api import ORIGIN, check_password, make_server, password_record
from core import Store, heart_samples, normalize_activity, synchronize
from health import normalize_health, synchronize_health
from connector import OwnerMismatch, verify_owner


def activity(identity=123, **fields):
    return {"activityId": identity, "startTimeLocal": "2026-10-15 08:00:00", "activityName": "Утренняя пробежка", "activityType": {"typeKey": "running"}, "distance": 5000, "duration": 1800, "movingDuration": 1750, "elapsedDuration": 1900, "averageHR": 142, "maxHR": 170, **fields}


def details():
    return {"metricDescriptors": [{"key": "directTimestamp", "metricsIndex": 0}, {"key": "directHeartRate", "metricsIndex": 1}], "activityDetailMetrics": [{"metrics": [1792040400000 + i * 1000, 130 + i % 30]} for i in range(1000)]}


class ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / "private" / "data.sqlite3")

    def tearDown(self):
        self.temp.cleanup()

    def test_source_units_and_local_day_remain_explicit(self):
        result = normalize_activity(activity(), {}, details())
        self.assertEqual(result["distanceMeters"], 5000)
        self.assertEqual(result["durationSeconds"], 1800)
        self.assertEqual(result["movingDurationSeconds"], 1750)
        self.assertEqual(result["elapsedDurationSeconds"], 1900)
        self.assertEqual(result["day"], "2026-10-15")
        self.assertEqual(len(result["heartRateSamples"]), 300)
        self.assertEqual(result["heartRateSamples"][0]["timestamp"], 1792040400000)
        self.assertEqual(result["heartRateSamples"][-1]["timestamp"], 1792041399000)
        self.assertEqual(normalize_activity(activity(activityType={"typeKey": "cycling"}))["typeKey"], "cycling")

    def test_missing_or_invalid_metrics_never_create_heart_rates(self):
        result = normalize_activity(activity(averageHR=0, maxHR=float("inf"), distance=-1))
        self.assertIsNone(result["averageHeartRate"])
        self.assertIsNone(result["maximumHeartRate"])
        self.assertIsNone(result["distanceMeters"])
        self.assertEqual(result["heartRateSamples"], [])
        self.assertEqual(heart_samples({"metricDescriptors": [], "activityDetailMetrics": [{"metrics": [142]}]}), [])
        for value in [None, [], "bad"]:
            self.assertEqual(heart_samples(value), [])
        for bad in [activity(activityId="../../secret"), activity(startTimeLocal="2026-02-30"), activity(activityId=True)]:
            with self.assertRaises(ValueError):
                normalize_activity(bad)

    def test_polling_is_idempotent_and_refreshes_one_source_record(self):
        class Client:
            summary = activity()
            detail_calls = 0

            def get_activities(self, start, limit):
                return [self.summary]

            def get_activity(self, identity):
                return {"summaryDTO": {"averageHR": 141}}

            def get_activity_details(self, identity, maxchart, maxpoly):
                self.detail_calls += 1
                return details()

        client = Client()
        self.assertEqual(synchronize(client, self.store), {"added": 1, "changed": 0, "rejected": 0})
        self.assertEqual(synchronize(client, self.store)["added"], 0)
        self.assertEqual(client.detail_calls, 1)
        client.summary = activity(distance=5100)
        self.assertEqual(synchronize(client, self.store)["changed"], 1)
        self.assertEqual(self.store.count(), 1)
        self.assertEqual(self.store.activities()[0]["distanceMeters"], 5100)
        self.assertEqual(self.store.path.stat().st_mode & 0o777, 0o600)
        self.assertIsNotNone(self.store.get("lastSync"))
        class FixtureNotFoundError(Exception):
            pass
        def missing_details(*args, **kwargs):
            raise FixtureNotFoundError()
        client.summary = activity(124, activityType={"typeKey": "strength_training"})
        client.get_activity_details = missing_details
        self.assertEqual(synchronize(client, self.store)["added"], 1)
        self.assertEqual(self.store.count(), 2)

    def test_private_source_payload_is_not_part_of_app_export(self):
        self.store.upsert(activity(), {"privateRoute": "not for export"}, details())
        exported = self.store.activities()
        self.assertNotIn("privateRoute", json.dumps(exported))
        self.assertEqual(exported[0]["averageHeartRate"], 142)

    def test_sleep_stages_hrv_and_daily_metrics_preserve_missing_and_zero_values(self):
        raw = {"daily": {"totalSteps": 0, "averageStressLevel": 0, "restingHeartRate": 52, "bodyBatteryHighestValue": 85}, "heart": {"minHeartRate": 45, "maxHeartRate": 172}, "sleep": {"dailySleepDTO": {"sleepTimeSeconds": 25200, "deepSleepSeconds": 3600, "lightSleepSeconds": 18000, "remSleepSeconds": 3600, "awakeSleepSeconds": 0, "sleepScores": {"overall": {"value": 82}}}}, "hrv": {"hrvSummary": {"lastNightAvg": 54}}}
        result = normalize_health("2026-10-15", raw)
        self.assertEqual(result["steps"], 0)
        self.assertEqual(result["averageStress"], 0)
        self.assertEqual(result["sleepSeconds"], 25200)
        self.assertEqual(result["sleepStages"]["awake"], 0)
        self.assertEqual(result["sleepScore"], 82)
        self.assertEqual(result["hrvNightAverage"], 54)
        self.assertIsNone(result["bodyBattery"])
        self.assertEqual(result["bodyBatteryHighest"], 85)
        missing = normalize_health("2026-10-15", {"sleep": {"dailySleepDTO": {"sleepTimeSeconds": 0}}, "daily": {"averageStressLevel": -1, "restingHeartRate": 0}})
        self.assertIsNone(missing["sleepSeconds"])
        self.assertIsNone(missing["averageStress"])
        self.assertIsNone(missing["restingHeartRate"])
        self.assertIsNone(missing["sleepStages"]["deep"])

    def test_health_polling_is_15_minutes_upserts_days_and_keeps_previous_partial_data(self):
        class Client:
            calls = 0
            fail_sleep = False
            def get_stats(self, day):
                self.calls += 1
                return {"totalSteps": 1234}
            def get_heart_rates(self, day):
                return {"restingHeartRate": 54}
            def get_sleep_data(self, day):
                if self.fail_sleep:
                    raise RuntimeError("unavailable fixture")
                return {"dailySleepDTO": {"sleepTimeSeconds": 25200}}
            def get_hrv_data(self, day):
                return None
        client = Client()
        synchronize_health(client, self.store, "2026-10-15")
        self.assertEqual([row["day"] for row in self.store.health()], ["2026-10-15", "2026-10-14"])
        self.assertEqual(self.store.health()[0]["sleepSeconds"], 25200)
        self.assertEqual(self.store.get("healthSyncInterval"), 900)
        self.assertAlmostEqual(self.store.get("nextHealthSync") - time.time(), 900, delta=5)
        synchronize_health(client, self.store, "2026-10-15")
        self.assertEqual(client.calls, 2)
        self.store.set("nextHealthSync", time.time() - 1)
        synchronize_health(client, self.store, "2026-10-15")
        self.assertEqual(client.calls, 4)
        self.store.set("healthSyncInterval", 3600)
        self.store.set("nextHealthSync", time.time() + 3600)
        synchronize_health(client, self.store, "2026-10-15")
        self.assertEqual(client.calls, 6, "upgrade replaces the previous hourly schedule")
        client.fail_sleep = True
        synchronize_health(client, self.store, "2026-10-15", force=True)
        self.assertEqual(len(self.store.health()), 2)
        self.assertEqual(self.store.health()[0]["sleepSeconds"], 25200)
        self.assertIn("sleep", self.store.health()[0]["warnings"])

    def test_salted_password_hash_and_validation(self):
        password = "test-fixture-password-only"
        first, second = password_record(password), password_record(password)
        self.assertNotEqual(first, second)
        self.assertTrue(check_password(password, first))
        self.assertFalse(check_password("incorrect-test-password", first))
        self.assertNotIn(password, json.dumps(first))
        with self.assertRaises(ValueError):
            password_record("short")

    def test_owner_binding_rejects_different_resumed_account_before_import(self):
        first, other = SimpleNamespace(display_name="fixture-owner"), SimpleNamespace(display_name="another-fixture-owner")
        fingerprint = verify_owner(first, self.store, enrolling=True)
        self.store.set("owner", fingerprint)
        self.assertEqual(verify_owner(first, self.store), fingerprint)
        with self.assertRaises(OwnerMismatch):
            verify_owner(other, self.store)
        with self.assertRaises(OwnerMismatch):
            verify_owner(other, self.store, enrolling=True)

    def test_authenticated_http_origin_sessions_revocation_and_rate_limit(self):
        password = "test-fixture-password-only"
        self.store.set("appPassword", password_record(password))
        self.store.upsert(activity(), {}, details())
        for offset in range(31):
            day = (date(2026, 10, 15) - timedelta(days=offset)).isoformat()
            normalized = normalize_health(day, {"daily": {"totalSteps": 1000 + offset}})
            self.store.upsert_health(day, normalized, {"private": "fixture-private-raw"}, "2026-09-01")
        server = make_server(self.store, ("127.0.0.1", 0))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()

        def request(method, path, body=None, headers=None):
            connection = http.client.HTTPConnection(*server.server_address, timeout=5)
            data = json.dumps(body) if body is not None else None
            connection.request(method, path, data, {"Origin": ORIGIN, **({"Content-Type": "application/json"} if data else {}), **(headers or {})})
            response = connection.getresponse()
            result = response.status, dict(response.getheaders()), response.read()
            connection.close()
            return result

        try:
            self.assertEqual(request("GET", "/v1/activities")[0], 401)
            self.assertEqual(request("OPTIONS", "/v1/activities")[0], 204)
            self.assertEqual(request("POST", "/v1/login", {"password": password}, {"Origin": "https://untrusted.example"})[0], 403)
            status, headers, data = request("POST", "/v1/login", {"password": password})
            self.assertEqual(status, 200)
            token = json.loads(data)["token"]
            auth = {"Authorization": "Bearer " + token}
            status, headers, data = request("GET", "/v1/activities", headers=auth)
            self.assertEqual(status, 200)
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
            self.assertEqual(len(json.loads(data)["activities"]), 1)
            health = json.loads(data)["health"]
            self.assertEqual(len(health), 30)
            self.assertEqual(health[0]["day"], "2026-10-15")
            self.assertEqual(health[-1]["day"], "2026-09-16")
            self.assertNotIn(b"fixture-private-raw", data)
            self.assertEqual(request("GET", "/v1/activities?token=" + token)[0], 401)
            self.assertEqual(request("POST", "/v1/logout", headers=auth)[0], 200)
            self.assertEqual(request("GET", "/v1/activities", headers=auth)[0], 401)
            for _ in range(7):
                self.assertEqual(request("POST", "/v1/login", {"password": "wrong-fixture-password"})[0], 401)
            self.assertEqual(request("POST", "/v1/login", {"password": password})[0], 429)
            with self.store.connect() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM sessions").fetchone()[0], 0)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == "__main__":
    unittest.main()
