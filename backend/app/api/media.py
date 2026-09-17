"""Authenticated local media and development Clear Key delivery."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pymongo.database import Database

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.media_keys import DevelopmentKeyBroker, DevelopmentKeyUnavailable


router = APIRouter(prefix="/media", tags=["media"])
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def get_media_root() -> Path:
    return Path(settings.media_root).resolve()


def get_key_broker(db: Database = Depends(get_db)) -> DevelopmentKeyBroker:
    return DevelopmentKeyBroker(
        db,
        environment=settings.app_environment,
        wrapping_secret=settings.local_media_wrapping_secret,
    )


def _authorized_session(db: Any, session_id: str, user: Any) -> dict[str, Any]:
    session = db.playback_sessions.find_one(
        {"id": session_id, "user_id": str(user.id), "status": "active"}
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Playback session is unavailable")
    expires_at = session.get("expires_at")
    if not isinstance(expires_at, datetime):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Playback session is unavailable")
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Playback session has expired")
    lesson = db.lessons.find_one({"id": session.get("lesson_id"), "published": True})
    if not lesson:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Published lesson is unavailable")
    course_id = lesson.get("course_id")
    if session.get("course_id") and session.get("course_id") != course_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Playback session is unavailable")
    if not course_id or not db.courses.find_one({"id": course_id, "published": True}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Published lesson is unavailable")
    if not db.enrollments.find_one(
        {"user_id": str(user.id), "course_id": course_id, "active": True}
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active enrollment is required")
    if not _SAFE_ID.fullmatch(str(session.get("asset_id", ""))) or not _SAFE_ID.fullmatch(
        str(session.get("generation_id", ""))
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Published media is unavailable")
    asset = db.media_assets.find_one(
        {"id": session.get("asset_id"), "state": "ready", "published_generation_id": session.get("generation_id")}
    )
    generation = db.media_generations.find_one(
        {"id": session.get("generation_id"), "asset_id": session.get("asset_id"), "state": "published"}
    )
    if not asset or not generation:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Published media is unavailable")
    if session.get("watermark_mode") == "server":
        watermark = generation.get("watermark") or {}
        if watermark.get("mode") != "server":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Watermarked media is unavailable")
        forensic_id = session.get("watermark_forensic_id")
        if forensic_id and watermark.get("forensic_id") != forensic_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Watermarked media is unavailable")
    return session


@router.get("/playback-sessions/{session_id}/{media_path:path}")
def deliver_media(
    session_id: str,
    media_path: str,
    user: User = Depends(get_current_user),
    db: Database = Depends(get_db),
    media_root: Path = Depends(get_media_root),
):
    session = _authorized_session(db, session_id, user)
    relative = Path(media_path)
    if relative.is_absolute() or not media_path or ".." in relative.parts or "\\" in media_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file was not found")
    package_root = (media_root / "outputs" / session["asset_id"] / session["generation_id"] / "package").resolve()
    target = (package_root / relative).resolve()
    if package_root not in target.parents or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file was not found")
    content_types = {
        ".m3u8": "application/vnd.apple.mpegurl",
        ".mpd": "application/dash+xml",
        ".m4s": "video/iso.segment",
        ".mp4": "video/mp4",
        ".vtt": "text/vtt; charset=utf-8",
    }
    return FileResponse(target, media_type=content_types.get(target.suffix.lower(), "application/octet-stream"))


@router.post("/playback-sessions/{session_id}/clearkey")
def issue_clear_key(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Database = Depends(get_db),
    broker: DevelopmentKeyBroker = Depends(get_key_broker),
):
    session = _authorized_session(db, session_id, user)
    generation = db.media_generations.find_one({"id": session["generation_id"]})
    if (generation or {}).get("encryption", {}).get("type") != "development-clear-key":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Clear Key is unavailable")
    try:
        content_key = broker.get_or_create(session["asset_id"])
    except DevelopmentKeyUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The development key service is unavailable") from exc
    return {
        "keys": [{"kty": "oct", "kid": content_key["kid"], "k": content_key["key"]}],
        "type": "temporary",
    }
