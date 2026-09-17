# Practice Simulator testing release

This document records the approved `/trade` testing-release scope. All market
data remains labeled synthetic/test data until a separately approved provider
contract, credentials, coverage, and budget are in place.

## Completed foundation slice

- [x] Authenticated Trader/Pro/Elite simulator bootstrap with a ₹10 lakh INR account.
- [x] 40-instrument, multi-asset synthetic catalog and replay dataset manifest.
- [x] Server-owned replay/delayed session snapshots, candles, replay controls, fork marker, journal, and deterministic review baseline.
- [x] Orders, fills, positions, ledger records, idempotency-key conflict protection, amend/cancel, and reduce-only closes.
- [x] Learner `/trade` workspace, legacy `/simulator` redirect, and beginner/advanced workspace switch.
- [x] Admin-protected published drill baseline with bilingual title fields.

## Required before release acceptance

- [ ] Split execution, ledger, replay, and assessment logic into transaction-backed domain services; use a MongoDB replica set.
- [ ] Add Redis worker processes, WebSocket event sequence/reconnect, and delayed-clock processing.
- [ ] Implement the complete order engine: brackets, stops, pending-order eligibility, costs, FX, margin, liquidation, expiry, and settlement.
- [ ] Add validated immutable dataset import/manifests and prevent future data leakage across candles, indicators, and reviews.
- [ ] Complete drill draft/preview/version/retire flows, deterministic rubric rules, and course-progression hooks.
- [ ] Build full advanced/mobile chart tooling, indicator/drawing persistence, accessibility audit, and admin UI.
- [ ] Add provider-gated optional AI reviews, metrics, recovery tests, and the 100-active-learner 30-minute load test.

## Verification record

- `npm test -- --run src/lib/simulator.test.ts`
- `npm run build`
- `python -m pytest -q` from `backend`

The legacy `unittest discover` command needs configured `DATABASE_URL` and
`JWT_SECRET_KEY`; use the project pytest suite for isolated test configuration.
