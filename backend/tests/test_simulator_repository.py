import pytest

from app.simulator.repository import IdempotencyConflict, InMemorySimulatorRepository


def test_transaction_commits_financial_state_idempotency_and_outbox_together():
    repo = InMemorySimulatorRepository()
    repo.create_account({"id": "a1", "learner_id": "u1", "cash": "1000.00"})
    repo.create_session({"id": "s1", "learner_id": "u1", "account_id": "a1", "revision": 1})

    response = repo.mutate("s1", "order:k1", "hash-a", lambda state: ({"id": "o1"}, {"account": {**state["account"], "cash": "900.00"}, "orders": [{"id": "o1"}], "events": [{"type": "order.created"}]}))
    retry = repo.mutate("s1", "order:k1", "hash-a", lambda _: (_ for _ in ()).throw(AssertionError("must not rerun")))

    assert response == retry == {"id": "o1"}
    assert repo.snapshot("s1")["account"]["cash"] == "900.00"
    assert repo.outbox[0]["type"] == "order.created"
    with pytest.raises(IdempotencyConflict):
        repo.mutate("s1", "order:k1", "hash-b", lambda state: ({}, {}))


def test_sessions_on_same_account_share_positions_and_account_revision():
    repo = InMemorySimulatorRepository()
    repo.create_account({"id": "a1", "learner_id": "u1", "cash": "1000.00", "revision": 1, "status": "active", "mode": "delayed"})
    repo.create_session({"id": "s1", "learner_id": "u1", "account_id": "a1", "revision": 1})
    repo.create_session({"id": "s2", "learner_id": "u1", "account_id": "a1", "revision": 1})

    repo.mutate("s1", "order:k1", "hash-a", lambda state: ({"ok": True}, {
        "account": {**state["account"], "cash": "900.00"},
        "positions": [{"id": "p1", "instrument_id": "NASDAQ:AAPL", "quantity": "1"}],
    }))

    second = repo.snapshot("s2")
    assert second["account"]["cash"] == "900.00"
    assert second["account"]["revision"] == 2
    assert second["positions"][0]["instrument_id"] == "NASDAQ:AAPL"
