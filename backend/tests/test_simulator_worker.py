from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.simulator.repository import InMemorySimulatorRepository
from app.workers.simulator_worker import advance_sessions


def seed(repo, mode="replay", heartbeat=None):
    repo.create_account({"id": "a1", "learner_id": "u1", "cash": "1000", "equity": "1000", "buying_power": "1000", "reserved": "0", "realized_pnl": "0", "unrealized_pnl": "0", "revision": 1})
    repo.create_session({"id": "s1", "learner_id": "u1", "account_id": "a1", "mode": mode, "state": "playing", "speed": 1, "clock": 1, "revision": 1, "dataset_id": "d1", "instrument_id": "NSE:RELIANCE", "controller_heartbeat_at": heartbeat})


def test_worker_advances_replay_and_processes_next_bar():
    repo = InMemorySimulatorRepository()
    now = datetime.now(timezone.utc)
    seed(repo, heartbeat=now.isoformat())
    with patch("app.workers.simulator_worker.advance_state") as advance:
        current = repo.snapshot("s1")
        advance.return_value = ({**current["session"], "clock": 2}, current["account"], [], [], [], [])
        changed = advance_sessions(repo, now)
    assert changed == 1
    assert repo.snapshot("s1")["session"]["clock"] == 2
    assert repo.outbox[0]["type"] == "clock.advanced"


def test_worker_pauses_replay_when_controller_lease_expires():
    repo = InMemorySimulatorRepository()
    now = datetime.now(timezone.utc)
    seed(repo, heartbeat=(now - timedelta(seconds=20)).isoformat())
    assert advance_sessions(repo, now) == 1
    assert repo.snapshot("s1")["session"]["state"] == "paused"
