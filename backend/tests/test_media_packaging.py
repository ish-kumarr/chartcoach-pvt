from pathlib import Path

import mongomock
import pytest

from app.services.media_packaging import MediaPackagingService, plan_renditions, validate_generation
from app.services.watermarking import build_watermark_identity


@pytest.fixture(autouse=True)
def packaged_source_fixture(tmp_path):
    source = tmp_path / "sources" / "source.mp4"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"source")


class Runner:
    def __init__(self):
        self.commands = []

    def run(self, command):
        self.commands.append(command)


class FailingRunner(Runner):
    def __init__(self, fail_on: int = 1):
        super().__init__()
        self.fail_on = fail_on

    def run(self, command):
        super().run(command)
        if len(self.commands) == self.fail_on:
            raise RuntimeError("packaging command failed")


class KeyBroker:
    def get_or_create(self, asset_id):
        assert asset_id == "asset-1"
        return {
            "kid_hex": "00112233445566778899aabbccddeeff",
            "key_hex": "ffeeddccbbaa99887766554433221100",
            "kid": "ABEiM0RVZneImaq7zN3u_w",
            "key": "_-7dzLuqmYh3ZlVEMyIRAA",
        }


class WatermarkInspectingRunner(Runner):
    def __init__(self, overlay_path):
        super().__init__()
        self.overlay_path = overlay_path
        self.rendered_text = None

    def run(self, command):
        super().run(command)
        if any("drawtext=" in part for part in command):
            self.rendered_text = self.overlay_path.read_text(encoding="utf-8")


def test_rendition_plan_never_upscales_and_uses_expected_ladder():
    assert [item.height for item in plan_renditions(1080)] == [360, 720, 1080]
    assert [item.height for item in plan_renditions(700)] == [360]
    assert [item.height for item in plan_renditions(360)] == [360]


def test_generation_is_published_only_after_all_commands_and_validation(tmp_path):
    db = mongomock.MongoClient().chartcoach
    storage_root = tmp_path / "media"
    source = storage_root / "sources" / "source.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source")
    caption = storage_root / "sources" / "captions.srt"
    caption.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")
    db.media_assets.insert_one(
        {
            "id": "asset-1",
            "source_provider": "local",
            "source_key": "sources/source.mp4",
            "state": "ready_for_encoding",
            "duration_seconds": 60,
            "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
            "captions": [{"language": "hi", "label": "Hindi", "source_key": "sources/captions.srt"}],
        }
    )
    runner = Runner()
    service = MediaPackagingService(db, storage_root, runner=runner)

    generation = service.package("asset-1", generation_id="generation-1", validate=lambda _: True)

    assert generation["renditions"] == [360, 720, 1080]
    assert generation["processing_seconds"] >= 0
    assert generation["output_bytes"] == 0
    assert generation["worker_host"]["cpu_count"] is not None
    assert db.media_assets.find_one({"id": "asset-1"})["published_generation_id"] == "generation-1"
    ffmpeg = runner.commands[0]
    assert "-force_key_frames" in ffmpeg
    assert "expr:gte(t,n_forced*10)" in ffmpeg
    assert any("fps=1/10" in part for command in runner.commands for part in command)
    assert any("captions_hi.vtt" in part for command in runner.commands for part in command)
    packager = runner.commands[-1]
    assert any("google/shaka-packager" in part for part in packager)
    image_index = next(i for i, part in enumerate(packager) if "google/shaka-packager" in part)
    assert packager[image_index + 1] == "packager"
    assert any("stream=text" in part for part in packager)
    text_descriptor = next(part for part in packager if "stream=text" in part)
    assert "segment_template=" in text_descriptor
    assert ",output=" not in text_descriptor
    assert "--generate_static_live_mpd" in packager
    segment_index = packager.index("--segment_duration")
    assert packager[segment_index + 1] == "10"
    assert any("@sha256:" in part for command in runner.commands for part in command if "ffmpeg" in part or "packager" in part)
    db.media_assets.update_one({"id": "asset-1"}, {"$set": {"state": "ready_for_encoding"}})
    with pytest.raises(ValueError, match="already exists"):
        service.package("asset-1", generation_id="generation-1", validate=lambda _: True)


