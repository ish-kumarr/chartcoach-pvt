# Development Clear Key playback

Sprint 4 adds an encrypted local playback path for development and integration
testing. It is intentionally unavailable outside the `development` and `test`
environments and is not a substitute for Widevine or FairPlay.

Run encrypted packaging from `backend` after the local stack is configured:

```powershell
python -m scripts.media package asset-id --generation generation-id --encrypt
```

`start-local.ps1` creates a local wrapping secret on first use and keeps it in
the ignored `.local/local.env` file. Content keys are generated per asset and
stored in MongoDB only as AES-GCM ciphertext, nonce, and key ID. The wrapping
secret, plaintext content keys, source lectures, and generated packages must
never be committed.

An authenticated learner requests a playback session through the learning API.
The backend checks that the account is active, the enrollment is active, the
lesson is published, and the media generation is ready. It then returns
session-scoped DASH and Clear Key URLs. Media and key requests repeat the user,
session, expiry, asset, and generation checks. Renewal rotates the prior
session, so its URLs immediately stop working.

## Recorded local evidence

Generation `pilot-clearkey-v1` was packaged from the supplied pilot lecture in
179.993 seconds and produced 1,309,774,533 bytes of encrypted output. Its DASH
manifest includes CENC content protection. A real Chromium session successfully
requested a protected manifest, obtained a temporary Clear Key license, fetched
encrypted segments, and advanced playback from 0:00 to 0:13. Renewal produced a
new session and the old session returned 403; anonymous and unenrolled requests
also returned 403.

The current Shaka Packager build does not emit CENC HLS with identity key
signaling, so development Clear Key playback uses DASH. Widevine and FairPlay
remain a separate credentialed acceptance gate.
