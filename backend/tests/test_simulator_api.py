from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import simulator
from app.api.deps import get_current_user
from app.simulator.repository import InMemorySimulatorRepository


def fixture_dataset(instrument_id="NSE:RELIANCE", source="synthetic-test", count=420):
    bars = [{"time": 1_700_000_000 + index * 60, "open": str(100 + index), "high": str(101 + index), "low": str(99 + index), "close": str(100.5 + index), "volume": "1000"} for index in range(count)]
    return {"id": f"dataset-{instrument_id}", "instrument_id": instrument_id, "source": source, "bars": bars, "coverage": {"actual_start": bars[0]["time"], "actual_end": bars[-1]["time"], "test_only": source == "synthetic-test"}}


def client_and_repo():
    repo = InMemorySimulatorRepository()
    user = SimpleNamespace(id="learner-1", email="learner@example.test", subscription_plan="trader", role="student")
    app = FastAPI()
    app.include_router(simulator.router)
    app.include_router(simulator.admin_router)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[simulator.get_simulator_repository] = lambda: repo
    return TestClient(app), repo, user


def test_catalog_has_full_multi_asset_coverage_and_provider_labels():
    client, _, _ = client_and_repo()
    catalog = client.get("/api/v1/simulator/instruments").json()
    assert len(catalog) == 40
    assert next(item for item in catalog if item["id"] == "NASDAQ:AAPL")["replay_source"] == "polygon"
    assert next(item for item in catalog if item["id"] == "NSE:RELIANCE")["replay_source"] == "synthetic-test"


def test_session_pins_long_dataset_and_hides_future_bars():
    client, _, _ = client_and_repo()
    dataset = fixture_dataset()
    with patch.object(simulator, "load_dataset", new=AsyncMock(return_value=dataset)), patch.object(simulator, "get_dataset", return_value=dataset):
        simulator._dataset.cache_clear()
        response = client.post("/api/v1/simulator/sessions", json={"mode": "replay", "instrument_id": "NSE:RELIANCE", "history_days": 30}, headers={"Idempotency-Key": "session-1"})
        session = response.json()
        candles = client.get(f"/api/v1/simulator/sessions/{session['id']}/candles?limit=2000").json()
    assert response.status_code == 200
    assert session["total_bars"] == 420
    assert len(candles) == 300
    assert candles[-1]["time"] < dataset["bars"][300]["time"]


def test_market_order_waits_for_next_bar_and_retry_is_idempotent():
    client, _, _ = client_and_repo()
    dataset = fixture_dataset()
    with patch.object(simulator, "load_dataset", new=AsyncMock(return_value=dataset)), patch.object(simulator, "get_dataset", return_value=dataset):
        simulator._dataset.cache_clear()
        session = client.post("/api/v1/simulator/sessions", json={"mode": "replay"}, headers={"Idempotency-Key": "session-1"}).json()
        headers = {"Idempotency-Key": "order-1"}
        first = client.post(f"/api/v1/simulator/sessions/{session['id']}/orders", json={"side": "buy", "order_type": "market", "quantity": "2", "stop_loss": "350", "take_profit": "500"}, headers=headers)
        retry = client.post(f"/api/v1/simulator/sessions/{session['id']}/orders", json={"side": "buy", "order_type": "market", "quantity": "2", "stop_loss": "350", "take_profit": "500"}, headers=headers)
        before = client.get(f"/api/v1/simulator/sessions/{session['id']}").json()
        stepped = client.post(f"/api/v1/simulator/sessions/{session['id']}/controls", json={"action": "step"}, headers={"Idempotency-Key": "step-1"}).json()
    assert first.json() == retry.json()
    assert before["orders"][0]["status"] == "open"
    assert stepped["fills"][0]["price"] == "400.18"
    assert len([order for order in stepped["orders"] if order.get("parent_order_id")]) == 2


def test_replay_supports_requested_speeds_and_forward_seek():
    client, _, _ = client_and_repo()
    dataset = fixture_dataset()
    with patch.object(simulator, "load_dataset", new=AsyncMock(return_value=dataset)), patch.object(simulator, "get_dataset", return_value=dataset):
        simulator._dataset.cache_clear()
        session = client.post("/api/v1/simulator/sessions", json={"mode": "replay"}, headers={"Idempotency-Key": "session-speed"}).json()
        assert session["speed"] == 5
        for speed in (5, 10, 20, 30):
            response = client.post(f"/api/v1/simulator/sessions/{session['id']}/controls", json={"action": "speed", "value": speed}, headers={"Idempotency-Key": f"speed-{speed}"})
            assert response.status_code == 200
            assert response.json()["speed"] == speed
        sought = client.post(f"/api/v1/simulator/sessions/{session['id']}/controls", json={"action": "seek", "value": 325}, headers={"Idempotency-Key": "seek-forward"})
    assert sought.status_code == 200
    assert sought.json()["clock"] == 325
    assert sought.json()["state"] == "paused"


