"""Development-only encrypted custody for local media content keys."""

from __future__ import annotations

import base64
import hashlib
import os
from datetime import datetime, timezone
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class DevelopmentKeyUnavailable(RuntimeError):
    """The development key path is unavailable or unsafe in this environment."""


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class DevelopmentKeyBroker:
    def __init__(
        self,
        db: Any,
        *,
        environment: str,
        wrapping_secret: str | None,
    ) -> None:
        self.db = db
        self.environment = environment.lower()
        self.wrapping_secret = wrapping_secret

    def _cipher(self) -> AESGCM:
        if self.environment not in {"development", "test"}:
            raise DevelopmentKeyUnavailable("The local key broker is development-only")
        if not self.wrapping_secret or len(self.wrapping_secret) < 32:
            raise DevelopmentKeyUnavailable("A local media wrapping secret of at least 32 characters is required")
        wrapping_key = hashlib.sha256(self.wrapping_secret.encode("utf-8")).digest()
        return AESGCM(wrapping_key)

    def get_or_create(self, asset_id: str) -> dict[str, str]:
        cipher = self._cipher()
        stored = self.db.media_content_keys.find_one({"asset_id": asset_id})
        if not stored:
            kid = os.urandom(16)
            content_key = os.urandom(16)
            nonce = os.urandom(12)
            encrypted = cipher.encrypt(nonce, content_key, asset_id.encode("utf-8"))
            self.db.media_content_keys.update_one(
                {"asset_id": asset_id},
                {
                    "$setOnInsert": {
                        "asset_id": asset_id,
                        "kid": _encode(kid),
                        "nonce": _encode(nonce),
                        "encrypted_key": _encode(encrypted),
                        "created_at": datetime.now(timezone.utc),
                    }
                },
                upsert=True,
            )
            stored = self.db.media_content_keys.find_one({"asset_id": asset_id})
        if not stored:
            raise DevelopmentKeyUnavailable("The local content key could not be loaded")
        content_key = cipher.decrypt(
            _decode(stored["nonce"]),
            _decode(stored["encrypted_key"]),
            asset_id.encode("utf-8"),
        )
        return {
            "kid_hex": _decode(stored["kid"]).hex(),
            "key_hex": content_key.hex(),
            "kid": stored["kid"],
            "key": _encode(content_key),
        }
