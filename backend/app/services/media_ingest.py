"""Durable local media ingestion and leased processing-job primitives."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol

from pymongo import ReturnDocument


class InvalidMediaSource(ValueError):
    pass


class MediaProbe(Protocol):
    def inspect(self, path: Path) -> dict[str, Any]: ...


class FFprobeMediaProbe:
    def __init__(self, executable: str = "ffprobe") -> None:
        self.executable = executable

    def inspect(self, path: Path) -> dict[str, Any]:
        result = subprocess.run(
            [
                self.executable,
                "-v",
                "error",
                "-show_format",
                "-show_streams",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            raise InvalidMediaSource("source could not be probed")
        try:
            raw = json.loads(result.stdout)
            duration = float(raw.get("format", {}).get("duration", 0))
            streams = raw.get("streams", [])
        except (TypeError, ValueError, json.JSONDecodeError):
            raise InvalidMediaSource("source probe returned invalid metadata") from None
        if duration <= 0 or not any(stream.get("codec_type") == "video" for stream in streams):
            raise InvalidMediaSource("source must contain a valid video stream")
        return {"duration_seconds": duration, "streams": streams}


class FileMediaStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        (self.root / "sources").mkdir(parents=True, exist_ok=True)
        (self.root / "outputs").mkdir(parents=True, exist_ok=True)

    def store_source(self, source: Path, checksum: str) -> str:
        suffix = source.suffix.lower() or ".bin"
        key = f"sources/{checksum}{suffix}"
        target = self.root / key
        if not target.exists():
            temporary = target.with_suffix(target.suffix + ".partial")
            shutil.copyfile(source, temporary)
            temporary.replace(target)
        return key

    def resolve(self, key: str) -> Path:
        candidate = (self.root / key).resolve()
        if self.root not in candidate.parents:
            raise ValueError("storage key escapes the media root")
        return candidate


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class MediaIngestService:
    def __init__(self, db: Any, storage: FileMediaStorage, probe: MediaProbe) -> None:
        self.db = db
        self.storage = storage
        self.probe = probe

    def import_source(self, source_path: Path) -> dict[str, Any]:
        source = source_path.resolve()
        if not source.is_file():
            raise InvalidMediaSource("source file was not found")
        checksum = _sha256(source)
        existing = self.db.media_assets.find_one({"source_checksum": checksum})
        if existing:
            return existing
        metadata = self.probe.inspect(source)
        source_key = self.storage.store_source(source, checksum)
        now = datetime.now(timezone.utc)
        asset_id = f"asset-{checksum[:24]}"
        asset = {
            "id": asset_id,
            "source_provider": "local",
            "source_checksum": checksum,
            "source_key": source_key,
            "state": "ingested",
            "duration_seconds": metadata["duration_seconds"],
            "streams": metadata["streams"],
            "created_at": now,
            "updated_at": now,
        }
        self.db.media_assets.insert_one(asset)
        self.db.processing_jobs.insert_one(
            {
                "id": f"probe-{asset_id}",
                "asset_id": asset_id,
                "stage": "probe",
                "state": "queued",
                "attempts": 0,
                "created_at": now,
                "updated_at": now,
            }
        )
        return asset

    def attach_caption(
        self,
        asset_id: str,
        caption_path: Path,
        *,
        language: str,
        label: str,
    ) -> dict[str, str]:
        if not re.fullmatch(r"[A-Za-z0-9-]+", language):
            raise InvalidMediaSource("caption language is invalid")
        if not label or len(label) > 100 or any(character in label for character in ",\r\n"):
            raise InvalidMediaSource("caption label is invalid")
        caption = caption_path.resolve()
        if not caption.is_file() or "-->" not in caption.read_text(encoding="utf-8-sig", errors="replace"):
            raise InvalidMediaSource("caption file is not a recognized timed-text source")
        if not self.db.media_assets.find_one({"id": asset_id}):
            raise InvalidMediaSource("media asset was not found")
        checksum = _sha256(caption)
        record = {
            "language": language,
            "label": label,
            "source_checksum": checksum,
            "source_key": self.storage.store_source(caption, checksum),
        }
        self.db.media_assets.update_one({"id": asset_id}, {"$addToSet": {"captions": record}})
        return record


class ProcessingJobWorker:
    def __init__(self, db: Any, *, worker_id: str, lease_seconds: int = 60) -> None:
        self.db = db
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds

    def claim(self, now: datetime | None = None) -> dict[str, Any] | None:
        claimed_at = now or datetime.now(timezone.utc)
        return self.db.processing_jobs.find_one_and_update(
            {
                "$or": [
                    {"state": "queued"},
                    {"state": "running", "lease_expires_at": {"$lte": claimed_at}},
                ]
            },
            {
                "$set": {
                    "state": "running",
                    "worker_id": self.worker_id,
                    "lease_expires_at": claimed_at + timedelta(seconds=self.lease_seconds),
                    "updated_at": claimed_at,
                },
                "$inc": {"attempts": 1},
            },
            sort=[("created_at", 1)],
            return_document=ReturnDocument.AFTER,
        )

    def _finish(self, job_id: str, state: str, **fields: Any) -> None:
        now = datetime.now(timezone.utc)
        result = self.db.processing_jobs.update_one(
            {"id": job_id, "state": "running", "worker_id": self.worker_id},
            {
                "$set": {"state": state, "updated_at": now, **fields},
                "$unset": {"lease_expires_at": ""},
            },
        )
        if result.modified_count != 1:
            raise RuntimeError("processing job lease is not active")

    def succeed(self, job_id: str) -> None:
        self._finish(job_id, "succeeded")

    def fail(self, job_id: str, private_reason: str | None = None) -> None:
        self._finish(job_id, "failed", failure_reason="media processing failed")

    def retry(self, job_id: str) -> None:
        result = self.db.processing_jobs.update_one(
            {"id": job_id, "state": "failed"},
            {
                "$set": {"state": "queued", "updated_at": datetime.now(timezone.utc)},
                "$unset": {"worker_id": "", "failure_reason": "", "lease_expires_at": ""},
            },
        )
        if result.modified_count != 1:
            raise RuntimeError("only failed processing jobs can be retried")

    def run_once(self, storage: FileMediaStorage, probe: MediaProbe) -> bool:
        job = self.claim()
        if not job:
            return False
        try:
            asset = self.db.media_assets.find_one({"id": job["asset_id"]})
            if not asset:
                raise InvalidMediaSource("media asset was not found")
            source = storage.resolve(asset["source_key"])
            if not source.is_file() or _sha256(source) != asset["source_checksum"]:
                raise InvalidMediaSource("stored source checksum is invalid")
            metadata = probe.inspect(source)
            self.db.media_assets.update_one(
                {"id": asset["id"]},
                {
                    "$set": {
                        "state": "ready_for_encoding",
                        "duration_seconds": metadata["duration_seconds"],
                        "streams": metadata["streams"],
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )
            self.succeed(job["id"])
        except Exception:
            self.fail(job["id"])
        return True