def test_generation_validator_requires_both_manifests_and_segments(tmp_path):
    package = tmp_path / "package"
    package.mkdir()
    (package / "master.m3u8").write_text("#EXTM3U", encoding="utf-8")
    (package / "manifest.mpd").write_text("<MPD/>", encoding="utf-8")
    assert validate_generation(tmp_path) is False
    (package / "master.m3u8").write_text("#EXTM3U\n360p.m3u8\n", encoding="utf-8")
    (package / "360p.m3u8").write_text("#EXTM3U\nvideo_1.m4s\n", encoding="utf-8")
    (package / "video_1.m4s").write_bytes(b"segment")
    assert validate_generation(tmp_path) is False
    thumbnails = tmp_path / "thumbnails"
    thumbnails.mkdir()
    (thumbnails / "00001.jpg").write_bytes(b"thumbnail")
    assert validate_generation(tmp_path) is True
    (package / "packager-tempfile-1-deadbeef").write_bytes(b"partial manifest")
    assert validate_generation(tmp_path) is False


def test_interrupted_packaging_cleans_unpublished_generation_without_touching_previous(tmp_path):
    db = mongomock.MongoClient().chartcoach
    db.media_assets.insert_one(
        {
            "id": "asset-1",
            "source_key": "sources/source.mp4",
            "state": "ready_for_encoding",
            "published_generation_id": "published-1",
            "streams": [{"codec_type": "video", "height": 360}],
        }
    )
    runner = FailingRunner(fail_on=1)
    generation_root = tmp_path / "outputs" / "asset-1" / "retryable-1"

    with pytest.raises(RuntimeError, match="packaging command failed"):
        MediaPackagingService(db, tmp_path, runner=runner).package(
            "asset-1", generation_id="retryable-1", validate=lambda _: True
        )

    assert not generation_root.exists()
    assert db.media_generations.count_documents({}) == 0
    assert db.media_assets.find_one({"id": "asset-1"})["published_generation_id"] == "published-1"


def test_generation_id_cannot_escape_the_output_root(tmp_path):
    db = mongomock.MongoClient().chartcoach
    db.media_assets.insert_one(
        {
            "id": "asset-1",
            "source_key": "sources/source.mp4",
            "state": "ready_for_encoding",
            "streams": [{"codec_type": "video", "height": 720}],
        }
    )

    with pytest.raises(ValueError, match="generation id"):
        MediaPackagingService(db, tmp_path).package(
            "asset-1", generation_id="../escape", validate=lambda _: True
        )


def test_packaging_rejects_unsafe_asset_id_and_source_checksum_mismatch(tmp_path):
    db = mongomock.MongoClient().chartcoach
    db.media_assets.insert_one(
        {
            "id": "asset-1",
            "source_key": "sources/source.mp4",
            "source_checksum": "0" * 64,
            "state": "ready_for_encoding",
            "streams": [{"codec_type": "video", "height": 360}],
        }
    )

    with pytest.raises(ValueError, match="checksum"):
        MediaPackagingService(db, tmp_path).package(
            "asset-1", generation_id="safe-1", validate=lambda _: True
        )

    with pytest.raises(ValueError, match="asset id"):
        MediaPackagingService(db, tmp_path).package(
            "../asset", generation_id="safe-2", validate=lambda _: True
        )


def test_encrypted_generation_uses_cenc_without_persisting_plaintext_key(tmp_path):
    db = mongomock.MongoClient().chartcoach
    db.media_assets.insert_one(
        {
            "id": "asset-1",
            "source_key": "sources/source.mp4",
            "state": "ready_for_encoding",
            "streams": [{"codec_type": "video", "height": 360}],
        }
    )
    runner = Runner()

    generation = MediaPackagingService(
        db, tmp_path, runner=runner, key_broker=KeyBroker()
    ).package("asset-1", generation_id="encrypted-1", validate=lambda _: True)

    packager = runner.commands[-1]
    assert "--enable_raw_key_encryption" in packager
    assert "--protection_scheme" in packager
    assert "cenc" in packager
    assert any("key_id=00112233445566778899aabbccddeeff" in part for part in packager)
    assert any("key=ffeeddccbbaa99887766554433221100" in part for part in packager)
    assert generation["encryption"] == {
        "type": "development-clear-key",
        "scheme": "cenc",
        "kid": "ABEiM0RVZneImaq7zN3u_w",
    }
    assert "ffeeddccbbaa99887766554433221100" not in repr(db.media_generations.find_one())


