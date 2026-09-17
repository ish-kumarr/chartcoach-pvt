# Simulator Terminal Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for scoped implementation and independent review. Steps use checkbox syntax.

**Goal:** Replace the prototype with a usable, correct terminal and longer-history simulation while retaining the approved release requirements.

**Architecture:** Versioned immutable bar datasets feed a deterministic engine. Transactional account commands and worker advancement publish sequenced snapshots consumed by the terminal.

**Tech Stack:** Next.js, React, Lightweight Charts, FastAPI, PyMongo, Redis, Decimal, pytest, Vitest.

**Spec:** docs/superpowers/specs/2026-09-16-simulator-terminal.md

## Global Constraints

- Preserve DRM/pricing and existing dirty fixes; work only in this isolated worktree.
- Do not print secrets, buy data, publish, push or alter user entitlements.
- One-minute execution, 15-minute delayed clock, INR 1000000 initial test funds.
- Default history 30 days; selectable 7/30/90/365 days. Return actual coverage, never infer provider permissions from a key.
- Decimal strings for financial API fields; no silent synthetic fallback for Polygon sessions.
- Do not declare production-ready without the full original acceptance suite.

## Task 1: Historical dataset boundary

Owned files: backend/app/services/simulator_data.py, backend/tests/test_simulator_data.py.

Contract: async load_dataset(instrument_id: str, source: str, history_days: int = 30) -> dict with id, source, instrument_id, bars (time Unix seconds, OHLCV decimal strings), precision='1m', start/end timestamps and coverage metadata. Source values synthetic-test or polygon. Immutable content-addressed dataset storage, get_dataset(dataset_id) -> dict. API layer pins dataset_id. Data source errors are typed and contain safe user-facing messages and codes, never URLs with keys. Synthetic prices and fixture FX explicitly test-only. A refresh helper supports delayed data without overwriting pinned replay history.

- [ ] Write tests for >100 bars, reproducibility, pagination, duplicates, invalid OHLC, 403/429, future cutoff and hostile next_url.
- [ ] Run focused pytest and observe expected failures.
- [ ] Implement bounded paginated Polygon one-minute fetch with endpoint-host validation, rate limit handling, coverage validation and immutable files.
- [ ] Re-run tests and record evidence.

## Task 2: Engine, transactional API and workers

Owned files: backend/app/simulator/*, backend/app/api/simulator.py, backend/app/workers/simulator_worker.py, backend/tests/test_simulator_api.py, backend/tests/test_simulator_worker.py, new engine/repository tests. Do not edit data service.

Consume Task 1 contracts above. Retain endpoint URLs and additive JSON fields. SessionCreate adds history_days and source; defaults synthetic-test for compatibility. Snapshot adds positions, ledger, market_time, data_status, dataset coverage, total_bars, account buying_power/realized_pnl/unrealized_pnl/reserved. Candles supports before (exclusive Unix timestamp), limit (default 500 max 2000), timeframe (1m/5m/15m/1h/1d); returns existing candle-array shape. Orders add stop_loss, take_profit, time_in_force DAY/GTC. All mutations require Idempotency-Key, retries return original response. GET sessions lists owned recent sessions. GET journal reads saved plan/reflection. Existing amend/cancel/close/reset/review URLs retained. Frontend can poll snapshots each second while streaming is being integrated.

- [ ] Write failing deterministic fill/accounting tests: next-bar, resting stops/limits, OCO stop-first, cost basis, reservations, reduce-only, FX availability and transactional idempotency.
- [ ] Implement pure Decimal state machine and repository with transactions and bounded conflict retries. In-memory test adapter must be explicit, never a production fallback.
- [ ] Replace routing internals; legacy records remain readable but cannot mutate into new ledger semantics.
- [ ] Worker executes both replay and delayed sessions, respects controller heartbeats, advances correct clock, and processes every eligible bar exactly once.
- [ ] Add integration tests for no future candles, existing account persistence, wrong-owner denial, reset/history, idempotency and command races.
- [ ] Run focused and full tests; record unresolved original-plan requirements rather than hiding them.

## Task 3: Trading terminal

Owned files: frontend/src/app/trade/*, frontend/src/components/simulator/*, frontend/src/lib/simulator*. Read frontend/AGENTS.md and installed Next docs.

Consume Task 2 API contracts. Advanced default; beginner hides density without losing state. No fake quotes/statistics or nonfunctional toolbar buttons. Theme slate/near-black, indigo action, green/red only for trading states; compact typography, dividers instead of card mosaics. Chart is dominant. Render account cash/equity/buying power/P&L, instrument search, dataset/range selection, chart timeframe/indicators, ticket types/protection, positions/close, orders/amend/cancel, fills, journal and review. Pending confirmation survives network errors with the same idempotency key on retry. Display symbol quote currency separately from INR account currency.

- [ ] Tests first for timeframe aggregation/indicators where client-side, safe order validation and interactions.
- [ ] Implement modular components and typed API wrappers; restore session from URL; refresh authoritative state with stale-response protection.
- [ ] Preserve chart viewport on updates; add SMA/EMA, RSI/MACD/VWAP and drawings where fully implementable, never decorative toolbar stubs.
- [ ] Add paginated older-bar loading and coverage/source/age states; mobile chart/trade/activity tabs and keyboard focus.
- [ ] Run Vitest and production build; browser verify full flows after backend integration.

## Task 4: Integration and release gate

- [ ] Independent review of data, engine and UI diffs; resolve correctness/security findings.
- [ ] Run full backend/frontend suites and production build.
- [ ] Verify real Polygon capability and actual returned date coverage without exposing credentials.
- [ ] Run isolated Mongo replica-set transaction tests and worker recovery.
- [ ] Browser verify desktop/mobile order lifecycle and replay history visibility.
- [ ] Finish original-plan drills/admin/course/mastery and AI-provider-gated reviews before claiming full release completion.
- [ ] Run 100-learner 30-minute load test and document hardware, latency and ledger consistency before production acceptance.

## Progress

Baseline: 104 backend tests passed, one skipped. Existing seven dirty files ported without altering outer main.
