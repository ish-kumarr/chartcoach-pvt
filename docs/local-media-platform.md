# Local media-platform environment

This environment keeps the Next.js frontend and FastAPI backend native while
running MongoDB in Docker. It is the reproducible baseline for the local media
platform sprints; it does not enable production DRM.

## Requirements

- Docker Desktop with the Linux engine running
- Python with `backend/requirements.txt` and `backend/requirements-test.txt`
- Node.js with `frontend/package-lock.json` installed
- Ports 3000, 8000, and 27018 available on loopback

The checked host had 24 logical CPUs and 32 GB system RAM. Docker had 16 GB
available. MongoDB is limited to 2 CPUs and 2 GB; later encoding-worker limits
will be based on measured processing benchmarks.

Install frontend dependencies once in each Git worktree:

```powershell
Set-Location frontend
npm ci
```

## Start and stop

From the repository root:

```powershell
.\start-local.ps1
```

On first start, the script creates `.local/local.env` with random local MongoDB
and JWT credentials. `.local/` is ignored by Git. The browser app is available
at `http://127.0.0.1:3000`; the API is at `http://127.0.0.1:8000`.

Stop processes without deleting data:

```powershell
.\stop-local.ps1
```

The launcher checks ports 3000, 8000, and 27018 before starting and waits for
both application health checks. It fails with the owning process ID if another
stack is still running. Shutdown terminates the complete frontend/backend child
process trees so a restart cannot silently serve stale code.

MongoDB data is stored in the named Docker volume
`chartcoach-local-mongo-data`. `docker compose stop` and ordinary Docker
Desktop restarts preserve it. Deleting that volume is destructive and is not
part of normal shutdown.

Inspect service state and logs with:

```powershell
docker compose --env-file .local/local.env -f compose.local.yml ps
docker compose --env-file .local/local.env -f compose.local.yml logs mongo
```

Frontend and backend output is stored in `.local/backend.out.log`,
`.local/backend.err.log`, `.local/frontend.out.log`, and
`.local/frontend.err.log`. PID files in `.local/` allow `stop-local.ps1` to
stop the processes it launched.

## Persistence acceptance check

Read `.local/local.env`, construct the same loopback MongoDB URL used by
`start-local.ps1`, and run:

```powershell
$values = @{}
Get-Content .local/local.env | ForEach-Object {
    $key, $value = $_.Split("=", 2)
    $values[$key] = $value
}
$env:LOCAL_MONGODB_TEST_URL = "mongodb://$($values.CHARTCOACH_MONGO_USERNAME):$($values.CHARTCOACH_MONGO_PASSWORD)@127.0.0.1:27018/?authSource=admin"
Set-Location backend
python -m pytest tests/integration/test_persistent_mongo.py -q
```

For account persistence, register a local account, run `stop-local.ps1`, start
again, and log in with the same account. The account remains because ordinary
shutdown preserves the MongoDB volume.

## Modes and secrets

`mongomock://local` remains an explicit in-memory test mode. Runtime connection
errors never fall back to it. Local credentials, source lectures, generated
media, vendor credentials, and SDK packages must remain outside Git.

The local launcher sets `DRM_CREDENTIALS_STATUS=pending` explicitly. This is a
readiness label only: local encrypted playback remains available for testing,
while vendor Widevine/FairPlay playback is not considered production-ready.

Widevine and FairPlay applications are an organizational task and run in
parallel with local engineering. Until approved credentials exist, later local
encryption uses a clearly labelled development-only path and cannot establish
production DRM compatibility.

## Playback provider migration

The backend defaults to `PLAYBACK_PROVIDER=mux`. `local` is accepted only when
`APP_ENVIRONMENT` is `development` or `test`; production startup refuses that
selection. Existing Mux lessons can be linked to stable internal media asset
records idempotently from `backend`:

```powershell
python -m scripts.migrate_media_assets
```

The existing `POST /learning/lessons/{lessonId}/playback` endpoint remains as a
compatibility route. New clients use `POST
/learning/lessons/{lessonId}/playback-sessions` and renew via `POST
/learning/lessons/{lessonId}/playback-sessions/{sessionId}/renew`.

See `docs/media-ingest.md` for the local asset import, status, worker, and retry
commands introduced in Sprint 2.

See `docs/media-packaging.md` for the pinned adaptive encoding pipeline,
operator commands, validation rules, and measured Sprint 3 evidence.

See `docs/local-feasibility-release.md` for the Sprint 5 learner-flow runbook,
Sprint 6 failure checks, and the explicit boundary before credentialed DRM.

Run `.\verify-local-feasibility.ps1 -IncludePersistence` for the repeatable
credential-independent release gate. The detailed clean-start and failure
matrix is in `docs/local-feasibility-verification.md`; physical-device and
vendor-credential status is tracked in `docs/drm-device-matrix.md`.