def test_server_watermark_is_rendered_before_cenc_without_leaking_identity(tmp_path):
    db = mongomock.MongoClient().chartcoach
    db.media_assets.insert_one(
        {
            "id": "asset-1",
            "source_key": "sources/source.mp4",
            "state": "ready_for_encoding",
            "streams": [{"codec_type": "video", "height": 360}],
        }
    )
    overlay_path = (
        tmp_path / "outputs" / "asset-1" / "session-generation" / "watermark" / "overlay.txt"
    )
    runner = WatermarkInspectingRunner(overlay_path)
    identity = build_watermark_identity(
        "learner@example.com", "playback-session-1", "watermark-secret"
    )

    generation = MediaPackagingService(
        db,
        tmp_path,
        runner=runner,
        key_broker=KeyBroker(),
        environment="development",
    ).package(
        "asset-1",
        generation_id="session-generation",
        validate=lambda _: True,
        watermark_identity=identity,
    )

    transcode = runner.commands[0]
    packager = runner.commands[-1]
    assert any("drawtext=" in part for part in transcode)
    assert runner.rendered_text == f"l••••••@example.com • {identity['forensic_id'][:12]}"
    assert "--enable_raw_key_encryption" in packager
    assert packager[packager.index("--segment_duration") + 1] == "10"
    assert not overlay_path.exists()
    serialized_commands = repr(runner.commands)
    serialized_record = repr(db.media_generations.find_one({"id": "session-generation"}))
    assert "learner@example.com" not in serialized_commands
    assert "learner@example.com" not in serialized_record
    assert "watermark-secret" not in serialized_commands
    assert "watermark-secret" not in serialized_record
    assert identity["visible_text"] not in serialized_commands
    assert identity["visible_text"] not in serialized_record
    assert generation["watermark"] == {
        "mode": "server",
        "algorithm": "hmac-sha256-session-bound",
        "forensic_id": identity["forensic_id"],
    }


def test_production_packaging_fails_closed_without_server_watermark(tmp_path):
    db = mongomock.MongoClient().chartcoach
    db.media_assets.insert_one(
        {
            "id": "asset-1",
            "source_key": "sources/source.mp4",
            "state": "ready_for_encoding",
            "streams": [{"codec_type": "video", "height": 360}],
        }
    )
    runner = Runner()

    with pytest.raises(RuntimeError, match="server watermark"):
        MediaPackagingService(
            db,
            tmp_path,
            runner=runner,
            key_broker=KeyBroker(),
            environment="production",
        ).package("asset-1", generation_id="unsafe", validate=lambda _: True)

    assert runner.commands == []
    assert db.media_generations.count_documents({}) == 0


def test_production_watermarked_packaging_fails_closed_without_encryption(tmp_path):
    db = mongomock.MongoClient().chartcoach
    db.media_assets.insert_one(
        {
            "id": "asset-1",
            "source_key": "sources/source.mp4",
            "state": "ready_for_encoding",
            "streams": [{"codec_type": "video", "height": 360}],
        }
    )
    runner = Runner()
    identity = build_watermark_identity(
        "learner@example.com", "playback-session-1", "watermark-secret"
    )

    with pytest.raises(RuntimeError, match="encryption"):
        MediaPackagingService(
            db,
            tmp_path,
            runner=runner,
            environment="production",
        ).package(
            "asset-1",
            generation_id="unsafe",
            validate=lambda _: True,
            watermark_identity=identity,
        )

    assert runner.commands == []
    assert db.media_generations.count_documents({}) == 0


def test_development_watermark_also_requires_encryption(tmp_path):
    db = mongomock.MongoClient().chartcoach
    db.media_assets.insert_one(
        {
            "id": "asset-1",
            "source_key": "sources/source.mp4",
            "state": "ready_for_encoding",
            "streams": [{"codec_type": "video", "height": 360}],
        }
    )
    runner = Runner()
    identity = build_watermark_identity(
        "learner@example.com", "playback-session-1", "watermark-secret"
    )

    with pytest.raises(RuntimeError, match="encryption"):
        MediaPackagingService(
            db,
            tmp_path,
            runner=runner,
            environment="development",
        ).package(
            "asset-1",
            generation_id="unsafe-local",
            validate=lambda _: True,
            watermark_identity=identity,
        )

    assert runner.commands == []
