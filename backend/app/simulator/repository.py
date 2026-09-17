from __future__ import annotations

import copy
from collections import defaultdict
from datetime import datetime, timezone
from typing import Callable
from uuid import uuid4

from pymongo.errors import ConnectionFailure, DuplicateKeyError, OperationFailure


class IdempotencyConflict(Exception):
    pass


class RevisionConflict(Exception):
    pass


class InMemorySimulatorRepository:
    """Explicit test adapter. Production configuration never selects it."""

    def __init__(self):
        self.accounts: dict[str, dict] = {}
        self.sessions: dict[str, dict] = {}
        self.records: defaultdict[tuple[str, str], list[dict]] = defaultdict(list)
        self.idempotency: dict[tuple[str, str], dict] = {}
        self.outbox: list[dict] = []
        self.creation_idempotency: dict[tuple[str, str], dict] = {}

    def create_account(self, account: dict) -> dict:
        self.accounts[account["id"]] = copy.deepcopy(account)
        return copy.deepcopy(account)

    def find_active_account(self, learner_id: str, mode: str) -> dict | None:
        return next((copy.deepcopy(item) for item in self.accounts.values() if item.get("learner_id") == learner_id and item.get("mode") == mode and item.get("status") == "active"), None)

    def create_session(self, session: dict) -> dict:
        self.sessions[session["id"]] = copy.deepcopy(session)
        return copy.deepcopy(session)

    def create_session_bundle(self, learner_id: str, key: str, fingerprint: str, account: dict, session: dict) -> dict:
        token = (learner_id, key)
        prior = self.creation_idempotency.get(token)
        if prior:
            if prior["fingerprint"] != fingerprint:
                raise IdempotencyConflict()
            return self.snapshot(prior["session_id"])
        if account["id"] not in self.accounts:
            self.create_account(account)
        self.create_session(session)
        self.creation_idempotency[token] = {"fingerprint": fingerprint, "session_id": session["id"]}
        return self.snapshot(session["id"])

    def create_fork_bundle(self, source_session_id: str, key: str, fingerprint: str, account: dict, session: dict, records: dict) -> dict:
        token = (source_session_id, f"fork:{key}")
        prior = self.idempotency.get(token)
        if prior:
            if prior["fingerprint"] != fingerprint:
                raise IdempotencyConflict()
            return self.snapshot(prior["session_id"])
        self.create_account(account)
        self.create_session(session)
        for name in ("orders", "positions", "fills", "ledger"):
            self.records[(account["id"], name)] = copy.deepcopy(records.get(name, []))
        self.idempotency[token] = {"fingerprint": fingerprint, "session_id": session["id"], "response": {"session_id": session["id"]}}
        return self.snapshot(session["id"])

    def get_session(self, session_id: str) -> dict | None:
        value = self.sessions.get(session_id)
        return copy.deepcopy(value) if value else None

    def list_sessions(self, learner_id: str) -> list[dict]:
        values = [copy.deepcopy(item) for item in self.sessions.values() if item.get("learner_id") == learner_id]
        return sorted(values, key=lambda item: item.get("created_at", ""), reverse=True)[:50]

    def list_active_sessions(self) -> list[dict]:
        return [copy.deepcopy(item) for item in self.sessions.values() if item.get("state") in {"playing", "paused"}]

    def snapshot(self, session_id: str) -> dict | None:
        session = self.get_session(session_id)
        if not session:
            return None
        account_id = session["account_id"]
        return {
            "session": session,
            "account": copy.deepcopy(self.accounts[account_id]),
            "orders": copy.deepcopy(self.records[(account_id, "orders")]),
            "positions": copy.deepcopy(self.records[(account_id, "positions")]),
            "fills": copy.deepcopy(self.records[(account_id, "fills")]),
            "ledger": copy.deepcopy(self.records[(account_id, "ledger")]),
        }

    def mutate(self, session_id: str, key: str, fingerprint: str, operation: Callable):
        token = (session_id, key)
        if token in self.idempotency:
            saved = self.idempotency[token]
            if saved["fingerprint"] != fingerprint:
                raise IdempotencyConflict()
            return copy.deepcopy(saved["response"])
        state = self.snapshot(session_id)
        if state is None:
            raise KeyError(session_id)
        response, changes = operation(copy.deepcopy(state))
        account_id = state["session"]["account_id"]
        if "session" in changes:
            updated = copy.deepcopy(changes["session"])
            updated["revision"] = state["session"].get("revision", 0) + 1
            self.sessions[session_id] = updated
        if "account" in changes:
            updated = copy.deepcopy(changes["account"])
            updated["revision"] = state["account"].get("revision", 0) + 1
            self.accounts[account_id] = updated
        for name in ("orders", "positions", "fills", "ledger"):
            if name in changes:
                self.records[(account_id, name)] = copy.deepcopy(changes[name])
        self.outbox.extend({"session_id": session_id, "account_id": account_id, **event} for event in changes.get("events", []))
        self.idempotency[token] = {"fingerprint": fingerprint, "response": copy.deepcopy(response)}
        return copy.deepcopy(response)

    def reset_account(self, account_id, learner_id, key, fingerprint, reason, starting_equity):
        token = (f"account:{account_id}", key)
        prior = self.idempotency.get(token)
        if prior:
            if prior["fingerprint"] != fingerprint:
                raise IdempotencyConflict()
            return copy.deepcopy(prior["response"])
        old = self.accounts[account_id]
        old.update(status="archived", archived_reason=reason)
        for order in self.records[(account_id, "orders")]:
            if order.get("status") == "open":
                order["status"] = "cancelled"
        new = {**old, "id": f"acct_{uuid4().hex}", "status": "active", "cash": starting_equity, "equity": starting_equity, "buying_power": starting_equity, "reserved": "0.00", "realized_pnl": "0.00", "unrealized_pnl": "0.00", "revision": 1, "created_at": datetime.now(timezone.utc).isoformat()}
        self.accounts[new["id"]] = new
        response = {"archived_account_id": account_id, "account": copy.deepcopy(new)}
        self.idempotency[token] = {"fingerprint": fingerprint, "response": response}
        return response


