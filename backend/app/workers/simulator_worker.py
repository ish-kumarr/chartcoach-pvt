"""Advance replay and delayed sessions from authoritative server state."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import redis.asyncio as redis

from app.api.simulator import advance_state
from app.config import settings
from app.simulator.database import get_simulator_db
from app.simulator.repository import MongoSimulatorRepository


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def advance_sessions(repo, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    changed = 0
    for listed in repo.list_active_sessions():
        state = repo.snapshot(listed["id"])
        session = state["session"]
        if session["mode"] == "replay":
            heartbeat = _parse(session.get("controller_heartbeat_at"))
            if session["state"] != "playing":
                continue
            if not heartbeat or (now - heartbeat).total_seconds() > session.get("controller_lease_seconds", 15):
                def pause(current):
                    updated = {**current["session"], "state": "paused"}
                    return {"state": "paused"}, {"session": updated, "events": [{"id": f"evt_{uuid4().hex}", "type": "replay.lease_expired", "created_at": now.isoformat()}]}
                repo.mutate(session["id"], f"worker:lease:{session['revision']}", "lease-expired", pause)
                changed += 1
                continue
            count = session.get("speed", 1)
        else:
            previous = _parse(session.get("last_tick_at"))
            if previous and (now - previous).total_seconds() < 60:
                continue
            count = 1

        def advance(current):
            updated, account, positions, orders, fills, ledger = advance_state(current, count)
            updated["last_tick_at"] = now.isoformat()
            event = {"id": f"evt_{uuid4().hex}", "type": "clock.advanced", "created_at": now.isoformat(), "clock": updated["clock"]}
            return {"clock": updated["clock"]}, {"session": updated, "account": account, "positions": positions, "orders": orders, "fills": fills, "ledger": ledger, "events": [event]}

        repo.mutate(session["id"], f"worker:clock:{session['clock']}", f"advance:{count}", advance)
        changed += 1
    return changed


async def run() -> None:
    redis_client = redis.from_url(settings.simulator_redis_url, decode_responses=True)
    await redis_client.ping()
    repo = MongoSimulatorRepository(get_simulator_db())
    repo.ensure_indexes()
    try:
        while True:
            advance_sessions(repo)
            await asyncio.sleep(1)
    finally:
        await redis_client.aclose()


if __name__ == "__main__":
    asyncio.run(run())
