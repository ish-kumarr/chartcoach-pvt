"""Server-side watermark identity primitives.

The renderer consumes this session-bound identity before encryption. Raw email
addresses never travel in playback capabilities or watermark logs.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict


class WatermarkIdentity(TypedDict):
    visible_text: str
    forensic_id: str
    algorithm: str


@dataclass(frozen=True)
class PreparedWatermark:
    """Ephemeral FFmpeg input plus safe metadata for an output generation."""

    text_path: Path
    video_filter: str
    forensic_id: str
    algorithm: str


def mask_email(email: str) -> str:
    normalized = email.strip().lower()
    local, separator, domain = normalized.partition("@")
    if not separator or not local or not domain:
        raise ValueError("A valid email is required for watermarking")
    safe_domain = re.sub(r"[^a-z0-9.\-]", "", domain)
    if not safe_domain:
        raise ValueError("A valid email domain is required for watermarking")
    return f"{local[0]}{'•' * max(1, len(local) - 1)}@{safe_domain}"


def build_watermark_identity(email: str, playback_session_id: str, secret: str) -> WatermarkIdentity:
    if not playback_session_id or not secret:
        raise ValueError("A playback session and watermark secret are required")
    normalized = email.strip().lower()
    digest = hmac.new(
        secret.encode("utf-8"),
        f"{normalized}:{playback_session_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:32]
    return {
        "visible_text": mask_email(normalized),
        "forensic_id": digest,
        "algorithm": "hmac-sha256-session-bound",
    }


def prepare_watermark_overlay(
    identity: WatermarkIdentity,
    *,
    host_text_path: Path,
    container_text_path: str,
) -> PreparedWatermark:
    """Create the short-lived text input used by FFmpeg's server renderer.

    The learner identity is deliberately stored in a text file rather than in
    the process arguments. This keeps it out of command traces and process
    listings. The caller must remove ``text_path`` after FFmpeg exits.
    """

    visible_text = str(identity.get("visible_text", ""))
    local, separator, domain = visible_text.partition("@")
    forensic_id = str(identity.get("forensic_id", ""))
    algorithm = str(identity.get("algorithm", ""))
    if (
        not separator
        or "•" not in local
        or not domain
        or any(character in visible_text for character in "\r\n\0")
        or len(visible_text) > 254
    ):
        raise ValueError("A masked watermark identity is required")
    if not re.fullmatch(r"[0-9a-f]{32}", forensic_id):
        raise ValueError("A valid forensic watermark identifier is required")
    if algorithm != "hmac-sha256-session-bound":
        raise ValueError("The watermark algorithm is unsupported")
    if not container_text_path.startswith("/media/"):
        raise ValueError("The watermark text path must be inside the media mount")

    host_text_path.parent.mkdir(parents=True, exist_ok=True)
    host_text_path.write_text(
        f"{visible_text} • {forensic_id[:12]}",
        encoding="utf-8",
    )
    # Move between four safe-area corners on a fixed schedule. The watermark
    # remains present on every frame while being harder to remove with one crop.
    video_filter = (
        "drawtext="
        "fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:"
        f"textfile={container_text_path}:"
        "fontcolor=white@0.82:fontsize=h/32:"
        "box=1:boxcolor=black@0.38:boxborderw=12:"
        "x=if(lt(mod(t\\,40)\\,20)\\,32\\,w-tw-32):"
        "y=if(lt(mod(t\\,80)\\,40)\\,32\\,h-th-32)"
    )
    return PreparedWatermark(
        text_path=host_text_path,
        video_filter=video_filter,
        forensic_id=forensic_id,
        algorithm=algorithm,
    )
