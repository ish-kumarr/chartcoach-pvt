from types import SimpleNamespace

import mongomock
import pytest

from app.domain.learning import Lesson, ProgressError
from app.services.learning import (
    EnrollmentRequired,
    LearningService,
    LessonNotFound,
    PlaybackSessionMismatch,
    PromptNotReady,
)
from app.services.playback_providers import PlaybackProviderUnavailable
from app.config import settings


class StaticSigner:
    def authorize(self, playback_id: str, lesson_duration_seconds: float, playback_session_id=None):
        return {"playback_id": playback_id, "manifest_url": "https://signed.example.test/manifest"}


def lesson_doc(*, published: bool = True) -> dict:
    return Lesson.model_validate(
        {
            "id": "l1",
            "course_id": "price-action-secrets",
            "title": "Market structure",
            "duration_seconds": 100,
            "mux_playback_id": "mux-playback-1",
            "captions": {"language": "en", "label": "English", "url": "https://example.test/l1.vtt"},
            "published": published,
            "segments": [
                {
                    "id": "s1",
                    "title": "First structure",
                    "description": "Observe the first swing.",
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
                    "title": "Second structure",
                    "description": "Observe continuation.",
                    "start_seconds": 40,
                    "end_seconds": 100,
                    "thumbnail": {"time_seconds": 50, "url": "https://example.test/s2.jpg"},
                    "required_prompt": None,
                },
            ],
        }
    ).to_storage_dict()


@pytest.fixture
def service_context():
    db = mongomock.MongoClient().chartcoach
    db.courses.insert_one(
        {"id": "price-action-secrets", "slug": "price-action-secrets", "title": "Price Action Secrets", "published": True}
    )
    db.lessons.insert_one(lesson_doc())
    user = SimpleNamespace(id="user-1", email="learner@example.test", is_active=True)
    db.enrollments.insert_one(
        {
            "user_id": user.id,
            "email": user.email,
            "course_id": "price-action-secrets",
            "active": True,
        }
    )
    return db, user, LearningService(db, signer=StaticSigner())


def test_get_lesson_requires_published_course_lesson_and_active_enrollment(service_context):
    db, user, service = service_context

    public = service.get_lesson("l1", user)
    assert public["id"] == "l1"
    assert public["progress"]["watch_percent"] == 0.0
    assert "mux_playback_id" not in public
    assert "correct_option_id" not in public["segments"][0]["required_prompt"]

    db.enrollments.update_one({"user_id": user.id}, {"$set": {"active": False}})
    with pytest.raises(EnrollmentRequired):
        service.get_lesson("l1", user)

    db.lessons.update_one({"id": "l1"}, {"$set": {"published": False}})
    with pytest.raises(LessonNotFound):
        service.get_lesson("l1", user)


def test_email_only_enrollment_cannot_authorize_but_matching_user_id_can(service_context):
    db, user, service = service_context
    db.enrollments.replace_one(
        {"course_id": "price-action-secrets"},
        {
            "user_id": "another-user",
            "email": user.email,
            "course_id": "price-action-secrets",
            "active": True,
        },
    )

    with pytest.raises(EnrollmentRequired):
        service.get_lesson("l1", user)

    db.enrollments.update_one(
        {"course_id": "price-action-secrets"},
        {"$set": {"user_id": user.id, "email": "stale@example.test"}},
    )
    assert service.get_lesson("l1", user)["id"] == "l1"


def test_playback_rotates_session_and_returns_resume_and_pending_state(service_context):
    db, user, service = service_context
    db.lesson_progress.insert_one(
        {
            "user_id": user.id,
            "lesson_id": "l1",
            "playback_session_id": "old-session",
            "resume_position_seconds": 40,
            "watched_intervals": [[0, 40]],
            "passed_prompt_ids": [],
        }
    )

    first = service.start_playback("l1", user)
    second = service.start_playback("l1", user)

    assert first["playback_session_id"] != "old-session"
    assert second["playback_session_id"] != first["playback_session_id"]
    assert first["resume_position_seconds"] == 40.0
    assert first["pending_prompt_id"] == "p1"
    assert db.lesson_progress.find_one({"user_id": user.id, "lesson_id": "l1"})[
        "playback_session_id"
    ] == second["playback_session_id"]
    active = db.playback_sessions.find_one({"id": second["playback_session_id"]})
    previous = db.playback_sessions.find_one({"id": first["playback_session_id"]})
    assert active["status"] == "active"
    assert active["user_id"] == user.id
    assert active["lesson_id"] == "l1"
    assert previous["status"] == "rotated"


def test_progress_rejects_missing_or_rotated_session(service_context):
    _, user, service = service_context

    with pytest.raises(PlaybackSessionMismatch):
        service.update_progress("l1", user, "missing", 5, [0, 5])

    playback = service.start_playback("l1", user)
    with pytest.raises(PlaybackSessionMismatch):
        service.update_progress("l1", user, "rotated", 5, [0, 5])
    assert playback["playback_session_id"] != "rotated"


