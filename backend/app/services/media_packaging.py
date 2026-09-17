"""Reproducible adaptive transcode and package orchestration."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path
import platform
import re
import shutil
import time
from typing import Any, Callable, Protocol

from app.services.media_ingest import _sha256
from app.services.watermarking import WatermarkIdentity, prepare_watermark_overlay


FFMPEG_IMAGE = (
    "ghcr.io/linuxserver/ffmpeg:8.1.2-cli-ls76"
    "@sha256:2e7000921be8de2704a4f27dfd3d988562697a346eaabb937a81046c306f0af7"
)
PACKAGER_IMAGE = (
    "google/shaka-packager:v3.9.3"
    "@sha256:3cc287d86a3d291a8b102c636b9c2bdd51f14cdbe7812f79254414e25de897e9"
)
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


@dataclass(frozen=True)
class Rendition:
    height: int
    video_bitrate: str


def plan_renditions(source_height: int) -> list[Rendition]:
    ladder = [
        Rendition(360, "800k"),
        Rendition(720, "2800k"),
        Rendition(1080, "5000k"),
    ]
    eligible = [rendition for rendition in ladder if rendition.height <= source_height]
    return eligible or [Rendition(source_height, "600k")]


def validate_generation(generation_root: Path) -> bool:
    package_root = generation_root / "package"
    required = [package_root / "master.m3u8", package_root / "manifest.mpd"]
    if not all(path.is_file() and path.stat().st_size > 0 for path in required):
        return False
    if any(package_root.glob("packager-tempfile-*")):
        return False
    if not any(path.is_file() and path.stat().st_size > 0 for path in package_root.glob("*.m4s")):
        return False
    if not any(
        path.is_file() and path.stat().st_size > 0
        for path in (generation_root / "thumbnails").glob("*.jpg")
    ):
        return False

    def referenced_file(reference: str) -> bool:
        reference = reference.split("?", 1)[0].split("#", 1)[0]
        if not reference or reference.startswith(("http://", "https://", "data:")):
            return True
        candidate = (package_root / reference).resolve()
        return package_root in candidate.parents and candidate.is_file() and candidate.stat().st_size > 0

    master_lines = (package_root / "master.m3u8").read_text(encoding="utf-8", errors="replace").splitlines()
    playlists = [line.strip() for line in master_lines if line.strip() and not line.startswith("#")]
    if not playlists or not all(referenced_file(reference) for reference in playlists):
        return False
    for playlist in playlists:
        playlist_path = (package_root / playlist).resolve()
        if playlist_path.suffix.lower() != ".m3u8" or not playlist_path.is_file():
            continue
        lines = playlist_path.read_text(encoding="utf-8", errors="replace").splitlines()
        segments = [line.strip() for line in lines if line.strip() and not line.startswith("#")]
        if not segments or not all(referenced_file(reference) for reference in segments):
            return False

    mpd = (package_root / "manifest.mpd").read_text(encoding="utf-8", errors="replace")
    for reference in re.findall(r'(?:media|initialization)="([^"]+)"', mpd):
        if "$" not in reference and not referenced_file(reference):
            return False
    caption_root = generation_root / "captions"
    if caption_root.exists() and any(
        not path.is_file() or path.stat().st_size == 0 for path in caption_root.glob("*.vtt")
    ):
        return False
    return True


class CommandRunner(Protocol):
    def run(self, command: list[str]) -> None: ...


class SubprocessRunner:
    def run(self, command: list[str]) -> None:
        subprocess.run(command, check=True)


class MediaPackagingService:
    def __init__(
        self,
        db: Any,
        storage_root: Path,
        *,
        runner: CommandRunner | None = None,
        key_broker: Any | None = None,
        environment: str = "development",
    ) -> None:
        self.db = db
        self.storage_root = storage_root.resolve()
        self.runner = runner or SubprocessRunner()
        self.key_broker = key_broker
        self.environment = environment.lower()

    def _run_command(self, generation_root: Path, command: list[str]) -> None:
        """Run one packaging step and remove unpublished output on interruption."""
        try:
            self.runner.run(command)
        except Exception:
            # A generation is immutable once published. Removing only the
            # unpublished directory makes the same generation ID safely
            # retryable without touching the asset's current publication.
            shutil.rmtree(generation_root, ignore_errors=True)
            raise

    def package(
        self,
        asset_id: str,
        *,
        generation_id: str,
        validate: Callable[[Path], bool],
        watermark_identity: WatermarkIdentity | None = None,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        watermark_required = self.environment == "production"
        if watermark_required and watermark_identity is None:
            raise RuntimeError("Production packaging requires a server watermark")
        if watermark_identity is not None and self.key_broker is None:
            raise RuntimeError("Server-watermarked packaging requires encryption")
        if not _SAFE_ID.fullmatch(asset_id):
            raise ValueError("media asset id is invalid")
        if not _SAFE_ID.fullmatch(generation_id):
            raise ValueError("media generation id is invalid")
        asset = self.db.media_assets.find_one({"id": asset_id, "state": "ready_for_encoding"})
        if not asset:
            raise ValueError("media asset is not ready for encoding")
        video_stream = next(
            (stream for stream in asset.get("streams", []) if stream.get("codec_type") == "video"),
            None,
        )
        if not video_stream:
            raise ValueError("media asset has no video stream")
        source_key = str(asset.get("source_key", ""))
        source_path = (self.storage_root / source_key).resolve()
        if self.storage_root not in source_path.parents or not source_path.is_file():
            raise ValueError("media asset source is unavailable")
        source_checksum = asset.get("source_checksum")
        if source_checksum and _sha256(source_path) != source_checksum:
            raise ValueError("media asset source checksum is invalid")
        renditions = plan_renditions(int(video_stream["height"]))
        generation_root = self.storage_root / "outputs" / asset_id / generation_id
        if generation_root.exists() or self.db.media_generations.find_one({"id": generation_id}):
            raise ValueError("media generation already exists")
        transcode_root = generation_root / "transcoded"
        package_root = generation_root / "package"
        thumbnail_root = generation_root / "thumbnails"
        caption_root = generation_root / "captions"
        for directory in (transcode_root, package_root, thumbnail_root, caption_root):
            directory.mkdir(parents=True, exist_ok=True)

        mount = f"{self.storage_root}:/media"
        source_key = source_key.replace("\\", "/")
        source = f"/media/{source_key}"
        prepared_watermark = None
        if watermark_identity is not None:
            watermark_text_path = generation_root / "watermark" / "overlay.txt"
            prepared_watermark = prepare_watermark_overlay(
                watermark_identity,
                host_text_path=watermark_text_path,
                container_text_path=(
                    f"/media/outputs/{asset_id}/{generation_id}/watermark/overlay.txt"
                ),
            )
        ffmpeg = ["docker", "run", "--rm", "-v", mount, FFMPEG_IMAGE, "-y", "-i", source]
        for rendition in renditions:
            output = f"/media/outputs/{asset_id}/{generation_id}/transcoded/{rendition.height}p.mp4"
            video_filter = f"scale=-2:{rendition.height}"
            if prepared_watermark is not None:
                video_filter = f"{video_filter},{prepared_watermark.video_filter}"
            ffmpeg.extend(
                [
                    "-map", "0:v:0", "-map", "0:a:0?",
                    "-vf", video_filter,
                    "-c:v", "libx264", "-preset", "medium", "-profile:v", "high",
                    "-b:v", rendition.video_bitrate, "-maxrate", rendition.video_bitrate,
                    "-bufsize", rendition.video_bitrate, "-sc_threshold", "0",
                    "-force_key_frames", "expr:gte(t,n_forced*10)",
                    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart",
                    output,
                ]
            )
        try:
            self._run_command(generation_root, ffmpeg)
        finally:
            if prepared_watermark is not None:
                prepared_watermark.text_path.unlink(missing_ok=True)

        thumbnail_output = f"/media/outputs/{asset_id}/{generation_id}/thumbnails/%05d.jpg"
        self._run_command(
            generation_root,
            [
                "docker", "run", "--rm", "-v", mount, FFMPEG_IMAGE,
                "-y", "-i", source, "-vf", "fps=1/10,scale=320:-2", "-q:v", "3",
                thumbnail_output,
            ]
        )

        packaged_captions: list[dict[str, str]] = []
        for caption in asset.get("captions", []):
            language = str(caption.get("language", "und"))
            if not re.fullmatch(r"[A-Za-z0-9-]+", language):
                raise ValueError("caption language is invalid")
            caption_key = str(caption["source_key"]).replace("\\", "/")
            caption_output = f"/media/outputs/{asset_id}/{generation_id}/captions/captions_{language}.vtt"
            self._run_command(
                generation_root,
                [
                    "docker", "run", "--rm", "-v", mount, FFMPEG_IMAGE,
                    "-y", "-i", f"/media/{caption_key}", "-f", "webvtt", caption_output,
                ]
            )
            packaged_captions.append(
                {"language": language, "label": str(caption.get("label", language)), "path": caption_output}
            )

        packager = ["docker", "run", "--rm", "-v", mount, PACKAGER_IMAGE, "packager"]
        for rendition in renditions:
            base = f"/media/outputs/{asset_id}/{generation_id}/package/{rendition.height}p"
            packager.append(
                f"in=/media/outputs/{asset_id}/{generation_id}/transcoded/{rendition.height}p.mp4,"
                f"stream=video,init_segment={base}_init.mp4,segment_template={base}_$Number$.m4s,"
                f"playlist_name={rendition.height}p.m3u8"
            )
        audio_source = renditions[-1].height
        packager.append(
            f"in=/media/outputs/{asset_id}/{generation_id}/transcoded/{audio_source}p.mp4,"
            f"stream=audio,init_segment=/media/outputs/{asset_id}/{generation_id}/package/audio_init.mp4,"
            f"segment_template=/media/outputs/{asset_id}/{generation_id}/package/audio_$Number$.m4s,"
            "playlist_name=audio.m3u8,hls_group_id=audio,hls_name=English"
        )
        for caption in packaged_captions:
            language = caption["language"]
            packager.append(
                f"in={caption['path']},stream=text,segment_template=/media/outputs/{asset_id}/{generation_id}/package/"
                f"captions_{language}_$Number$.vtt,playlist_name=captions_{language}.m3u8,hls_group_id=text,"
                f"hls_name={caption['label']},lang={language}"
            )
        content_key = self.key_broker.get_or_create(asset_id) if self.key_broker else None
        if content_key:
            packager.extend(
                [
                    "--enable_raw_key_encryption",
                    "--keys",
                    f"label=:key_id={content_key['kid_hex']}:key={content_key['key_hex']}",
                    "--protection_scheme",
                    "cenc",
                ]
            )
        packager.extend(
            [
                "--segment_duration", "10",
                "--generate_static_live_mpd",
                "--mpd_output", f"/media/outputs/{asset_id}/{generation_id}/package/manifest.mpd",
                "--hls_master_playlist_output", f"/media/outputs/{asset_id}/{generation_id}/package/master.m3u8",
            ]
        )
        self._run_command(generation_root, packager)

        published = bool(validate(generation_root))
        output_bytes = sum(path.stat().st_size for path in generation_root.rglob("*") if path.is_file())
        generation = {
            "id": generation_id,
            "asset_id": asset_id,
            "state": "published" if published else "failed",
            "renditions": [rendition.height for rendition in renditions],
            "captions": packaged_captions,
            "thumbnail_interval_seconds": 10,
            "encryption": (
                {
                    "type": "development-clear-key",
                    "scheme": "cenc",
                    "kid": content_key["kid"],
                }
                if content_key
                else None
            ),
            "watermark": (
                {
                    "mode": "server",
                    "algorithm": prepared_watermark.algorithm,
                    "forensic_id": prepared_watermark.forensic_id,
                }
                if prepared_watermark is not None
                else None
            ),
            "processing_seconds": round(time.perf_counter() - started, 3),
            "output_bytes": output_bytes,
            "worker_host": {
                "system": platform.system(),
                "machine": platform.machine(),
                "cpu_count": os.cpu_count(),
            },
            "created_at": datetime.now(timezone.utc),
        }
        self.db.media_generations.insert_one(generation)
        if not published:
            raise RuntimeError("generated media failed validation")
        self.db.media_assets.update_one(
            {"id": asset_id},
            {"$set": {"published_generation_id": generation_id, "state": "ready"}},
        )
        return generation
