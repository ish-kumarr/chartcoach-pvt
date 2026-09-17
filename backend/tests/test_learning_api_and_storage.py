import base64
import json

import mongomock
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import learning
from app.config import Settings
from app.core.rate_limit import limiter
from app.core.security import AUTH_COOKIE_NAME, create_access_token
from app.database import get_db, init_db
from app.domain.learning import Lesson
from app.services.learning import LearningService
from app.services.mux import MuxPlaybackSigner
from app.services.playback_providers import MuxPlaybackProvider


class StaticSigner:
    def authorize(self, playback_id: str, lesson_duration_seconds: float, playback_session_id=None):
        return {
            "playback_id": playback_id,
            "manifest_url": "https://stream.example.test/signed.m3u8",
            "expires_at": "2026-09-07T14:00:00+00:00",
        }


def lesson_doc(*, lesson_id="l1", published=True):
    return Lesson.model_validate(
        {
            "id": lesson_id,
            "course_id": "price-action-secrets",
            "title": "Market structure",
            "duration_seconds": 100,
            "mux_playback_id": "mux-playback-1",
            "captions": {"language": "en", "label": "English", "url": "https://example.test/l1.vtt"},
            "published": published,
            "segments": [
                {
                    "id": "s1",
                    "title": "Structure",
                    "description": "Observe the swing.",
                    "start_seconds": 0,
                    "end_seconds": 40,
                    "thumbnail": {"time_seconds": 10, "url": "https://example.test/s1.jpg"},
                    "required_prompt": {
                        "id": "p1",
                        "question": "What confirms an upswing?",
                        "options": [{"id": "a", "text": "HH/HL"}, {"id": "b", "text": "LH/LL"}],
                        "correct_option_id": "a",
                        "explanation": "Higher highs and higher lows confirm it.",
                    },
                },
                {
                    "id": "s2",
                    "title": "Review",
                    "description": "Review the move.",
                    "start_seconds": 40,
                    "end_seconds": 100,
                    "thumbnail": {"time_seconds": 50, "url": "https://example.test/s2.jpg"},
                    "required_prompt": None,
                },
            ],
        }
    ).to_storage_dict()