def test_progress_write_rejects_session_rotated_after_read(service_context, monkeypatch):
    db, user, service = service_context
    session_id = service.start_playback("l1", user)["playback_session_id"]
    real_replace = db.lesson_progress.replace_one

    def rotate_then_replace(query, replacement, upsert=False):
        db.lesson_progress.update_one(
            {"user_id": user.id, "lesson_id": "l1"},
            {"$set": {"playback_session_id": "newer-session"}},
        )
        return real_replace(query, replacement, upsert=upsert)

    monkeypatch.setattr(db.lesson_progress, "replace_one", rotate_then_replace)

    with pytest.raises(PlaybackSessionMismatch):
        service.update_progress("l1", user, session_id, 10, [0, 10])
    assert db.lesson_progress.find_one({"user_id": user.id})["playback_session_id"] == "newer-session"


def test_progress_merges_intervals_and_enforces_next_prompt_gate(service_context):
    _, user, service = service_context
    session_id = service.start_playback("l1", user)["playback_session_id"]

    service.update_progress("l1", user, session_id, 10, [0, 10])
    progress = service.update_progress("l1", user, session_id, 15, [8, 15])

    assert progress["watched_intervals"] == [[0.0, 15.0]]
    assert progress["watched_seconds"] == 15.0
    with pytest.raises(ProgressError, match="required prompt"):
        service.update_progress("l1", user, session_id, 41, [39, 41])


def test_wrong_attempt_is_persisted_and_retryable_then_correct_attempt_passes_prompt(service_context):
    db, user, service = service_context
    session_id = service.start_playback("l1", user)["playback_session_id"]
    service.update_progress("l1", user, session_id, 40, [25, 40])

    wrong = service.attempt_prompt("l1", "p1", user, session_id, "b")
    correct = service.attempt_prompt("l1", "p1", user, session_id, "a")

    assert wrong["is_correct"] is False
    assert wrong["retry_allowed"] is True
    assert wrong["explanation"] == "Higher highs and higher lows confirm it."
    assert wrong["progress"]["passed_prompt_ids"] == []
    assert correct["is_correct"] is True
    assert correct["progress"]["passed_prompt_ids"] == ["p1"]
    assert db.prompt_attempts.count_documents({"user_id": user.id, "prompt_id": "p1"}) == 2
    saved_wrong = db.prompt_attempts.find_one({"user_id": user.id, "prompt_id": "p1", "selected_option": "b"})
    assert saved_wrong["correctness"] is False
    assert saved_wrong["feedback_returned"] == wrong["feedback"]


def test_prompt_attempt_requires_boundary_and_valid_option(service_context):
    _, user, service = service_context
    session_id = service.start_playback("l1", user)["playback_session_id"]

    with pytest.raises(PromptNotReady, match="boundary"):
        service.attempt_prompt("l1", "p1", user, session_id, "a")
    service.update_progress("l1", user, session_id, 40, [25, 40])
    with pytest.raises(ProgressError, match="option_id"):
        service.attempt_prompt("l1", "p1", user, session_id, "missing")


def test_prompt_write_rejects_session_rotated_after_read(service_context, monkeypatch):
    db, user, service = service_context
    session_id = service.start_playback("l1", user)["playback_session_id"]
    service.update_progress("l1", user, session_id, 40, [25, 40])
    real_replace = db.lesson_progress.replace_one

    def rotate_then_replace(query, replacement, upsert=False):
        db.lesson_progress.update_one(
            {"user_id": user.id, "lesson_id": "l1"},
            {"$set": {"playback_session_id": "newer-session"}},
        )
        return real_replace(query, replacement, upsert=upsert)

    monkeypatch.setattr(db.lesson_progress, "replace_one", rotate_then_replace)

    with pytest.raises(PlaybackSessionMismatch):
        service.attempt_prompt("l1", "p1", user, session_id, "a")
    assert db.lesson_progress.find_one({"user_id": user.id})["playback_session_id"] == "newer-session"
    assert db.prompt_attempts.count_documents({"user_id": user.id, "lesson_id": "l1"}) == 0


def test_progress_completes_only_after_coverage_and_required_prompt_pass(service_context):
    _, user, service = service_context
    session_id = service.start_playback("l1", user)["playback_session_id"]
    for start in range(0, 40, 10):
        service.update_progress("l1", user, session_id, start + 10, [start, start + 10])
    service.attempt_prompt("l1", "p1", user, session_id, "a")
    last = None
    for start in range(40, 90, 10):
        last = service.update_progress("l1", user, session_id, start + 10, [start, start + 10])

    assert last["watched_seconds"] == 90.0
    assert last["completed"] is True
    assert last["completed_at"] is not None


def test_production_watermark_mode_fails_closed_without_renderer(service_context, monkeypatch):
    _, user, service = service_context
    monkeypatch.setattr(settings, "watermark_mode", "server")
    monkeypatch.setattr(settings, "watermark_secret", "watermark-secret")
    monkeypatch.setattr(settings, "watermark_renderer_enabled", False)

    with pytest.raises(PlaybackProviderUnavailable, match="watermarking is not ready"):
        service.start_playback("l1", user)
