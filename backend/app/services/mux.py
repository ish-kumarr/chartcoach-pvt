from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt


class MuxSigningUnavailable(RuntimeError):
    """Raised when Mux capability URLs cannot be safely signed."""


class MuxPlaybackSigner:
    def __init__(
        self,
        *,
        key_id: str | None,
        private_key_base64: str | None,
        expire_minutes: int,
        playback_restriction_id: str | None = None,
    ) -> None:
        self._key_id = key_id
        self._private_key_base64 = private_key_base64
        self._expire_minutes = expire_minutes
        self._playback_restriction_id = playback_restriction_id

    def _private_key(self) -> bytes:
        if not self._key_id or not self._private_key_base64:
            raise MuxSigningUnavailable("Mux playback signing is unavailable")
        try:
            key = base64.b64decode(self._private_key_base64, validate=True)
            loaded_key = serialization.load_pem_private_key(key, password=None)
            if not isinstance(loaded_key, rsa.RSAPrivateKey):
                raise ValueError("Mux signing key must be RSA")
        except (ValueError, TypeError):
            raise MuxSigningUnavailable("Mux playback signing is unavailable") from None
        return key

    def authorize(
        self,
        playback_id: str,
        lesson_duration_seconds: float,
        now: datetime | None = None,
    ) -> dict[str, str]:
        lifetime_seconds = self._expire_minutes * 60
        if lifetime_seconds <= lesson_duration_seconds:
            raise MuxSigningUnavailable("Mux token lifetime must outlast the lesson")

        private_key = self._private_key()
        issued_at = now or datetime.now(timezone.utc)
        issued_at = issued_at.astimezone(timezone.utc)
        expires_at = issued_at + timedelta(seconds=lifetime_seconds)
        custom_session = uuid4().hex

        def sign(audience: str) -> str:
            claims: dict[str, str | int] = {
                "sub": playback_id,
                "aud": audience,
                "iat": int(issued_at.timestamp()),
                "exp": int(expires_at.timestamp()),
                "custom": custom_session,
            }
            if self._playback_restriction_id:
                claims["playback_restriction_id"] = self._playback_restriction_id
            return jwt.encode(
                claims,
                private_key,
                algorithm="RS256",
                headers={"kid": self._key_id},
            )

        playback_token = sign("v")
        drm_token = sign("d")
        return {
            "playback_id": playback_id,
            "manifest_url": f"https://stream.mux.com/{playback_id}.m3u8?token={playback_token}",
            "widevine_license_url": (
                f"https://license.mux.com/license/widevine/{playback_id}?token={drm_token}"
            ),
            "playready_license_url": (
                f"https://license.mux.com/license/playready/{playback_id}?token={drm_token}"
            ),
            "fairplay_license_url": (
                f"https://license.mux.com/license/fairplay/{playback_id}?token={drm_token}"
            ),
            "fairplay_certificate_url": (
                f"https://license.mux.com/appcert/fairplay/{playback_id}?token={drm_token}"
            ),
            "playback_token": playback_token,
            "drm_token": drm_token,
            "expires_at": expires_at.isoformat(),
        }
