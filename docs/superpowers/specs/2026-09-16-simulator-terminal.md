# Simulator terminal rebuild

Approved in conversation on 2026-09-16: controlled rebuild of the existing simulator, advanced terminal default with beginner switch. The original end-to-end plan remains the release contract. Additional user requirement: substantially longer fetched history suitable for replay.

## Product and interface

Keep /trade, authentication, Trader/Pro/Elite entitlement and INR reporting. Replace the marketing setup with a dark chart-centered terminal: searchable watchlist, compact session controls, account strip, chart toolbar, order inspector, bottom positions/orders/fills/journal/review tabs. Mobile uses workspace tabs and an order drawer. All visible controls must work; unsupported provider capabilities are explained, never simulated under a real-data label.

## Data

Default replay requests 30 calendar days of one-minute history; allow 7, 30, 90 and 365 days with explicit coverage and provider errors. Dataset loading follows bounded pagination, validates OHLC/timestamps, and stores a pinned immutable dataset. Browser only receives visible bars, with backward pagination and optional server aggregation. Polygon delayed feed uses completed one-minute bars at or before server time minus 15 minutes. Never use previous-day aggregates or generated ticks for fills. Synthetic datasets remain explicitly labeled. Missing required FX halts real-money-denominated conversion in the simulator rather than fabricating a rate.

## Execution and persistence

Separate deterministic execution, market/dataset access and transactional persistence from HTTP handlers. Market orders queue for next eligible bar; limit and stop orders persist and execute in workers. Apply fees/spread/slippage, no worse-than-limit fills, long-only cash assets, reduce-only closes, bracket OCO, reservations, correct weighted cost basis and realized/unrealized P&L. Use Decimal and decimal API strings. Persist financial state, idempotency and outbox atomically in replica-set MongoDB; Redis is reconstructible. Keep old sessions intact and explicitly legacy/read-only when their financial semantics cannot be safely migrated.

## Reliability and verification

Server-owned replay play/pause/step/speed, reload recovery, worker leases and bounded reconnect; delayed processing survives browser closure. Entitlement loss prevents exposure but allows history and reducing risk. No production declaration until real transaction/concurrency/restart tests, browser/mobile/accessibility checks and the approved 100-learner 30-minute load test pass. Preserve existing DRM, pricing, credentials and application DB volume. No push or PR requested.

## Delivery

Implement independently verifiable data, engine/API and terminal increments, then complete drills/admin/reviews and release hardening. A passing unit suite is not production acceptance. Record remaining gaps honestly.