class MongoSimulatorRepository:
    """Replica-set adapter; command state, idempotency and outbox commit together."""

    def __init__(self, database, retries: int = 3):
        self.db = database
        self.retries = retries

    def ensure_indexes(self) -> None:
        self.db.simulator_accounts.create_index([("learner_id", 1), ("mode", 1), ("status", 1)])
        self.db.simulator_sessions.create_index("id", unique=True)
        self.db.simulator_idempotency.create_index([("session_id", 1), ("key", 1)], unique=True)
        for name in ("orders", "positions", "fills", "ledger"):
            self.db[f"simulator_{name}"].create_index("id", unique=True, sparse=True)

    def create_account(self, value: dict) -> dict:
        self.db.simulator_accounts.insert_one(copy.deepcopy(value))
        return value

    def find_active_account(self, learner_id: str, mode: str) -> dict | None:
        return self.db.simulator_accounts.find_one({"learner_id": learner_id, "mode": mode, "status": "active"}, {"_id": 0})

    def create_session(self, value: dict) -> dict:
        self.db.simulator_sessions.insert_one(copy.deepcopy(value))
        return value

    def create_session_bundle(self, learner_id: str, key: str, fingerprint: str, account: dict, session: dict) -> dict:
        with self.db.client.start_session() as mongo_session:
            with mongo_session.start_transaction():
                prior = self.db.simulator_session_idempotency.find_one({"learner_id": learner_id, "key": key}, session=mongo_session)
                if prior:
                    if prior["fingerprint"] != fingerprint:
                        raise IdempotencyConflict()
                    return self.snapshot(prior["session_id"], mongo_session)
                self.db.simulator_accounts.update_one({"id": account["id"]}, {"$setOnInsert": copy.deepcopy(account)}, upsert=True, session=mongo_session)
                self.db.simulator_sessions.insert_one(copy.deepcopy(session), session=mongo_session)
                self.db.simulator_session_idempotency.insert_one({"learner_id": learner_id, "key": key, "fingerprint": fingerprint, "session_id": session["id"]}, session=mongo_session)
                return self.snapshot(session["id"], mongo_session)

    def create_fork_bundle(self, source_session_id: str, key: str, fingerprint: str, account: dict, session: dict, records: dict) -> dict:
        token = f"fork:{key}"
        with self.db.client.start_session() as mongo_session:
            with mongo_session.start_transaction():
                prior = self.db.simulator_idempotency.find_one({"session_id": source_session_id, "key": token}, session=mongo_session)
                if prior:
                    if prior["fingerprint"] != fingerprint:
                        raise IdempotencyConflict()
                    return self.snapshot(prior["response"]["session_id"], mongo_session)
                self.db.simulator_accounts.insert_one(copy.deepcopy(account), session=mongo_session)
                self.db.simulator_sessions.insert_one(copy.deepcopy(session), session=mongo_session)
                for name in ("orders", "positions", "fills", "ledger"):
                    values = [{**value, "account_id": account["id"]} for value in records.get(name, [])]
                    if values:
                        self.db[f"simulator_{name}"].insert_many(values, session=mongo_session)
                response = {"session_id": session["id"]}
                self.db.simulator_idempotency.insert_one({"session_id": source_session_id, "key": token, "fingerprint": fingerprint, "response": response}, session=mongo_session)
                return self.snapshot(session["id"], mongo_session)

    def get_session(self, session_id: str) -> dict | None:
        return self.db.simulator_sessions.find_one({"id": session_id}, {"_id": 0})

    def list_sessions(self, learner_id: str) -> list[dict]:
        return list(self.db.simulator_sessions.find({"learner_id": learner_id}, {"_id": 0}).sort("created_at", -1).limit(50))

    def list_active_sessions(self) -> list[dict]:
        return list(self.db.simulator_sessions.find({"state": {"$in": ["playing", "paused"]}}, {"_id": 0}))

    def snapshot(self, session_id: str, mongo_session=None) -> dict | None:
        session = self.db.simulator_sessions.find_one({"id": session_id}, {"_id": 0}, session=mongo_session)
        if not session:
            return None
        account_id = session.get("account_id")
        if not account_id:
            return {"session": session, "account": session.get("account", {}), "orders": [], "positions": [], "fills": [], "ledger": []}
        account = self.db.simulator_accounts.find_one({"id": account_id}, {"_id": 0}, session=mongo_session)
        state = {"session": session, "account": account}
        for name in ("orders", "positions", "fills", "ledger"):
            state[name] = list(self.db[f"simulator_{name}"].find({"account_id": account_id}, {"_id": 0}, session=mongo_session).sort("created_at", 1))
        return state

    def _sync_projection(self, name: str, account_id: str, values: list[dict], mongo_session) -> None:
        collection = self.db[f"simulator_{name}"]
        wanted_ids = []
        for value in values:
            record = {**value, "account_id": account_id}
            record_id = record.get("id") or f"{name}:{account_id}:{record.get('instrument_id')}"
            record["id"] = record_id
            wanted_ids.append(record_id)
            collection.replace_one({"id": record_id, "account_id": account_id}, record, upsert=True, session=mongo_session)
        collection.delete_many({"account_id": account_id, "id": {"$nin": wanted_ids}}, session=mongo_session)

    def _append_records(self, name: str, account_id: str, values: list[dict], mongo_session) -> None:
        collection = self.db[f"simulator_{name}"]
        for value in values:
            record = {**value, "account_id": account_id}
            collection.update_one({"id": record["id"], "account_id": account_id}, {"$setOnInsert": record}, upsert=True, session=mongo_session)

    def mutate(self, session_id: str, key: str, fingerprint: str, operation: Callable):
        for attempt in range(self.retries):
            try:
                with self.db.client.start_session() as mongo_session:
                    with mongo_session.start_transaction():
                        prior = self.db.simulator_idempotency.find_one({"session_id": session_id, "key": key}, session=mongo_session)
                        if prior:
                            if prior["fingerprint"] != fingerprint:
                                raise IdempotencyConflict()
                            return prior["response"]
                        state = self.snapshot(session_id, mongo_session)
                        if state is None:
                            raise KeyError(session_id)
                        response, changes = operation(copy.deepcopy(state))
                        account_id = state["session"]["account_id"]
                        expected_session = state["session"].get("revision", 0)
                        updated_session = {**changes.get("session", state["session"]), "revision": expected_session + 1}
                        hit = self.db.simulator_sessions.replace_one({"id": session_id, "revision": expected_session}, updated_session, session=mongo_session)
                        if hit.modified_count != 1:
                            raise RevisionConflict()
                        if "account" in changes:
                            expected_account = state["account"].get("revision", 0)
                            updated_account = {**changes["account"], "revision": expected_account + 1}
                            hit = self.db.simulator_accounts.replace_one({"id": account_id, "revision": expected_account}, updated_account, session=mongo_session)
                            if hit.modified_count != 1:
                                raise RevisionConflict()
                        for name in ("orders", "positions"):
                            if name in changes:
                                self._sync_projection(name, account_id, changes[name], mongo_session)
                        for name in ("fills", "ledger"):
                            if name in changes:
                                self._append_records(name, account_id, changes[name], mongo_session)
                        for event in changes.get("events", []):
                            self.db.simulator_outbox.update_one({"id": event["id"]}, {"$setOnInsert": {"session_id": session_id, "account_id": account_id, "published_at": None, **event}}, upsert=True, session=mongo_session)
                        self.db.simulator_idempotency.insert_one({"session_id": session_id, "key": key, "fingerprint": fingerprint, "response": response}, session=mongo_session)
                        return response
            except IdempotencyConflict:
                raise
            except (ConnectionFailure, OperationFailure, RevisionConflict, DuplicateKeyError):
                if attempt + 1 == self.retries:
                    raise
        raise RevisionConflict()

    def reset_account(self, account_id, learner_id, key, fingerprint, reason, starting_equity):
        token = f"account:{account_id}"
        with self.db.client.start_session() as mongo_session:
            with mongo_session.start_transaction():
                prior = self.db.simulator_idempotency.find_one({"session_id": token, "key": key}, session=mongo_session)
                if prior:
                    if prior["fingerprint"] != fingerprint:
                        raise IdempotencyConflict()
                    return prior["response"]
                old = self.db.simulator_accounts.find_one({"id": account_id, "learner_id": learner_id, "status": "active"}, session=mongo_session)
                if not old:
                    raise KeyError(account_id)
                now = datetime.now(timezone.utc).isoformat()
                self.db.simulator_accounts.update_one({"id": account_id}, {"$set": {"status": "archived", "archived_at": now, "archived_reason": reason}}, session=mongo_session)
                self.db.simulator_orders.update_many({"account_id": account_id, "status": "open"}, {"$set": {"status": "cancelled"}}, session=mongo_session)
                new = {k: v for k, v in old.items() if k != "_id"}
                new.update(id=f"acct_{uuid4().hex}", status="active", cash=starting_equity, equity=starting_equity, buying_power=starting_equity, reserved="0.00", realized_pnl="0.00", unrealized_pnl="0.00", revision=1, created_at=now)
                self.db.simulator_accounts.insert_one(new, session=mongo_session)
                response = {"archived_account_id": account_id, "account": new}
                self.db.simulator_idempotency.insert_one({"session_id": token, "key": key, "fingerprint": fingerprint, "response": response}, session=mongo_session)
                return response
