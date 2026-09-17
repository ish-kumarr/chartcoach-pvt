# Simulator infrastructure report

## Status

Implemented the isolated local simulator MongoDB transaction infrastructure in
the owned compose/config/docs files, plus the requested startup service and
explicit simulator environment settings. Existing application MongoDB and
Redis services/volumes were preserved. No dependencies, app startup, API,
worker, service, or frontend files were changed.

Removed the committed Polygon credential fallback from `backend/app/config.py`;
the key is now empty by default and must be supplied through the backend
environment when Polygon access is intentionally enabled.

## Tests

- `docker compose -f compose.local.yml config --quiet` -> exit 0.
- `docker compose -f compose.local.yml up -d simulator-mongo` -> simulator
  service started; healthcheck -> healthy/PRIMARY.
- Real Mongo transaction probe in a uniquely named temporary database -> commit
  and abort verified; temporary database dropped afterward.
- Settings smoke check with process-local dummy required values and explicit
  dummy Polygon key -> simulator defaults verified.
- `git diff --check` -> clean.
- Validation used only `docker compose ... up -d simulator-mongo`; neither
  `start-local.ps1` nor the application MongoDB service was restarted.

## Commit

- Commit: `3ce50a0` (`Add isolated simulator Mongo transaction infrastructure`).
