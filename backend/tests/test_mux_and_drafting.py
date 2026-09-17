import base64
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

from app.services.drafting import DraftProviderUnavailable, LessonDraft, UnconfiguredDraftProvider
from app.services.mux import MuxPlaybackSigner, MuxSigningUnavailable


def rsa_key_pair() -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return base64.b64encode(private_pem).decode("ascii"), public_pem.decode("ascii")


def test_mux_signer_returns_separate_rs256_video_and_drm_capabilities():
    private_key_base64, public_key = rsa_key_pair()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    signer = MuxPlaybackSigner(
        key_id="mux-key-1",
        private_key_base64=private_key_base64,
        expire_minutes=120,
        playback_restriction_id="restriction-1",
    )

    authorization = signer.authorize("mux-playback-1", lesson_duration_seconds=3600, now=now)

    assert authorization["playback_id"] == "mux-playback-1"
    assert authorization["manifest_url"].startswith("https://stream.mux.com/mux-playback-1.m3u8?token=")
    assert authorization["widevine_license_url"].startswith(
        "https://license.mux.com/license/widevine/mux-playback-1?token="
    )
    assert authorization["playready_license_url"].startswith(
        "https://license.mux.com/license/playready/mux-playback-1?token="
    )
    assert authorization["fairplay_license_url"].startswith(
        "https://license.mux.com/license/fairplay/mux-playback-1?token="
    )
    assert authorization["fairplay_certificate_url"].startswith(
        "https://license.mux.com/appcert/fairplay/mux-playback-1?token="
    )
    assert authorization["expires_at"] == (now + timedelta(minutes=120)).isoformat()

    playback_claims = jwt.decode(
        authorization["playback_token"], public_key, algorithms=["RS256"], audience="v"
    )
    drm_claims = jwt.decode(authorization["drm_token"], public_key, algorithms=["RS256"], audience="d")
    assert playback_claims["sub"] == drm_claims["sub"] == "mux-playback-1"
    assert playback_claims["aud"] == "v"
    assert drm_claims["aud"] == "d"
    assert playback_claims["exp"] - playback_claims["iat"] == 120 * 60
    assert drm_claims["exp"] - drm_claims["iat"] == 120 * 60
    assert playback_claims["playback_restriction_id"] == "restriction-1"
    assert "@" not in playback_claims["custom"]
    assert jwt.get_unverified_header(authorization["playback_token"]) == {
        "alg": "RS256",
        "kid": "mux-key-1",
        "typ": "JWT",
    }


@pytest.mark.parametrize(
    ("key_id", "private_key"),
    [(None, None), ("mux-key-1", None), ("mux-key-1", "not-base64")],
)
def test_mux_signer_reports_missing_or_invalid_server_configuration(key_id, private_key):
    signer = MuxPlaybackSigner(key_id=key_id, private_key_base64=private_key, expire_minutes=120)

    with pytest.raises(MuxSigningUnavailable, match="Mux playback signing is unavailable"):
        signer.authorize("mux-playback-1", lesson_duration_seconds=60)


def test_mux_token_lifetime_must_outlast_lesson():
    private_key_base64, _ = rsa_key_pair()
    signer = MuxPlaybackSigner(
        key_id="mux-key-1",
        private_key_base64=private_key_base64,
        expire_minutes=1,
    )

    with pytest.raises(MuxSigningUnavailable, match="outlast the lesson"):
        signer.authorize("mux-playback-1", lesson_duration_seconds=61)


def test_mux_signer_reports_non_rsa_private_key_as_configuration_error():
    private_key = ec.generate_private_key(ec.SECP256R1())
    encoded_key = base64.b64encode(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    ).decode("ascii")
    signer = MuxPlaybackSigner(
        key_id="mux-key-1",
        private_key_base64=encoded_key,
        expire_minutes=120,
    )

    with pytest.raises(MuxSigningUnavailable, match="Mux playback signing is unavailable"):
        signer.authorize("mux-playback-1", lesson_duration_seconds=60)


def test_unconfigured_draft_provider_raises_typed_unavailable_error():
    provider = UnconfiguredDraftProvider()

    with pytest.raises(DraftProviderUnavailable, match="AI lesson drafting is not configured"):
        provider.draft("A transcript without any external service call.", lesson_duration_seconds=90)


def test_lesson_draft_is_always_unpublished_and_rejects_invalid_timeline():
    segment = {
        "id": "s1",
        "title": "Draft segment",
        "description": "Drafted from the transcript.",
        "start_seconds": 0,
        "end_seconds": 60,
        "thumbnail": {"time_seconds": 10, "url": "https://example.test/draft.jpg"},
        "required_prompt": None,
    }

    with pytest.raises(ValueError):
        LessonDraft(duration_seconds=50, segments=[segment])
    with pytest.raises(ValueError):
        LessonDraft(duration_seconds=90, segments=[segment], published=True)
