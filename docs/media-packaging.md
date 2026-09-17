# Local adaptive media packaging

Sprint 3 converts an imported source into an immutable adaptive generation.
Run the operator commands from `backend` after starting the local MongoDB
service:

```powershell
python -m scripts.media caption asset-id "C:\path\to\captions.srt" --language hi --label Hindi
python -m scripts.media package asset-id --generation generation-id
```

For a locally encrypted, session-watermarked generation, use the private-file
workflow in `docs/server-watermarking.md`. Watermarked packaging is fail-closed:
it always requires encryption, and production also requires a watermark.

The pipeline creates H.264/AAC renditions at 360p, 720p, and 1080p when the
source resolution permits them. It never upscales. Ten-second keyframes and
segments are aligned across renditions. Shaka Packager emits both HLS and DASH,
including segmented WebVTT captions, and FFmpeg creates a 320-pixel thumbnail
every ten seconds. A generation is published only when both manifests,
segments, and thumbnails exist and no Packager temporary manifest remains.
Generation IDs and output directories are immutable and cannot be reused.

The runtime images are pinned for reproducibility:

- FFmpeg 8.1.2: `ghcr.io/linuxserver/ffmpeg:8.1.2-cli-ls76` at digest
  `sha256:2e7000921be8de2704a4f27dfd3d988562697a346eaabb937a81046c306f0af7`
- Shaka Packager 3.9.3: `google/shaka-packager:v3.9.3` at digest
  `sha256:3cc287d86a3d291a8b102c636b9c2bdd51f14cdbe7812f79254414e25de897e9`

## Recorded local evidence

On the current 24-logical-CPU Windows development machine, the supplied
728.652-second, 1920x1080 pilot lecture produced generation `pilot-v3` in
168.444 seconds. The generation contains three aligned 183-segment video
renditions, 183 audio segments, 73 thumbnails, Hindi WebVTT captions, and
readable HLS and DASH manifests. FFprobe reported 728.569 seconds for HLS and
728.000 seconds for DASH. Source, transcoded intermediates, and final packages
together occupied 1,313,281,006 bytes.

`pilot-v2` is retained locally as failed evidence: dynamic MPD updates caused
atomic file-replacement errors on a Windows bind mount even though Packager
returned success. The pipeline now asks Packager for one static final MPD and
rejects leftover `packager-tempfile-*` files. `pilot-v3` completed without those
errors.

The recorded `pilot-v3` evidence above is unencrypted. The current pipeline also
supports CENC encryption and pre-encryption server watermark rendering; those
capabilities do not demonstrate Widevine or FairPlay.
