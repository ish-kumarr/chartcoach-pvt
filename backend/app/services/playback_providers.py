"""Provider-neutral authorization for protected lesson media.

This boundary deliberately returns no browser secrets.  The local provider is
only a development contract until the packaging/key-broker sprint implements
the manifest and license endpoints it names.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from app.services.mux import MuxPlaybackSigner


class PlaybackProviderUnavailable(RuntimeError):
    """A selected playback provider cannot safely authorize this request."""


class PlaybackProvider(Protocol):
    def authorize(
        self,
        asset: dict[str, Any],
        lesson_duration_seconds: float,
        playback_session_id: str | None = None,
    ) -> dict[str, Any]: ...


class CredentialedDrmAdapter(Protocol):
    """Vendor boundary for the later Widevine/FairPlay credentialed phase."""

    name: str

    def authorize(
        self,
        asset: dict[str, Any],
        lesson_duration_seconds: float,
        playback_session_id: str,
    ) -> dict[str, Any]: ...


class CredentialedDrmPlaybackProvider:
    """Normalizes a credentialed vendor adapter without embedding vendor SDKs."""

    def __init__(self, adapter: CredentialedDrmAdapter) -> None:
        self._adapter = adapter
        self.name = adapter.name

    def authorize(
        self,
        asset: dict[str, Any],
        lesson_duration_seconds: float,
        playback_session_id: str | None = None,
    ) -> dict[str, Any]:
        if not playback_session_id:
            raise PlaybackProviderUnavailable("A playback session is required")
        authorization = self._adapter.authorize(
            asset, lesson_duration_seconds, playback_session_id
        )
        required_urls = (
            "manifest_url",
            "widevine_license_url",
            "fairplay_license_url",
            "fairplay_certificate_url",
        )
        if any(not str(authorization.get(key, "")).startswith("https://") for key in required_urls):
            raise PlaybackProviderUnavailable("Credentialed DRM authorization is incomplete")
        if not authorization.get("expires_at"):
            raise PlaybackProviderUnavailable("Credentialed DRM authorization has no expiry")
        policy = authorization.get("drm_policy")
        if not isinstance(policy, dict) or policy.get("require_hdcp") is not True:
            raise PlaybackProviderUnavailable("Credentialed DRM authorization has no capture policy")
        return {
            **authorization,
            "provider": self.name,
            "media_asset_id": asset["id"],
            "drm": {"type": "credentialed"},
        }


class MuxPlaybackProvider:
    name = "mux"

    def __init__(self, signer: MuxPlaybackSigner) -> None:
        self._signer = signer

    def authorize(
        self,
        asset: dict[str, Any],
        lesson_duration_seconds: float,
        playback_session_id: str | None = None,
    ) -> dict[str, Any]:
        playback_id = asset.get("provider_asset_id")
        if not isinstance(playback_id, str) or not playback_id:
            raise PlaybackProviderUnavailable("Mux media asset is not configured")
        authorization = self._signer.authorize(playback_id, lesson_duration_seconds)
        return {
            **authorization,
            "provider": self.name,
            "media_asset_id": asset["id"],
            "drm": {"type": "mux"},
        }


class DevelopmentPlaybackProvider:
    name = "local"

    def __init__(
        self,
        *,
        environment: str,
        media_base_url: str = "http://127.0.0.1:8000",
        session_minutes: int = 15,
    ) -> None:
        self._environment = environment
        self._media_base_url = media_base_url.rstrip("/")
        self._session_minutes = session_minutes

    def authorize(
        self,
        asset: dict[str, Any],
        lesson_duration_seconds: float,
        playback_session_id: str | None = None,
    ) -> dict[str, Any]:
        if self._environment.lower() not in {"development", "test"}:
            raise PlaybackProviderUnavailable("The local playback provider is development-only")
        asset_id = asset.get("id")
        if not isinstance(asset_id, str) or not asset_id:
            raise PlaybackProviderUnavailable("Local media asset is not configured")
        if asset.get("source_provider") != "local":
            raise PlaybackProviderUnavailable("The local provider requires a local asset")
        if asset.get("state") != "ready" or not asset.get("published_generation_id"):
            raise PlaybackProviderUnavailable("The local asset has no published generation")
        if not playback_session_id:
            raise PlaybackProviderUnavailable("A playback session is required")
        session_root = f"{self._media_base_url}/media/playback-sessions/{playback_session_id}"
        return {
            "provider": self.name,
            "media_asset_id": asset_id,
            "playback_id": asset_id,
            "manifest_url": f"{session_root}/manifest.mpd",
            "widevine_license_url": f"{session_root}/clearkey",
            "playready_license_url": "",
            "fairplay_license_url": "",
            "fairplay_certificate_url": "",
            "playback_token": "",
            "drm_token": "",
            "expires_at": (
                datetime.now(timezone.utc) + timedelta(minutes=self._session_minutes)
            ).isoformat(),
            "drm": {
                "type": "development-clear-key",
                "license_url": f"{session_root}/clearkey",
            },
            # Keep the boundary explicit: local Clear Key is playable for
            # development, but is not credentialed production DRM.
            "drm_readiness": {
                "credentials_status": "pending",
                "production_ready": False,
                "mode": "development-clear-key",
            },
        }


def build_playback_provider(config: Any) -> PlaybackProvider:
    selected = config.playback_provider.lower()
    if selected == "mux":
        return MuxPlaybackProvider(
            MuxPlaybackSigner(
                key_id=config.mux_signing_key_id,
                private_key_base64=config.mux_signing_private_key_base64,
                expire_minutes=config.mux_playback_token_expire_minutes,
                playback_restriction_id=config.mux_playback_restriction_id,
            )
        )
    if selected == "local":
        if config.app_environment.lower() not in {"development", "test"}:
            raise PlaybackProviderUnavailable("The local playback provider is development-only")
        return DevelopmentPlaybackProvider(
            environment=config.app_environment,
            media_base_url=getattr(config, "media_base_url", "http://127.0.0.1:8000"),
            session_minutes=getattr(config, "local_playback_session_minutes", 15),
        )
    raise PlaybackProviderUnavailable(f"Unknown playback provider: {selected}")


def migrate_lesson_media_assets(db: Any) -> dict[str, int]:
    """Idempotently create Mux-backed asset records and link legacy lessons."""
    created = linked = 0
    for lesson in db.lessons.find({"mux_playback_id": {"$type": "string"}}):
        if lesson.get("media_asset_id"):
            continue
        playback_id = lesson["mux_playback_id"]
        asset_id = f"mux-{playback_id}"
        result = db.media_assets.update_one(
            {"id": asset_id},
            {
                "$setOnInsert": {
                    "id": asset_id,
                    "source_provider": "mux",
                    "provider_asset_id": playback_id,
                    "state": "ready",
                }
            },
            upsert=True,
        )
        created += int(result.upserted_id is not None)
        updated = db.lessons.update_one(
            {"_id": lesson["_id"], "media_asset_id": {"$in": [None, ""]}},
            {"$set": {"media_asset_id": asset_id}},
        )
        linked += updated.modified_count
    return {"created": created, "linked": linked}
