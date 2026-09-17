"""Report the safe playback mode while vendor DRM credentials are pending."""

from __future__ import annotations

from typing import Any


def get_drm_readiness(config: Any) -> dict[str, Any]:
    """Return a non-secret readiness snapshot for operators and the learner UI.

    The local provider is intentionally playable in development and test, but
    it can never be reported as production-ready. Vendor credential status is
    informational until a credentialed provider is selected and implemented.
    """

    provider = str(getattr(config, "playback_provider", "unknown")).lower()
    environment = str(getattr(config, "app_environment", "development")).lower()
    credentials_status = str(
        getattr(config, "drm_credentials_status", "pending")
    ).lower()
    if credentials_status not in {"pending", "ready"}:
        credentials_status = "pending"

    reasons: list[str] = []
    if credentials_status != "ready":
        reasons.extend(("widevine_credentials_pending", "fairplay_credentials_pending"))

    if provider == "local":
        playable = environment in {"development", "test"}
        if not playable:
            reasons.insert(0, "local_provider_is_development_only")
        return {
            "provider": provider,
            "environment": environment,
            "playable": playable,
            "mode": "development-clear-key",
            "credentials_status": credentials_status,
            "production_ready": False,
            "blocking_reasons": reasons,
        }

    if provider == "mux":
        mux_configured = bool(
            getattr(config, "mux_signing_key_id", None)
            and getattr(config, "mux_signing_private_key_base64", None)
        )
        if not mux_configured:
            reasons = ["mux_signing_credentials_missing"]
            return {
                "provider": provider,
                "environment": environment,
                "playable": False,
                "mode": "mux-managed-drm",
                "credentials_status": "pending",
                "production_ready": False,
                "blocking_reasons": reasons,
            }
        return {
            "provider": provider,
            "environment": environment,
            "playable": True,
            "mode": "mux-managed-drm",
            "credentials_status": "configured",
            "production_ready": True,
            "blocking_reasons": [],
        }

    reasons.insert(0, "credentialed_provider_not_configured")
    return {
        "provider": provider,
        "environment": environment,
        "playable": False,
        "mode": "unavailable",
        "credentials_status": credentials_status,
        "production_ready": False,
        "blocking_reasons": reasons,
    }
