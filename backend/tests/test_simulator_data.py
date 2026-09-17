import json
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.services import simulator_data


def make_bar(timestamp: int, close: str = "101.25") -> dict:
    return {"t": timestamp * 1000, "o": "100.00", "h": close, "l": "99.50", "c": close, "v": "12.500"}


class FakeResponse:
    def __init__(self, status_code: int, payload: dict, headers: dict | None = None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class TestSimulatorData(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.dataset_root = Path(self.tempdir.name) / "datasets"
        self.root_patch = patch.object(simulator_data, "DATASET_ROOT", self.dataset_root)
        self.root_patch.start()

    def tearDown(self):
        self.root_patch.stop()
        self.tempdir.cleanup()

    async def test_synthetic_dataset_is_reproducible_and_explicitly_test_only(self):
        first = await simulator_data.load_dataset("TEST", "synthetic-test", history_days=7)
        second = await simulator_data.load_dataset("TEST", "synthetic-test", history_days=7)
        self.assertEqual(first, second)
        self.assertEqual(first["source"], "synthetic-test")
        self.assertEqual(first["precision"], "1m")
        self.assertGreater(len(first["bars"]), 100)
        self.assertTrue(all(isinstance(bar["time"], int) for bar in first["bars"]))
        self.assertTrue(all(isinstance(bar["open"], str) for bar in first["bars"]))
        self.assertTrue(first["coverage"]["test_only"])
        self.assertEqual(simulator_data.get_dataset(first["id"]), first)

    async def test_polygon_fetches_pages_deduplicates_and_stores_content_addressed_dataset(self):
        now = 1_700_000_040
        first_page = [make_bar(now - 6900 + i * 60) for i in range(100)]
        second_page = [make_bar(now - 7200), make_bar(now - 960), make_bar(now - 960)]
        client = FakeClient([
            FakeResponse(200, {"results": first_page, "next_url": "https://api.polygon.io/v2/aggs/ticker/TEST/range/1/minute/2023-11-07/2023-11-14?cursor=page2"}),
            FakeResponse(200, {"results": second_page}),
        ])
        with patch.object(simulator_data, "utc_now_seconds", return_value=now), patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            dataset = await simulator_data.load_dataset("TEST", "polygon", history_days=7)
        self.assertEqual(len(dataset["bars"]), 101)
        self.assertEqual(dataset["bars"], sorted(dataset["bars"], key=lambda bar: bar["time"]))
        self.assertEqual(len({bar["time"] for bar in dataset["bars"]}), len(dataset["bars"]))
        self.assertTrue(dataset["id"].startswith("dataset_"))
        stored = next(self.dataset_root.rglob("*.json"))
        self.assertEqual(json.loads(stored.read_text()), dataset)
        self.assertTrue(client.calls[1][0].startswith("https://api.polygon.io/v2/aggs/ticker/TEST/range/1/minute/"))
        self.assertIn("apiKey", client.calls[0][1]["params"])
        self.assertIn("apiKey", client.calls[1][1]["params"])

    async def test_polygon_errors_are_typed_safe_and_have_no_synthetic_fallback(self):
        for status, code in ((403, "POLYGON_FORBIDDEN"), (429, "POLYGON_RATE_LIMIT")):
            client = FakeClient([FakeResponse(status, {"error": "secret details"}, {"retry-after": "9"})])
            with patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
                with self.assertRaises(simulator_data.DatasetError) as raised:
                    await simulator_data.load_dataset("TEST", "polygon", history_days=7)
            self.assertEqual(raised.exception.code, code)
            self.assertNotIn("apiKey", str(raised.exception))
            self.assertNotIn("https://", str(raised.exception))
            self.assertFalse(list(self.dataset_root.rglob("*.json")))

    async def test_polygon_rejects_invalid_ohlc_and_hostile_next_url(self):
        client = FakeClient([FakeResponse(200, {"results": [make_bar(1), {**make_bar(2), "h": "98.00"}], "next_url": "https://evil.example/v2/aggs/ticker/TEST/range/1/minute/x"})])
        with patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(simulator_data.DatasetError) as raised:
                await simulator_data.load_dataset("TEST", "polygon", history_days=7)
        self.assertEqual(raised.exception.code, "INVALID_BAR")
        self.assertNotIn("evil.example", str(raised.exception))
        self.assertEqual(len(client.calls), 1)

    async def test_polygon_excludes_future_bars_at_fifteen_minute_cutoff(self):
        now = 1_700_000_040
        client = FakeClient([FakeResponse(200, {"results": [make_bar(now - 960), make_bar(now - 900)]})])
        with patch.object(simulator_data, "utc_now_seconds", return_value=now), patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            dataset = await simulator_data.load_dataset("TEST", "polygon", history_days=7)
        self.assertEqual([bar["time"] for bar in dataset["bars"]], [now - 960])
        self.assertEqual(dataset["coverage"]["cutoff_timestamp"], now - 900)

    async def test_polygon_rejects_network_failure_as_typed_error(self):
        client = FakeClient([httpx.ConnectError("https://api.polygon.io/?apiKey=secret")])
        with patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(simulator_data.DatasetError) as raised:
                await simulator_data.load_dataset("TEST", "polygon", history_days=30)
        self.assertEqual(raised.exception.code, "POLYGON_UNAVAILABLE")
        self.assertNotIn("secret", str(raised.exception))
        self.assertNotIn("https://", str(raised.exception))

    async def test_polygon_forwards_exact_cursor_query(self):
        now = 1_700_000_040
        path = "/v2/aggs/ticker/AAPL/range/1/minute/2023-11-07/2023-11-14"
        client = FakeClient([
            FakeResponse(200, {"results": [make_bar(now - 960)], "next_url": f"https://api.polygon.io{path}?cursor=abc%2F123&limit=2"}),
            FakeResponse(200, {"results": [make_bar(now - 1020)]}),
        ])
        with patch.object(simulator_data, "utc_now_seconds", return_value=now), patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            await simulator_data.load_dataset("NASDAQ:AAPL", "polygon", history_days=7)
        self.assertEqual(client.calls[1][0], f"https://api.polygon.io{path}?cursor=abc%2F123&limit=2")

    async def test_polygon_rejects_duplicate_or_loop_cursor(self):
        now = 1_700_000_040
        path = "/v2/aggs/ticker/AAPL/range/1/minute/2023-11-07/2023-11-14"
        client = FakeClient([
            FakeResponse(200, {"results": [make_bar(now - 960)], "next_url": f"https://api.polygon.io{path}?cursor=loop"}),
            FakeResponse(200, {"results": [make_bar(now - 1020)], "next_url": f"https://api.polygon.io{path}?cursor=loop"}),
        ])
        with patch.object(simulator_data, "utc_now_seconds", return_value=now), patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(simulator_data.DatasetError) as raised:
                await simulator_data.load_dataset("NASDAQ:AAPL", "polygon", history_days=7)
        self.assertEqual(raised.exception.code, "POLYGON_PAGINATION")

    async def test_fx_canonical_id_maps_to_polygon_currency_symbol_and_allows_missing_volume(self):
        now = 1_700_000_040
        raw = make_bar(now - 960)
        del raw["v"]
        client = FakeClient([FakeResponse(200, {"results": [raw]})])
        with patch.object(simulator_data, "utc_now_seconds", return_value=now), patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            dataset = await simulator_data.load_dataset("FX:USD-INR", "polygon", history_days=30)
        self.assertEqual(dataset["instrument_id"], "FX:USD-INR")
        self.assertIn("/ticker/C:USDINR/", client.calls[0][0])
        self.assertEqual(dataset["bars"][0]["volume"], "0")

    async def test_polygon_rejects_missing_volume_for_non_fx(self):
        now = 1_700_000_040
        raw = make_bar(1700000040 - 960)
        del raw["v"]
        client = FakeClient([FakeResponse(200, {"results": [raw]})])
        with patch.object(simulator_data, "utc_now_seconds", return_value=now), patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(simulator_data.DatasetError) as raised:
                await simulator_data.load_dataset("NASDAQ:AAPL", "polygon", history_days=7)
        self.assertEqual(raised.exception.code, "INVALID_BAR")

    async def test_polygon_rejects_userinfo_and_non443_pagination_urls(self):
        now = 1_700_000_040
        path = "/v2/aggs/ticker/AAPL/range/1/minute/2023-11-07/2023-11-14"
        for hostile in (f"https://user:pass@api.polygon.io{path}?cursor=x", f"https://api.polygon.io:8443{path}?cursor=x"):
            client = FakeClient([FakeResponse(200, {"results": [make_bar(now - 960)], "next_url": hostile})])
            with patch.object(simulator_data, "utc_now_seconds", return_value=now), patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
                with self.assertRaises(simulator_data.DatasetError) as raised:
                    await simulator_data.load_dataset("NASDAQ:AAPL", "polygon", history_days=7)
            self.assertEqual(raised.exception.code, "POLYGON_PAGINATION")

    async def test_storage_is_atomic_and_get_detects_tamper_or_truncation(self):
        datasets = await asyncio.gather(*[simulator_data.load_dataset("NASDAQ:AAPL", "synthetic-test", history_days=7) for _ in range(3)])
        self.assertEqual(datasets[0], datasets[1])
        path = next(self.dataset_root.rglob("*.json"))
        path.write_text("{\"id\":", encoding="utf-8")
        with self.assertRaises(simulator_data.DatasetError) as raised:
            simulator_data.get_dataset(datasets[0]["id"])
        self.assertEqual(raised.exception.code, "DATASET_TAMPERED")
        self.assertFalse(list(self.dataset_root.rglob("*.tmp")))

    async def test_polygon_rejects_nonfinite_or_fractional_timestamps(self):
        for timestamp in ("Infinity", "1700000040000.5"):
            client = FakeClient([FakeResponse(200, {"results": [{**make_bar(1700000040), "t": timestamp}]})])
            with patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
                with self.assertRaises(simulator_data.DatasetError) as raised:
                    await simulator_data.load_dataset("NASDAQ:AAPL", "polygon", history_days=7)
            self.assertEqual(raised.exception.code, "INVALID_BAR")

    async def test_cutoff_is_floored_and_filters_outside_requested_window(self):
        now = 1_700_000_041
        cutoff = ((now - 900) // 60) * 60
        client = FakeClient([FakeResponse(200, {"results": [make_bar(cutoff - 60), make_bar(cutoff), make_bar(cutoff - 7 * 86400 - 60)]})])
        with patch.object(simulator_data, "utc_now_seconds", return_value=now), patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            dataset = await simulator_data.load_dataset("NASDAQ:AAPL", "polygon", history_days=7)
        self.assertEqual([bar["time"] for bar in dataset["bars"]], [cutoff - 60])
        self.assertEqual(dataset["coverage"]["cutoff_timestamp"], cutoff)

    async def test_canonical_ids_are_preserved_and_unsupported_polygon_venues_rejected(self):
        synthetic = await simulator_data.load_dataset("NASDAQ:AAPL", "synthetic-test", history_days=7)
        self.assertEqual(synthetic["instrument_id"], "NASDAQ:AAPL")
        client = FakeClient([FakeResponse(200, {"results": [make_bar(1700000040 - 960)]})])
        with patch.object(simulator_data, "utc_now_seconds", return_value=1700000040), patch.object(simulator_data.httpx, "AsyncClient", return_value=client):
            polygon = await simulator_data.load_dataset("NASDAQ:AAPL", "polygon", history_days=7)
        self.assertEqual(polygon["instrument_id"], "NASDAQ:AAPL")
        self.assertIn("/ticker/AAPL/", client.calls[0][0])
        with self.assertRaises(simulator_data.DatasetError) as raised:
            await simulator_data.load_dataset("LSE:VOD", "polygon", history_days=7)
        self.assertEqual(raised.exception.code, "UNSUPPORTED_VENUE")