def test_backward_seek_creates_assisted_fork_and_preserves_original():
    client, _, _ = client_and_repo()
    dataset = fixture_dataset()
    with patch.object(simulator, "load_dataset", new=AsyncMock(return_value=dataset)), patch.object(simulator, "get_dataset", return_value=dataset):
        simulator._dataset.cache_clear()
        session = client.post("/api/v1/simulator/sessions", json={"mode": "replay"}, headers={"Idempotency-Key": "session-fork"}).json()
        client.post(f"/api/v1/simulator/sessions/{session['id']}/orders", json={"side": "buy", "order_type": "market", "quantity": "1", "stop_loss": "350", "take_profit": "500"}, headers={"Idempotency-Key": "fork-order"})
        client.post(f"/api/v1/simulator/sessions/{session['id']}/controls", json={"action": "seek", "value": 320}, headers={"Idempotency-Key": "seek-ahead"})
        fork = client.post(f"/api/v1/simulator/sessions/{session['id']}/controls", json={"action": "seek", "value": 310}, headers={"Idempotency-Key": "seek-back"})
        retry = client.post(f"/api/v1/simulator/sessions/{session['id']}/controls", json={"action": "seek", "value": 310}, headers={"Idempotency-Key": "seek-back"})
        original = client.get(f"/api/v1/simulator/sessions/{session['id']}").json()
    assert fork.status_code == 200
    assert fork.json()["id"] != session["id"]
    assert retry.json()["id"] == fork.json()["id"]
    assert fork.json()["parent_session_id"] == session["id"]
    assert fork.json()["assisted"] is True
    assert fork.json()["clock"] == 310
    assert len(fork.json()["fills"]) == 1
    assert len(fork.json()["positions"]) == 1
    assert [order["status"] for order in fork.json()["orders"]] == ["filled"]
    assert original["clock"] == 320


def test_idempotency_key_conflicts_for_different_payload():
    client, _, _ = client_and_repo()
    dataset = fixture_dataset()
    with patch.object(simulator, "load_dataset", new=AsyncMock(return_value=dataset)), patch.object(simulator, "get_dataset", return_value=dataset):
        simulator._dataset.cache_clear()
        session = client.post("/api/v1/simulator/sessions", json={"mode": "replay"}, headers={"Idempotency-Key": "session-1"}).json()
        headers = {"Idempotency-Key": "same-key"}
        assert client.post(f"/api/v1/simulator/sessions/{session['id']}/orders", json={"side": "buy", "order_type": "market", "quantity": "1"}, headers=headers).status_code == 200
        conflict = client.post(f"/api/v1/simulator/sessions/{session['id']}/orders", json={"side": "buy", "order_type": "market", "quantity": "2"}, headers=headers)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_free_user_can_read_owned_history_but_cannot_create_exposure():
    client, repo, user = client_and_repo()
    dataset = fixture_dataset()
    with patch.object(simulator, "load_dataset", new=AsyncMock(return_value=dataset)), patch.object(simulator, "get_dataset", return_value=dataset):
        simulator._dataset.cache_clear()
        session = client.post("/api/v1/simulator/sessions", json={"mode": "replay"}, headers={"Idempotency-Key": "session-1"}).json()
        user.subscription_plan = "free"
        assert client.get(f"/api/v1/simulator/sessions/{session['id']}").status_code == 200
        blocked = client.post(f"/api/v1/simulator/sessions/{session['id']}/orders", json={"side": "buy", "order_type": "market", "quantity": "1"}, headers={"Idempotency-Key": "blocked"})
    assert blocked.status_code == 403


def test_journal_and_deterministic_review_are_persisted():
    client, _, _ = client_and_repo()
    dataset = fixture_dataset()
    with patch.object(simulator, "load_dataset", new=AsyncMock(return_value=dataset)), patch.object(simulator, "get_dataset", return_value=dataset):
        simulator._dataset.cache_clear()
        session = client.post("/api/v1/simulator/sessions", json={"mode": "replay"}, headers={"Idempotency-Key": "session-1"}).json()
        client.put(f"/api/v1/simulator/sessions/{session['id']}/journal", json={"plan": "Risk 1%", "reflection": "Waited for setup"}, headers={"Idempotency-Key": "journal-1"})
        review = client.get(f"/api/v1/simulator/sessions/{session['id']}/review").json()
    assert review["dimensions"]["plan_adherence"] == 35
    assert review["dimensions"]["execution_discipline"] == 25
