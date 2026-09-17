import mongomock

from app.domain.learning import Lesson
from scripts.import_pilot_lesson import upsert_pilot_lesson


def test_pilot_import_is_idempotent_and_derives_three_safe_segments():
    db = mongomock.MongoClient().chartcoach
    db.users.insert_one({"_id": "user-1", "email": "learner@example.test"})

    upsert_pilot_lesson(
        db,
        mux_playback_id="mux-first",
        duration_seconds=900,
        caption_url="https://captions.example.test/l1.vtt",
        enrollment_email="Learner@Example.Test",
    )
    upsert_pilot_lesson(
        db,
        mux_playback_id="mux-updated",
        duration_seconds=1200,
        caption_url="https://captions.example.test/l1-updated.vtt",
        enrollment_email="learner@example.test",
    )

    assert db.courses.count_documents({"id": "price-action-secrets"}) == 1
    assert db.lessons.count_documents({"id": "l1"}) == 1
    assert db.enrollments.count_documents(
        {"user_id": "user-1", "course_id": "price-action-secrets"}
    ) == 1
    lesson = Lesson.model_validate(db.lessons.find_one({"id": "l1"}))
    assert lesson.mux_playback_id == "mux-updated"
    assert lesson.duration_seconds == 1200
    assert len(lesson.segments) == 3
    assert sum(segment.required_prompt is not None for segment in lesson.segments) >= 2
    assert lesson.segments[-1].end_seconds == lesson.duration_seconds
    assert lesson.captions.language == "en"


def test_pilot_import_skips_enrollment_when_requested_user_does_not_exist():
    db = mongomock.MongoClient().chartcoach

    result = upsert_pilot_lesson(
        db,
        mux_playback_id="mux-first",
        duration_seconds=900,
        caption_url="https://captions.example.test/l1.vtt",
        enrollment_email="unknown@example.test",
    )

    assert result["enrollments"] == 0
    assert db.enrollments.count_documents({}) == 0


def test_pilot_import_can_link_a_ready_local_media_asset():
    db = mongomock.MongoClient().chartcoach
    db.users.insert_one({"_id": "user-1", "email": "learner@example.test"})
    db.media_assets.insert_one(
        {
            "id": "asset-local-1",
            "source_provider": "local",
            "state": "ready",
            "published_generation_id": "generation-1",
        }
    )

    result = upsert_pilot_lesson(
        db,
        mux_playback_id=None,
        media_asset_id="asset-local-1",
        duration_seconds=900,
        caption_url="https://captions.example.test/l1.vtt",
        thumbnail_url="https://media.example.test/poster.jpg",
        enrollment_email="learner@example.test",
    )

    lesson = Lesson.model_validate(db.lessons.find_one({"id": "l1"}))
    assert result["enrollments"] == 1
    assert lesson.media_asset_id == "asset-local-1"
    assert lesson.mux_playback_id is None
    assert lesson.segments[0].thumbnail.url == "https://media.example.test/poster.jpg"
