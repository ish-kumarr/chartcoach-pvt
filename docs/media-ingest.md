# Local media ingestion

Sprint 2 imports immutable source video into `.media/sources`, records stable
metadata in MongoDB, and validates work through a single leased worker. The
`.media/` directory is ignored by Git. Learner APIs never receive host paths.

Run commands from `backend` with `DATABASE_URL` and `DATABASE_NAME` configured:

```powershell
python -m scripts.media import "C:\path\to\lecture.mp4"
python -m scripts.media status asset-id
python -m scripts.media worker --once
python -m scripts.media worker
python -m scripts.media retry job-id
```

`worker --once` is useful for local demonstrations. Without `--once`, one
worker polls for queued jobs. A running job has a bounded lease; another worker
can claim it only after that lease expires. Worker failures store a sanitized
reason, never the probe command, host path, credentials, or raw stderr.

Source identity is its SHA-256 checksum. Importing identical bytes returns the
existing asset and job and does not overwrite the immutable stored copy.
Sources, generated packages, and partial files remain outside Git.

The supplied pilot lecture was imported as
`asset-b4952c897eecb466da2b8e9b`: 728.652 seconds, 1920×1080 H.264 video and
stereo AAC audio. A repeated import returned the same ID, and validation moved
its one probe job to `succeeded` and the asset to `ready_for_encoding`.

This sprint uses the installed local `ffprobe` binary. Sprint 3 pins FFmpeg and
Shaka Packager in containers and adds the Docker-mounted encoding/output path;
this ingestion sprint does not yet claim reproducible transcoding or playback.
