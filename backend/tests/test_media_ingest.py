from datetime import datetime, timedelta, timezone
from pathlib import Path

import mongomock
import pytest

from app.services.media_ingest import (
    FileMediaStorage,
    InvalidMediaSource,
    MediaIngestService,
    ProcessingJobWorker,
)


class Probe:
    def inspect(self, path: Path):
        if path.read_bytes() == b"corrupt":
            raise InvalidMediaSource("source could not be probed")
        return {
            "duration_seconds": 12.5,
            "streams": [{"codec_type": "video", "codec_name": "h264", "width": 640, "height": 360}],
        }


def test_import_is_durable_checksum_deduplicated_and_does_not_overwrite(tmp_path):
    db = mongomock.MongoClient().chartcoach
    incoming = tmp_path / "incoming.mp4"
    incoming.write_bytes(b"valid-video")
    service = MediaIngestService(db, FileMediaStorage(tmp_path / "media"), Probe())

    first = service.import_source(incoming)
    stored_path = tmp_path / "media" / first["source_key"]
    original = stored_path.read_bytes()
    incoming.write_bytes(b"valid-video")
    second = service.import_source(incoming)

    assert second["id"] == first["id"]
    assert db.media_assets.count_documents({}) == 1
    assert db.processing_jobs.count_documents({}) == 1
    assert stored_path.read_bytes() == original


def test_import_rejects_corrupt_source_without_persisting_or_copying(tmp_path):
    db = mongomock.MongoClient().chartcoach
    incoming = tmp_path / "broken.mp4"
    incoming.write_bytes(b"corrupt")
    storage = FileMediaStorage(tmp_path / "media")

    with pytest.raises(InvalidMediaSource, match="probed"):
        MediaIngestService(db, storage, Probe()).import_source(incoming)

    assert db.media_assets.count_documents({}) == 0
    assert list((tmp_path / "media" / "sources").glob("*")) == []


def test_expired_running_job_can_be_reclaimed_without_overwriting_publication():
    db = mongomock.MongoClient().chartcoach
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    db.processing_jobs.insert_one(
        {"id": "job-1", "asset_id": "asset-1", "state": "queued", "attempts": 0}
    )
    first = ProcessingJobWorker(db, worker_id="worker-a", lease_seconds=30).claim(now)
    assert first["state"] == "running"
    assert ProcessingJobWorker(db, worker_id="worker-b", lease_seconds=30).claim(now) is None

    retried = ProcessingJobWorker(db, worker_id="worker-b", lease_seconds=30).claim(
        now + timedelta(seconds=31)
    )
    assert retried["worker_id"] == "worker-b"
    assert retried["attempts"] == 2
    assert db.media_assets.count_documents({"published_generation_id": {"$exists": True}}) == 0


def test_worker_completion_and_failure_require_the_active_lease():
    db = mongomock.MongoClient().chartcoach
    db.processing_jobs.insert_one(
        {"id": "job-1", "asset_id": "asset-1", "state": "queued", "attempts": 0}
    )
    worker = ProcessingJobWorker(db, worker_id="worker-a")
    worker.claim()

    with pytest.raises(RuntimeError, match="lease"):
        ProcessingJobWorker(db, worker_id="worker-b").succeed("job-1")
    worker.fail("job-1", "probe failed for C:/private/source.mp4?token=secret")
    failed = db.processing_jobs.find_one({"id": "job-1"})
    assert failed["state"] == "failed"
    assert failed["failure_reason"] == "media processing failed"

    worker.retry("job-1")
    assert db.processing_jobs.find_one({"id": "job-1"})["state"] == "queued"


def test_worker_validates_the_stored_source_before_marking_it_ready(tmp_path):
    db = mongomock.MongoClient().chartcoach
    incoming = tmp_path / "lecture.mp4"
    incoming.write_bytes(b"valid-video")
    storage = FileMediaStorage(tmp_path / "media")
    asset = MediaIngestService(db, storage, Probe()).import_source(incoming)

    assert ProcessingJobWorker(db, worker_id="worker-a").run_once(storage, Probe()) is True
    assert db.processing_jobs.find_one({"asset_id": asset["id"]})["state"] == "succeeded"
    assert db.media_assets.find_one({"id": asset["id"]})["state"] == "ready_for_encoding"


def test_caption_attachment_is_checksum_backed_and_idempotent(tmp_path):
    db = mongomock.MongoClient().chartcoach
    db.media_assets.insert_one({"id": "asset-1"})
    caption = tmp_path / "captions.srt"
    caption.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")
    service = MediaIngestService(db, FileMediaStorage(tmp_path / "media"), Probe())

    first = service.attach_caption("asset-1", caption, language="hi", label="Hindi")
    second = service.attach_caption("asset-1", caption, language="hi", label="Hindi")

    assert first == second
    assert db.media_assets.find_one({"id": "asset-1"})["captions"] == [first]

    with pytest.raises(InvalidMediaSource, match="language"):
        service.attach_caption("asset-1", caption, language="hi,role=evil", label="Hindi")
    with pytest.raises(InvalidMediaSource, match="label"):
        service.attach_caption("asset-1", caption, language="hi", label="Hindi,role=evil")
