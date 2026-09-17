# Local feasibility verification

This runbook is the Sprint 6 evidence gate for the local ChartCoach media
platform. It verifies everything that can be established without Widevine or
FairPlay credentials. It must not be used to claim production DRM readiness.

## Evidence labels

- **Automated** means a checked-in deterministic test covers the behavior.
- **Local observation** means an operator must record the date, command,
  machine, asset or session ID, and sanitized result.
- **Credential-blocked** means the check cannot pass until the named vendor
  access exists. A mock, Clear Key result, or browser emulation cannot change
  that label.

Store evidence outside Git when it contains account identifiers, local paths,
signed URLs, license exchanges, or media. Never record content keys, wrapping
secrets, cookies, JWTs, or raw DRM tokens.

## Automated release gate

Install the pinned backend and frontend dependencies, start the local stack,
then run from the repository root:

```powershell
.\verify-local-feasibility.ps1 -IncludePersistence
```

The script runs the complete backend suite, frontend suite, frontend production
build, live health checks, and MongoDB persistence integration check. Use
`-SkipLive` only in CI or when deliberately testing code without a running
stack; the resulting evidence does not establish live local readiness.

The live readiness assertion requires all of the following:

```text
provider=local
mode=development-clear-key
playable=true
credentials_status=pending
production_ready=false
blocking_reasons includes widevine_credentials_pending
blocking_reasons includes fairplay_credentials_pending
```

This is the required credential-pending state. Do not edit the readiness label
to `ready` to make a release gate pass.

## Clean-start reproduction

Use a disposable clone or machine for this check because the Compose file uses
the fixed `chartcoach-local-mongo-data` volume name. Do not delete the working
developer volume to simulate a clean host.

1. Confirm Docker Desktop uses the Linux engine and that ports 3000, 8000, and
   27018 are free.
2. Install the pinned dependencies:

   ```powershell
   python -m pip install -r backend/requirements.txt -r backend/requirements-test.txt
   Push-Location frontend
   npm ci
   Pop-Location
   ```

3. Confirm `.local`, `.media`, source lectures, and generated packages were not
   copied from another checkout.
4. Run `.\start-local.ps1`.
5. Confirm `GET /health` succeeds and `GET /health/drm` returns the exact
   credential-pending state above.
6. Register an account, import and encrypt a short operator-owned fixture,
   publish the pilot lesson with an enrollment, and play at least two segments.
7. Stop with `.\stop-local.ps1`, start again, sign in with the same account,
   and confirm resume position and protected playback survive.
8. Run `.\verify-local-feasibility.ps1 -IncludePersistence`.

Record the Git commit, Docker version, Windows build, Node and Python versions,
test counts, and the final readiness JSON. A clean start passes only if no
manual secret or database repair was needed after the documented commands.

## Failure matrix

| Scenario | Repeatable check | Required result | Evidence |
|---|---|---|---|
| Corrupt source or encoding input failure | `python -m pytest tests/test_media_ingest.py::test_import_rejects_corrupt_source_without_persisting_or_copying -q` from `backend` | Import is rejected and neither an asset nor a source copy is published. | Automated |
| Encoding/package command failure | Run packaging only against a disposable asset/generation and interrupt its FFmpeg or Packager container. Then inspect MongoDB and `.media/outputs`. | The prior published generation stays selected; interrupted output is never published. Record any incomplete generation cleanup needed before retry. | Local observation; see open limitation below |
| Missing or partial package output | `python -m pytest tests/test_media_packaging.py::test_generation_validator_requires_both_manifests_and_segments -q` | A generation without both manifests, segments, thumbnails, or with Packager temporary files fails validation. | Automated |
| Worker interruption | `python -m pytest tests/test_media_ingest.py::test_expired_running_job_can_be_reclaimed_without_overwriting_publication -q` | Another worker cannot claim a live lease; it can reclaim an expired lease without changing published output. | Automated |
| Invalid worker completion | `python -m pytest tests/test_media_ingest.py::test_worker_completion_and_failure_require_the_active_lease -q` | A non-owner cannot complete the job; the stored failure reason is sanitized; an operator can requeue a failed job. | Automated |
| Expired or rotated authorization | `python -m pytest tests/test_media_delivery_api.py::test_media_delivery_rejects_wrong_user_expiry_rotation_and_traversal -q` | Wrong user, expired session, rotated session, and traversal requests cannot receive media or a key. | Automated |
| Database restart | With the stack running, execute `docker compose --env-file .local/local.env -f compose.local.yml restart mongo`, wait for health, then run `.\verify-local-feasibility.ps1 -IncludePersistence`. | The account, progress, assets, and marker remain accessible after a fresh client and Mongo restart. | Automated integration plus local observation |
| Key service unavailable | `python -m pytest tests/test_media_keys.py::test_development_key_broker_requires_a_wrapping_secret tests/test_media_keys.py::test_development_key_broker_is_refused_in_production -q` | Missing local wrapping secret fails closed; the development broker is refused in production. | Automated |
| Vendor credentials absent | `python -m pytest tests/test_drm_readiness.py -q`, then inspect `GET /health/drm`. | Local Clear Key remains playable, both vendor credentials remain pending, and `production_ready` remains false. | Automated plus live observation |
| Server watermark render path | `python -m pytest tests/test_media_packaging.py::test_server_watermark_is_rendered_before_cenc_without_leaking_identity tests/test_media_cli.py::test_cli_watermark_identity_reads_email_from_file_without_returning_raw_email -q` | A masked, session-bound watermark is applied before CENC; the raw email and ephemeral overlay input do not persist in generation metadata. | Automated |
| Server watermark renderer absent | `python -m pytest tests/test_learning_service.py::test_production_watermark_mode_fails_closed_without_renderer tests/test_media_packaging.py::test_production_packaging_fails_closed_without_server_watermark tests/test_media_packaging.py::test_production_watermarked_packaging_fails_closed_without_encryption -q` | Production authorization and packaging refuse unwatermarked or unencrypted output. | Automated |

### Open interruption limitation

The leased ingest worker has deterministic interruption recovery. Adaptive
packaging currently runs synchronously rather than as a durable leased job.
FFmpeg, caption, thumbnail, and Packager command failures now remove only the
unpublished generation directory, preserving the asset's prior publication and
making the same generation ID retryable. A process killed between steps can
still require an operator to rerun the package command; this is deterministic
cleanup, not automatic encoding retry or lease-based resumption.

## Manual learner acceptance

Use an enrolled, active local account and an encrypted generation. Record a
pass or fail for each item:

- protected DASH manifest and encrypted segments load through session-scoped
  endpoints;
- an anonymous or unenrolled account cannot start playback;
- speed selection, captions, transcript highlight, chapters, and fullscreen
  work together;
- seeking cannot exceed naturally watched progress and cannot bypass a required
  prompt;
- an incorrect answer shows feedback and allows a retry;
- renewal rotates the old session without interrupting authorized viewing;
- progress and an unfinished prompt survive a complete stack restart;
- completion requires at least 90 percent verified coverage and every required
  prompt passed;
- no secret, raw token, full email address, or host filesystem path appears in
  browser-visible errors or stored logs.

## Exit criteria

Sprint 6 credential-independent evidence is complete when the automated gate,
clean-start reproduction, failure matrix, and manual learner acceptance all
have retained results. Widevine/FairPlay rows remain `CREDENTIAL BLOCKED`, not
failed and not waived. See `docs/drm-device-matrix.md` for the handoff record.
