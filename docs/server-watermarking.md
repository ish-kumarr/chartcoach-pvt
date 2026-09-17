# In-house server watermarking contract

The local packaging worker now burns a session-bound visible watermark into
every rendition before CENC encryption. It uses an ephemeral FFmpeg text input,
so neither the masked identity nor the watermark secret appears in command
arguments or media-generation records. The text input is removed immediately
after transcoding.

This is an in-house visible tracing control, not a claim that browser or
operating-system screen capture is impossible. A separately validated invisible
forensic detector remains a later hardening layer.

## Required worker behavior

For every authorized playback session, the worker must:

1. Validate the short-lived session and obtain the session-bound watermark
   identity from the backend.
2. Render the masked email continuously into every video rendition, using a
   safe-area position that rotates on a fixed schedule.
3. Include a shortened session-bound forensic identifier beside the masked
   identity on every frame. A future invisible detector must be tested against
   scaling, re-encoding, bitrate changes, cropping attempts, segment extraction,
   and screen capture before it is described as resilient forensic watermarking.
4. Produce aligned 10-second segments and encrypt them before publication.
5. Publish only an immutable, session-scoped generation whose expiry matches
   the authorization session.

If any stage fails, the session must remain unavailable. There is no fallback to
the unwatermarked generation.

## Guardrails

- Keep the unwatermarked source and base generations inaccessible to learner
  sessions.
- Do not log raw email addresses, watermark payloads, DRM keys, or signed media
  URLs.
- Bound the worker queue and segment-ahead window; return a retryable overload
  response instead of building unbounded personalized media.
- Delete expired session generations and rotate forensic secrets separately
  from content keys.
- Record sanitized render latency, failures, and detector-validation results.

## Local operator command

Keep the learner email in a private file outside Git; do not place it directly
on the command line. From `backend`:

```powershell
$env:APP_ENVIRONMENT = "development"
$env:WATERMARK_SECRET = "<local watermark signing secret>"
$env:LOCAL_MEDIA_WRAPPING_SECRET = "<local key-wrapping secret>"
python -m scripts.media package <asset-id> `
  --generation <session-scoped-generation-id> `
  --encrypt `
  --watermark-email-file <private-email-file> `
  --watermark-session <playback-session-id>
```

The generated overlay remains visible, moves between safe-area corners on a
fixed schedule, retains the existing aligned 10-second segments, and is
encrypted only after rendering. A watermarked generation without encryption is
refused in every environment. Production packaging additionally refuses any
generation without a server watermark identity.
