# Local media feasibility release

This release proves the local ChartCoach learner flow with development-only
Clear Key encryption. It does not prove production DRM, cloud scale, high
availability, disaster recovery, or Mux retirement.

## Credential-pending operation

Vendor Widevine and FairPlay credentials are not required to run the local
learner flow. `start-local.ps1` selects `PLAYBACK_PROVIDER=local`, which uses
the encrypted DASH/Clear Key path for development and test. Authorized
learners can therefore play the lesson while vendor applications are pending.
The player labels this mode as development protected playback so it is not
mistaken for production DRM. Inspect the non-secret readiness snapshot at
`GET http://127.0.0.1:8000/health/drm`.

This mode must not be enabled in production. The local provider is refused
outside development/test, and the readiness snapshot remains
`production_ready: false` until a credentialed provider is available and the
server-side renderer has passed the production deployment and device gates.

## Reproduce the learner flow

1. Start the local stack with `./start-local.ps1`.
2. Import and package an operator-owned source using the media commands in
   `docs/media-ingest.md` and `docs/media-packaging.md`.
3. Package the selected generation with `--encrypt`.
4. Publish the protected pilot and optional local enrollment with:

```powershell
Set-Location backend
python -m scripts.import_pilot_lesson `
  --media-asset-id <ready-local-asset-id> `
  --duration-seconds <source-duration-seconds> `
  --caption-url http://127.0.0.1:3000/api/local-lecture/captions.vtt `
  --thumbnail-url http://127.0.0.1:3000/api/local-lecture/poster.jpg `
  --enrollment-email <local-learner-email>
```

The command is idempotent. A local asset must be ready and have a published
generation; it cannot silently fall back to a Mux asset.

5. Sign in as the enrolled learner, open **Test player** from the desktop
sidebar, and complete the lesson flow: play, change speed, seek, answer each
required check, leave, reload, and resume.

**Test player** opens the protected local playback route and therefore keeps
the normal sign-in and enrollment checks. The separate **Preview video (no
DRM)** link is a development-only plain-video preview for visual checks; it
does not exercise encrypted playback or grant protected-lesson access.

## Failure checks

Run `.\verify-local-feasibility.ps1 -IncludePersistence` from the repository
root for the automated release gate, live credential-pending readiness check,
and MongoDB persistence check. The complete clean-start procedure, exact
failure commands, expected results, recovery boundaries, and manual learner
acceptance are in `docs/local-feasibility-verification.md`.

The automated suite covers corrupt ingestion, duplicate import, interrupted
leased jobs, interrupted packaging cleanup, missing package output, traversal
attempts, expired/rotated sessions, anonymous requests, unenrolled learners,
invalid progress, invalid prompt answers, unavailable local keys, and the
production watermark fail-safe. Packaging is still a synchronous operator
command (not an automatically resumed leased job), but failed commands clean
their unpublished generation before retry.

For a local service incident, inspect `.local/backend.err.log`,
`.local/frontend.err.log`, Docker Mongo logs, and the media processing job
record. These logs must contain only sanitized failure reasons: never add
wrapping secrets, content keys, DRM tokens, or signed media URLs.

## Real DRM handoff

The `CredentialedDrmAdapter` boundary accepts only HTTPS manifest, Widevine
license, FairPlay license, and FairPlay certificate URLs plus an expiry. A
vendor implementation belongs behind that adapter after contract review and
credential approval. The test double verifies the handoff shape without
claiming live DRM playback.

Before a credentialed release, retain physical-device evidence for Windows,
Android, macOS, iPhone, and iPad: packaging, license exchange, renewal, expiry,
captions, speed changes, seeking, fullscreen, foreground/background behavior,
and player remounting. Development Clear Key results do not satisfy that gate.
Use `docs/drm-device-matrix.md` as the status and evidence record. Widevine and
FairPlay rows remain `CREDENTIAL BLOCKED` until the actual external material is
available; they cannot be waived by mocks or Clear Key results.

## Watermarking guardrail

Packaging uses aligned 10-second media segments. The in-house renderer burns a
masked visible label plus a session-bound HMAC identifier into each clear
rendition before CENC encryption. Its identity file is ephemeral, and neither
the learner email nor watermark secret is stored in media-generation records or
FFmpeg command arguments. Watermarked output without encryption is refused;
production output without a watermark is also refused. See
`docs/server-watermarking.md` for the local operator flow and the explicit limit
on screen-capture prevention claims.
