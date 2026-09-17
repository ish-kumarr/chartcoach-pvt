from types import SimpleNamespace

from app.services.drm_readiness import get_drm_readiness


def test_local_development_is_playable_while_vendor_credentials_are_pending():
    status = get_drm_readiness(
        SimpleNamespace(
            playback_provider="local",
            app_environment="development",
            drm_credentials_status="pending",
        )
    )

    assert status == {
        "provider": "local",
        "environment": "development",
        "playable": True,
        "mode": "development-clear-key",
        "credentials_status": "pending",
        "production_ready": False,
        "blocking_reasons": ["widevine_credentials_pending", "fairplay_credentials_pending"],
    }


def test_local_provider_never_becomes_production_ready_without_a_credentialed_provider():
    status = get_drm_readiness(
        SimpleNamespace(
            playback_provider="local",
            app_environment="production",
            drm_credentials_status="ready",
        )
    )

    assert status["playable"] is False
    assert status["production_ready"] is False
    assert "local_provider_is_development_only" in status["blocking_reasons"]


def test_health_snapshot_is_available_without_exposing_credentials(monkeypatch):
    from app import main

    monkeypatch.setattr(main.settings, "playback_provider", "local")
    monkeypatch.setattr(main.settings, "app_environment", "development")
    monkeypatch.setattr(main.settings, "drm_credentials_status", "pending")

    response = main.drm_health_check()

    assert response["playable"] is True
    assert response["credentials_status"] == "pending"
    assert "secret" not in repr(response).lower()


def test_mux_is_not_reported_ready_when_signing_credentials_are_missing():
    status = get_drm_readiness(
        SimpleNamespace(
            playback_provider="mux",
            app_environment="production",
            drm_credentials_status="pending",
            mux_signing_key_id=None,
            mux_signing_private_key_base64=None,
        )
    )

    assert status["playable"] is False
    assert status["production_ready"] is False
    assert "mux_signing_credentials_missing" in status["blocking_reasons"]