@pytest.fixture
def api_context():
    db = mongomock.MongoClient().chartcoach
    db.users.insert_one(
        {
            "_id": "user-1",
            "email": "learner@example.test",
            "full_name": "Learner",
            "hashed_password": "unused",
            "is_active": True,
            "face_embeddings": [],
        }
    )
    db.courses.insert_one(
        {"id": "price-action-secrets", "slug": "price-action-secrets", "title": "Price Action Secrets", "published": True}
    )
    db.lessons.insert_one(lesson_doc())
    db.enrollments.insert_one(
        {
            "user_id": "user-1",
            "email": "learner@example.test",
            "course_id": "price-action-secrets",
            "active": True,
        }
    )
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(learning.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[learning.get_learning_service] = lambda: LearningService(db, StaticSigner())
    client = TestClient(app)
    header = {"Authorization": f"Bearer {create_access_token('learner@example.test')}"}
    return db, app, client, header


def test_settings_make_mux_signing_optional_with_two_hour_default():
    configured = Settings(database_url="mongodb://localhost", jwt_secret_key="secret")

    assert configured.mux_signing_key_id is None
    assert configured.mux_signing_private_key_base64 is None
    assert configured.mux_playback_token_expire_minutes == 120
    assert configured.mux_playback_restriction_id is None


def test_init_db_creates_learning_unique_and_query_indexes(monkeypatch):
    db = mongomock.MongoClient().chartcoach
    monkeypatch.setattr("app.database.db", db)

    init_db()

    assert db.courses.index_information()["course_id_unique"]["unique"] is True
    assert db.lessons.index_information()["lesson_id_unique"]["unique"] is True
    assert db.media_assets.index_information()["media_asset_id_unique"]["unique"] is True
    assert db.media_assets.index_information()["media_source_checksum_unique"]["unique"] is True
    assert db.media_generations.index_information()["media_generation_id_unique"]["unique"] is True
    assert db.media_content_keys.index_information()["media_content_key_asset_unique"]["unique"] is True
    assert db.playback_sessions.index_information()["playback_session_id_unique"]["unique"] is True
    assert "playback_session_expiry" in db.playback_sessions.index_information()
    assert "processing_jobs_state_lease" in db.processing_jobs.index_information()
    assert db.enrollments.index_information()["user_course_unique"]["unique"] is True
    assert db.lesson_progress.index_information()["user_lesson_unique"]["unique"] is True
    assert "lesson_course_published" in db.lessons.index_information()
    assert "attempts_user_lesson_prompt" in db.prompt_attempts.index_information()


def test_init_db_continues_creating_unrelated_indexes_after_one_failure(monkeypatch, capsys):
    db = mongomock.MongoClient().chartcoach
    monkeypatch.setattr("app.database.db", db)

    def fail_course_index(*args, **kwargs):
        raise RuntimeError("simulated course index failure")

    monkeypatch.setattr(db.courses, "create_index", fail_course_index)

    init_db()

    assert "user_lesson_unique" in db.lesson_progress.index_information()
    assert "attempts_user_lesson_prompt" in db.prompt_attempts.index_information()
    assert "simulated course index failure" in capsys.readouterr().out


def test_get_lesson_authentication_and_enrollment_statuses(api_context):
    db, _, client, header = api_context

    assert client.get("/learning/lessons/l1").status_code == 401
    db.users.update_one({"_id": "user-1"}, {"$set": {"is_active": False}})
    assert client.get("/learning/lessons/l1", headers=header).status_code == 401
    db.users.update_one({"_id": "user-1"}, {"$set": {"is_active": True}})
    db.enrollments.update_one({"user_id": "user-1"}, {"$set": {"active": False}})
    assert client.get("/learning/lessons/l1", headers=header).status_code == 403


def test_get_lesson_returns_404_for_missing_or_unpublished_and_public_data_for_enrolled(api_context):
    db, _, client, header = api_context

    assert client.get("/learning/lessons/missing", headers=header).status_code == 404
    db.lessons.insert_one(lesson_doc(lesson_id="draft", published=False))
    assert client.get("/learning/lessons/draft", headers=header).status_code == 404

    response = client.get("/learning/lessons/l1", headers=header)
    assert response.status_code == 200
    prompt = response.json()["segments"][0]["required_prompt"]
    assert "correct_option_id" not in prompt
    assert "explanation" not in prompt


def test_cookie_auth_and_progress_attempt_routes_use_active_session(api_context):
    _, _, client, header = api_context
    token = header["Authorization"].removeprefix("Bearer ")
    client.cookies.set(AUTH_COOKIE_NAME, token)

    playback = client.post("/learning/lessons/l1/playback")
    assert playback.status_code == 200
    session_id = playback.json()["playback_session_id"]

    mismatch = client.put(
        "/learning/lessons/l1/progress",
        headers=header,
        json={
            "playback_session_id": "rotated",
            "position_seconds": 10,
            "start_seconds": 0,
            "end_seconds": 10,
        },
    )
    assert mismatch.status_code == 409

    reached = client.put(
        "/learning/lessons/l1/progress",
        headers=header,
        json={
            "playback_session_id": session_id,
            "position_seconds": 40,
            "start_seconds": 25,
            "end_seconds": 40,
        },
    )
    assert reached.status_code == 200
    wrong = client.post(
        "/learning/lessons/l1/prompts/p1/attempts",
        headers=header,
        json={"playback_session_id": session_id, "option_id": "b"},
    )
    correct = client.post(
        "/learning/lessons/l1/prompts/p1/attempts",
        headers=header,
        json={"playback_session_id": session_id, "option_id": "a"},
    )
    assert wrong.status_code == correct.status_code == 200
    assert wrong.json()["retry_allowed"] is True
    assert correct.json()["is_correct"] is True


def test_playback_session_endpoint_and_renewal_rotate_the_active_session(api_context):
    _, _, client, header = api_context
    started = client.post("/learning/lessons/l1/playback-sessions", headers=header)
    assert started.status_code == 200
    first_id = started.json()["playback_session_id"]

    renewed = client.post(
        f"/learning/lessons/l1/playback-sessions/{first_id}/renew",
        headers=header,
    )
    assert renewed.status_code == 200
    assert renewed.json()["playback_session_id"] != first_id

    stale = client.post(
        f"/learning/lessons/l1/playback-sessions/{first_id}/renew",
        headers=header,
    )
    assert stale.status_code == 409


def test_playback_returns_controlled_503_when_mux_signing_is_unconfigured(api_context):
    db, app, client, header = api_context
    app.dependency_overrides.pop(learning.get_learning_service)

    response = client.post("/learning/lessons/l1/playback", headers=header)

    assert response.status_code == 503
    assert response.json()["detail"] == "Secure video playback is temporarily unavailable."
    assert db.lesson_progress.count_documents({}) == 0


def test_playback_route_returns_complete_signed_mux_contract_without_user_pii(api_context):
    db, app, client, header = api_context
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
    signer = MuxPlaybackSigner(
        key_id="ephemeral-test-key",
        private_key_base64=base64.b64encode(private_pem).decode("ascii"),
        expire_minutes=120,
    )
    app.dependency_overrides[learning.get_learning_service] = lambda: LearningService(
        db, MuxPlaybackProvider(signer)
    )

    response = client.post("/learning/lessons/l1/playback", headers=header)

    assert response.status_code == 200
    payload = response.json()
    expected_keys = {
        "playback_id",
        "manifest_url",
        "widevine_license_url",
        "playready_license_url",
        "fairplay_license_url",
        "fairplay_certificate_url",
        "playback_token",
        "drm_token",
        "expires_at",
        "playback_session_id",
        "resume_position_seconds",
        "pending_prompt_id",
    }
    assert expected_keys <= payload.keys()
    assert payload["manifest_url"].startswith("https://stream.mux.com/mux-playback-1.m3u8?token=")
    assert payload["widevine_license_url"].startswith("https://license.mux.com/license/widevine/")
    assert payload["playready_license_url"].startswith("https://license.mux.com/license/playready/")
    assert payload["fairplay_license_url"].startswith("https://license.mux.com/license/fairplay/")
    assert payload["fairplay_certificate_url"].startswith("https://license.mux.com/appcert/fairplay/")

    playback_claims = jwt.decode(payload["playback_token"], public_pem, algorithms=["RS256"], audience="v")
    drm_claims = jwt.decode(payload["drm_token"], public_pem, algorithms=["RS256"], audience="d")
    assert playback_claims["sub"] == drm_claims["sub"] == "mux-playback-1"
    assert playback_claims["exp"] == drm_claims["exp"]
    claims_json = json.dumps([playback_claims, drm_claims])
    assert "learner@example.test" not in claims_json
    assert "Learner" not in claims_json
    assert "email" not in playback_claims
    assert "name" not in playback_claims
