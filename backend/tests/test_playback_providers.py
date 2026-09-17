import mongomock
import pytest

from app.services.playback_providers import (
    CredentialedDrmPlaybackProvider,
    DevelopmentPlaybackProvider,
    MuxPlaybackProvider,
    PlaybackProviderUnavailable,
    build_playback_provider,
    migrate_lesson_media_assets,
)
from app.services.learning import LearningService
from app.domain.learning import Lesson


class CapturingProvider:
    def __init__(self):
        self.asset = None

    def authorize(self, asset, lesson_duration_seconds, playback_session_id=None):
        self.asset = asset
        return {"manifest_url": "https://example.test/manifest.m3u8", "expires_at": "2099-01-01T00:00:00+00:00"}


class CredentialedAdapterDouble:
    name = "vendor-test-double"

    def authorize(self, asset, lesson_duration_seconds, playback_session_id):
        assert asset["id"] == "asset-1"
        assert lesson_duration_seconds == 60
        assert playback_session_id == "session-1"
        return {
            "manifest_url": "https://media.example.test/manifest.mpd",
            "widevine_license_url": "https://license.example.test/widevine",
            "fairplay_license_url": "https://license.example.test/fairplay",
            "fairplay_certificate_url": "https://license.example.test/fairplay.cer",
            "expires_at": "2099-01-01T00:00:00+00:00",
            "drm_policy": {
                "require_hdcp": True,
                "widevine_video_robustness": "HW_SECURE_ALL",
                "widevine_audio_robustness": "HW_SECURE_ALL",
            },
        }


class UnsafeCredentialedAdapter(CredentialedAdapterDouble):
    def authorize(self, asset, lesson_duration_seconds, playback_session_id):
        result = super().authorize(asset, lesson_duration_seconds, playback_session_id)
        result.pop("drm_policy")
        return result


def test_migration_creates_one_asset_and_preserves_existing_lesson_identity():
    db = mongomock.MongoClient().chartcoach
    db.lessons.insert_one(
        {
            "id": "lesson-1",
            "course_id": "course-1",
            "mux_playback_id": "mux-asset-1",
            "media_asset_id": None,
        }
    )

    first = migrate_lesson_media_assets(db)
    second = migrate_lesson_media_assets(db)

    assert first == {"created": 1, "linked": 1}
    assert second == {"created": 0, "linked": 0}
    lesson = db.lessons.find_one({"id": "lesson-1"})
    asset = db.media_assets.find_one({"id": lesson["media_asset_id"]})
    assert lesson["id"] == "lesson-1"
    assert asset["source_provider"] == "mux"
    assert asset["provider_asset_id"] == "mux-asset-1"


def test_development_provider_is_refused_outside_development():
    provider = DevelopmentPlaybackProvider(environment="production")

    with pytest.raises(PlaybackProviderUnavailable, match="development"):
        provider.authorize({"id": "asset-1"}, lesson_duration_seconds=60, playback_session_id="session-1")


def test_development_provider_returns_the_neutral_local_contract_in_development():
    provider = DevelopmentPlaybackProvider(
        environment="development", media_base_url="http://127.0.0.1:8000"
    )

    authorization = provider.authorize(
        {
            "id": "asset-1",
            "source_provider": "local",
            "state": "ready",
            "published_generation_id": "generation-1",
        },
        lesson_duration_seconds=60,
        playback_session_id="session-1",
    )

    assert authorization["provider"] == "local"
    assert authorization["media_asset_id"] == "asset-1"
    assert authorization["drm"] == {
        "type": "development-clear-key",
        "license_url": "http://127.0.0.1:8000/media/playback-sessions/session-1/clearkey",
    }
    assert authorization["manifest_url"] == "http://127.0.0.1:8000/media/playback-sessions/session-1/manifest.mpd"
    assert authorization["expires_at"] != "2099-01-01T00:00:00+00:00"
    assert authorization["drm_readiness"] == {
        "credentials_status": "pending",
        "production_ready": False,
        "mode": "development-clear-key",
    }

    with pytest.raises(PlaybackProviderUnavailable, match="local asset"):
        provider.authorize(
            {"id": "mux-asset", "source_provider": "mux"},
            lesson_duration_seconds=60,
            playback_session_id="session-1",
        )
    with pytest.raises(PlaybackProviderUnavailable, match="published generation"):
        provider.authorize(
            {"id": "asset-1", "source_provider": "local", "state": "ready"},
            lesson_duration_seconds=60,
            playback_session_id="session-1",
        )


def test_credentialed_adapter_contract_preserves_widevine_and_fairplay_urls():
    provider = CredentialedDrmPlaybackProvider(CredentialedAdapterDouble())

    authorization = provider.authorize(
        {"id": "asset-1"}, lesson_duration_seconds=60, playback_session_id="session-1"
    )

    assert authorization["provider"] == "vendor-test-double"
    assert authorization["drm"] == {"type": "credentialed"}
    assert authorization["widevine_license_url"].startswith("https://")
    assert authorization["fairplay_license_url"].startswith("https://")
    assert authorization["fairplay_certificate_url"].startswith("https://")
    assert authorization["drm_policy"]["require_hdcp"] is True


def test_credentialed_adapter_rejects_authorization_without_capture_policy():
    provider = CredentialedDrmPlaybackProvider(UnsafeCredentialedAdapter())
    with pytest.raises(PlaybackProviderUnavailable, match="capture policy"):
        provider.authorize({"id": "asset-1"}, lesson_duration_seconds=60, playback_session_id="session-1")

def test_provider_factory_restricts_local_selection_and_retains_mux_default():
    config = type(
        "Config",
        (),
        {
            "playback_provider": "mux",
            "app_environment": "development",
            "mux_signing_key_id": None,
            "mux_signing_private_key_base64": None,
            "mux_playback_token_expire_minutes": 120,
            "mux_playback_restriction_id": None,
        },
    )()
    assert isinstance(build_playback_provider(config), MuxPlaybackProvider)
    config.playback_provider = "local"
    assert isinstance(build_playback_provider(config), DevelopmentPlaybackProvider)
    config.app_environment = "production"
    with pytest.raises(PlaybackProviderUnavailable, match="development"):
        build_playback_provider(config)


def test_learning_service_authorizes_the_linked_media_asset_not_a_provider_specific_lesson_field():
    db = mongomock.MongoClient().chartcoach
    db.courses.insert_one({"id": "course-1", "published": True})
    db.enrollments.insert_one({"user_id": "user-1", "course_id": "course-1", "active": True})
    lesson = Lesson.model_validate(
        {
            "id": "lesson-1", "course_id": "course-1", "title": "Lesson", "duration_seconds": 60,
            "media_asset_id": "asset-1",
            "captions": {"url": "https://example.test/captions.vtt"}, "published": True,
            "segments": [{"id": "segment-1", "title": "Start", "description": "", "start_seconds": 0, "end_seconds": 60, "thumbnail": {"time_seconds": 1, "url": "https://example.test/thumb.jpg"}}],
        }
    )
    db.lessons.insert_one(lesson.to_storage_dict())
    db.media_assets.insert_one({"id": "asset-1", "source_provider": "mux", "provider_asset_id": "provider-id"})
    provider = CapturingProvider()
    user = type("User", (), {"id": "user-1"})()

    LearningService(db, provider).start_playback("lesson-1", user)

    assert provider.asset["id"] == "asset-1"
    assert provider.asset["provider_asset_id"] == "provider-id"
