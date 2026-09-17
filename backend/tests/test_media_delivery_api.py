from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import mongomock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import media
from app.database import get_db
from app.services.media_keys import DevelopmentKeyBroker


def make_client(tmp_path):
    db = mongomock.MongoClient().chartcoach
    package = tmp_path / "outputs" / "asset-1" / "generation-1" / "package"
    package.mkdir(parents=True)
    (package / "master.m3u8").write_text("#EXTM3U\n360p.m3u8\n", encoding="utf-8")
    (package / "360p.m3u8").write_text("#EXTM3U\nvideo_1.m4s\n", encoding="utf-8")
    (package / "video_1.m4s").write_bytes(b"encrypted-segment")
    db.media_assets.insert_one(
        {"id": "asset-1", "state": "ready", "published_generation_id": "generation-1"}
    )
    db.media_generations.insert_one(
        {
            "id": "generation-1",
            "asset_id": "asset-1",
            "state": "published",
            "encryption": {"type": "development-clear-key", "scheme": "cenc"},
        }
    )
    db.courses.insert_one({"id": "course-1", "published": True})
    db.lessons.insert_one(
        {"id": "lesson-1", "course_id": "course-1", "published": True}
    )
    db.enrollments.insert_one(
        {"user_id": "user-1", "course_id": "course-1", "active": True}
    )
    db.playback_sessions.insert_one(
        {
            "id": "session-1",
            "user_id": "user-1",
            "lesson_id": "lesson-1",
            "course_id": "course-1",
            "asset_id": "asset-1",
            "generation_id": "generation-1",
            "status": "active",
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
        }
    )
    broker = DevelopmentKeyBroker(
        db,
        environment="test",
        wrapping_secret="local-test-wrapping-secret-with-enough-entropy",
    )
    app = FastAPI()
    app.include_router(media.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[media.get_current_user] = lambda: SimpleNamespace(id="user-1")
    app.dependency_overrides[media.get_key_broker] = lambda: broker
    app.dependency_overrides[media.get_media_root] = lambda: tmp_path
    return db, app, TestClient(app)


def test_session_scoped_media_and_clear_key_are_delivered(tmp_path):
    db, _, client = make_client(tmp_path)

    manifest = client.get("/media/playback-sessions/session-1/master.m3u8")
    license_response = client.post("/media/playback-sessions/session-1/clearkey", json={"kids": []})

    assert manifest.status_code == 200
    assert manifest.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    assert license_response.status_code == 200
    body = license_response.json()
    assert body["type"] == "temporary"
    assert body["keys"][0]["kty"] == "oct"
    assert body["keys"][0]["kid"]
    assert body["keys"][0]["k"]
    assert body["keys"][0]["k"] not in repr(db.media_content_keys.find_one())


def test_media_delivery_rejects_wrong_user_expiry_rotation_and_traversal(tmp_path):
    db, app, client = make_client(tmp_path)

    app.dependency_overrides[media.get_current_user] = lambda: SimpleNamespace(id="other-user")
    assert client.get("/media/playback-sessions/session-1/master.m3u8").status_code == 403

    app.dependency_overrides[media.get_current_user] = lambda: SimpleNamespace(id="user-1")
    db.playback_sessions.update_one(
        {"id": "session-1"}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}}
    )
    assert client.get("/media/playback-sessions/session-1/master.m3u8").status_code == 403

    db.playback_sessions.update_one(
        {"id": "session-1"},
        {"$set": {"expires_at": datetime.now(timezone.utc) + timedelta(minutes=5), "status": "rotated"}},
    )
    assert client.post("/media/playback-sessions/session-1/clearkey", json={}).status_code == 403
    assert client.get("/media/playback-sessions/session-1/%2e%2e/secret").status_code in {403, 404}


def test_media_delivery_rechecks_current_enrollment(tmp_path):
    db, app, client = make_client(tmp_path)

    db.enrollments.update_one(
        {"user_id": "user-1", "course_id": "course-1"}, {"$set": {"active": False}}
    )
    assert client.get("/media/playback-sessions/session-1/master.m3u8").status_code == 403

    app.dependency_overrides[media.get_current_user] = lambda: SimpleNamespace(id="other-user")
    assert client.post("/media/playback-sessions/session-1/clearkey", json={}).status_code == 403


def test_server_watermark_sessions_cannot_receive_unwatermarked_or_mismatched_generation(tmp_path):
    db, _, client = make_client(tmp_path)
    db.playback_sessions.update_one(
        {"id": "session-1"},
        {"$set": {"watermark_mode": "server", "watermark_forensic_id": "forensic-1"}},
    )
    assert client.get("/media/playback-sessions/session-1/master.m3u8").status_code == 403

    db.media_generations.update_one(
        {"id": "generation-1"},
        {"$set": {"watermark": {"mode": "server", "forensic_id": "forensic-2"}}},
    )
    assert client.get("/media/playback-sessions/session-1/master.m3u8").status_code == 403

    db.media_generations.update_one(
        {"id": "generation-1"},
        {"$set": {"watermark": {"mode": "server", "forensic_id": "forensic-1"}}},
    )
    assert client.get("/media/playback-sessions/session-1/master.m3u8").status_code == 200
