"""Idempotently import the single DRM pilot lesson.

Run from ``backend`` with ``python -m scripts.import_pilot_lesson``. The real
Mux playback ID and caption URL must come from CLI arguments or environment.
"""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from typing import Any

import pymongo

from app.domain.learning import Lesson
from app.services.playback_providers import migrate_lesson_media_assets


COURSE_ID = "price-action-secrets"
LESSON_ID = "l1"


def _pilot_lesson(
    mux_playback_id: str | None,
    duration_seconds: float,
    caption_url: str,
    media_asset_id: str | None = None,
    thumbnail_url: str | None = None,
) -> Lesson:
    if duration_seconds < 90:
        raise ValueError("Pilot lesson duration must be at least 90 seconds")
    first_end = round(duration_seconds * 0.32, 3)
    second_end = round(duration_seconds * 0.68, 3)

    def thumbnail_at(seconds: float) -> str:
        if thumbnail_url:
            return thumbnail_url
        if mux_playback_id:
            return f"https://image.mux.com/{mux_playback_id}/thumbnail.jpg?time={seconds:.3f}"
        raise ValueError("thumbnail_url is required for a local media asset")

    payload: dict[str, Any] = {
            "id": LESSON_ID,
            "course_id": COURSE_ID,
            "title": "Price Action Foundations: Reading Market Structure",
            "duration_seconds": duration_seconds,
            "captions": {"language": "en", "label": "English", "url": caption_url},
            "published": True,
            "segments": [
                {
                    "id": "structure-basics",
                    "title": "Map the market structure",
                    "description": "Identify swing highs and lows before forming a directional view.",
                    "start_seconds": 0,
                    "end_seconds": first_end,
                    "thumbnail": {
                        "time_seconds": round(first_end / 2, 3),
                        "url": thumbnail_at(first_end / 2),
                    },
                    "required_prompt": {
                        "id": "structure-check",
                        "question": "Which sequence supports a bullish market structure?",
                        "options": [
                            {"id": "higher", "text": "Higher highs and higher lows"},
                            {"id": "lower", "text": "Lower highs and lower lows"},
                            {"id": "single", "text": "One isolated bullish candle"},
                        ],
                        "correct_option_id": "higher",
                        "explanation": "A repeated sequence of higher highs and higher lows supports bullish structure.",
                    },
                },
                {
                    "id": "break-and-retest",
                    "title": "Evaluate a break and retest",
                    "description": "Distinguish a confirmed structural break from a brief price excursion.",
                    "start_seconds": first_end,
                    "end_seconds": second_end,
                    "thumbnail": {
                        "time_seconds": round((first_end + second_end) / 2, 3),
                        "url": thumbnail_at((first_end + second_end) / 2),
                    },
                    "required_prompt": {
                        "id": "retest-check",
                        "question": "What adds evidence that a breakout is holding?",
                        "options": [
                            {"id": "retest", "text": "A retest that respects the broken level"},
                            {"id": "chase", "text": "Entering after any large candle"},
                            {"id": "ignore", "text": "Ignoring the prior range"},
                        ],
                        "correct_option_id": "retest",
                        "explanation": "A respected retest shows that the former boundary may be acting as support or resistance.",
                    },
                },
                {
                    "id": "risk-aware-review",
                    "title": "Build a risk-aware chart read",
                    "description": "Combine structure and confirmation without treating any setup as certain.",
                    "start_seconds": second_end,
                    "end_seconds": duration_seconds,
                    "thumbnail": {
                        "time_seconds": round((second_end + duration_seconds) / 2, 3),
                        "url": thumbnail_at((second_end + duration_seconds) / 2),
                    },
                    "required_prompt": None,
                },
            ],
        }
    if mux_playback_id:
        payload["mux_playback_id"] = mux_playback_id
    if media_asset_id:
        payload["media_asset_id"] = media_asset_id
    return Lesson.model_validate(payload)


def upsert_pilot_lesson(
    db: Any,
    *,
    mux_playback_id: str | None,
    duration_seconds: float,
    caption_url: str,
    enrollment_email: str | None = None,
    media_asset_id: str | None = None,
    thumbnail_url: str | None = None,
) -> dict[str, int]:
    if bool(mux_playback_id) == bool(media_asset_id):
        raise ValueError("Provide exactly one of mux_playback_id or media_asset_id")
    if media_asset_id and not db.media_assets.find_one(
        {"id": media_asset_id, "source_provider": "local", "state": "ready", "published_generation_id": {"$type": "string"}}
    ):
        raise ValueError("Local media asset must be ready with a published generation")
    lesson = _pilot_lesson(
        mux_playback_id, duration_seconds, caption_url, media_asset_id, thumbnail_url
    )
    now = datetime.now(timezone.utc)
    db.courses.update_one(
        {"id": COURSE_ID},
        {
            "$set": {
                "slug": COURSE_ID,
                "title": "Price Action Secrets",
                "published": True,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    lesson_doc = lesson.to_storage_dict()
    lesson_doc["updated_at"] = now
    db.lessons.update_one(
        {"id": LESSON_ID},
        {"$set": lesson_doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    if mux_playback_id:
        migrate_lesson_media_assets(db)

    enrollment_count = 0
    if enrollment_email:
        normalized_email = enrollment_email.strip().lower()
        user_doc = db.users.find_one({"email": normalized_email})
        if user_doc:
            user_id = str(user_doc["_id"])
            result = db.enrollments.update_one(
                {"user_id": user_id, "course_id": COURSE_ID},
                {
                    "$set": {
                        "email": normalized_email,
                        "active": True,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"enrolled_at": now},
                },
                upsert=True,
            )
            enrollment_count = 1 if result.acknowledged else 0
    return {"courses": 1, "lessons": 1, "enrollments": enrollment_count}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import the ChartCoach DRM pilot lesson")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--database-name", default=os.getenv("DATABASE_NAME", "chartcoach"))
    parser.add_argument("--mux-playback-id", default=os.getenv("MUX_PLAYBACK_ID"))
    parser.add_argument("--media-asset-id", default=os.getenv("PILOT_MEDIA_ASSET_ID"))
    parser.add_argument("--thumbnail-url", default=os.getenv("PILOT_THUMBNAIL_URL"))
    parser.add_argument(
        "--duration-seconds",
        type=float,
        default=float(os.getenv("PILOT_LESSON_DURATION_SECONDS", "900")),
    )
    parser.add_argument("--caption-url", default=os.getenv("PILOT_CAPTION_URL"))
    parser.add_argument("--enrollment-email", default=os.getenv("PILOT_ENROLLMENT_EMAIL"))
    return parser


def main() -> None:
    parser = _parser()
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    if bool(args.mux_playback_id) == bool(args.media_asset_id):
        parser.error("Provide exactly one of --mux-playback-id or --media-asset-id")
    if args.media_asset_id and not args.thumbnail_url:
        parser.error("--thumbnail-url is required with --media-asset-id")
    if not args.caption_url:
        parser.error("--caption-url or PILOT_CAPTION_URL is required")

    client = pymongo.MongoClient(args.database_url, serverSelectionTimeoutMS=5000)
    counts = upsert_pilot_lesson(
        client[args.database_name],
        mux_playback_id=args.mux_playback_id,
        media_asset_id=args.media_asset_id,
        thumbnail_url=args.thumbnail_url,
        duration_seconds=args.duration_seconds,
        caption_url=args.caption_url,
        enrollment_email=args.enrollment_email,
    )
    print(
        "Pilot import complete: "
        f"{counts['courses']} course, {counts['lessons']} lesson, {counts['enrollments']} enrollment."
    )


if __name__ == "__main__":
    main()
