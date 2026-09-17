# Local simulator infrastructure

This setup provides a dedicated MongoDB replica set for simulator transaction
development. It is intentionally isolated from the application MongoDB service.

## Services and persistence

`simulator-mongo` runs `mongo:8.0.14` as a single-node replica set named
`simulator-rs` on container port `27019`, published only on
`127.0.0.1:27019`. Its data is stored in the separately named Docker volume
`chartcoach-simulator-mongo`. The existing `mongo` service and
`chartcoach-local-mongo-data` volume are not used or modified by this service.

The service healthcheck is also the idempotent initializer: it attempts
`rs.initiate` only when replica-set status is unavailable, then reports healthy
only after a member is `PRIMARY`. Re-running compose or restarting this service
does not reset either database.

Existing `simulator-redis` remains on `127.0.0.1:6380` with its existing
`chartcoach-simulator-redis` volume.

## Local settings

The backend defaults are:

```text
SIMULATOR_DATABASE_URL=mongodb://127.0.0.1:27019/?replicaSet=simulator-rs&directConnection=true
SIMULATOR_DATABASE_NAME=chartcoach_simulator
```

`start-local.ps1` passes these same values to its locally launched backend and
worker processes. It does not change the application `DATABASE_URL`.

If Polygon-backed historical data is enabled, configure `POLYGON_API_KEY` in
the backend `.env` or process environment. There is no committed credential
default; tests that exercise request construction must provide an explicit
dummy key.

## Explicit boundary

This is a localhost, no-auth development setup for transaction testing. It is
not a production deployment: it has no authentication, TLS, multi-node
replication, backup policy, or production hardening. Do not expose port 27019
or reuse these defaults outside local development.

## Start and validate

From this worktree, use the repository's local environment file for compose
variable resolution without printing it:

```powershell
docker compose --env-file ..\..\.local\local.env -f compose.local.yml up -d --wait simulator-mongo
docker compose --env-file ..\..\.local\local.env -f compose.local.yml ps simulator-mongo
```

The simulator service can be started independently; do not restart the
application MongoDB service when validating simulator transactions. A
transaction check should use a uniquely named temporary database, verify both
commit and abort, and remove only that temporary database afterward.
