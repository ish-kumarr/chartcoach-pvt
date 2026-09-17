# This file sets up the connection to the MongoDB database.

from typing import Any

import pymongo
from pymongo.database import Database

from app.config import settings

def create_client() -> Any:
    """Create the configured database client.

    ``mongomock://`` is an explicit local-development mode so contributors can
    run the account/player flow without a MongoDB daemon. Production URLs still
    use a real PyMongo client; there is no silent fallback on connection errors.
    """
    if settings.database_url.startswith("mongomock://"):
        try:
            import mongomock
        except ImportError as exc:  # pragma: no cover - packaging guard
            raise RuntimeError(
                "mongomock is required when DATABASE_URL uses mongomock://"
            ) from exc
        return mongomock.MongoClient()

    return pymongo.MongoClient(
        settings.database_url,
        serverSelectionTimeoutMS=5000,
    )


# MongoClient connection to MongoDB (or explicit in-memory local development).
client: Any = create_client()

# Active database instance
db: Database = client[settings.database_name]


def init_db() -> None:
    # Keep the market-product indexes and the protected-learning indexes
    # independent so a failure in one collection does not block startup.
    index_specs = [
        ("users_email", db.users, "email", {"unique": True}),
        ("users_public_user_id", db.users, "public_user_id", {"unique": True, "sparse": True}),
        ("course_id_unique", db.courses, "id", {"unique": True, "name": "course_id_unique"}),
        ("courses_level", db.courses, "levelNumber", {}),
        ("course_slug_unique", db.courses, "slug", {"unique": True, "name": "course_slug_unique"}),
        ("lesson_id_unique", db.lessons, "id", {"unique": True, "name": "lesson_id_unique"}),
        (
            "media_asset_id_unique",
            db.media_assets,
            "id",
            {"unique": True, "name": "media_asset_id_unique"},
        ),
        (
            "media_source_checksum_unique",
            db.media_assets,
            "source_checksum",
            {"unique": True, "sparse": True, "name": "media_source_checksum_unique"},
        ),
        (
            "media_generation_id_unique",
            db.media_generations,
            "id",
            {"unique": True, "name": "media_generation_id_unique"},
        ),
        (
            "media_content_key_asset_unique",
            db.media_content_keys,
            "asset_id",
            {"unique": True, "name": "media_content_key_asset_unique"},
        ),
        (
            "playback_session_id_unique",
            db.playback_sessions,
            "id",
            {"unique": True, "name": "playback_session_id_unique"},
        ),
        (
            "playback_session_expiry",
            db.playback_sessions,
            "expires_at",
            {"expireAfterSeconds": 0, "name": "playback_session_expiry"},
        ),
        (
            "processing_jobs_state_lease",
            db.processing_jobs,
            [("state", pymongo.ASCENDING), ("lease_expires_at", pymongo.ASCENDING), ("created_at", pymongo.ASCENDING)],
            {"name": "processing_jobs_state_lease"},
        ),
        (
            "lesson_course_published",
            db.lessons,
            [("course_id", pymongo.ASCENDING), ("published", pymongo.ASCENDING)],
            {"name": "lesson_course_published"},
        ),
        (
            "user_course_unique",
            db.enrollments,
            [("user_id", pymongo.ASCENDING), ("course_id", pymongo.ASCENDING)],
            {"unique": True, "name": "user_course_unique"},
        ),
        (
            "enrollment_email_course_active",
            db.enrollments,
            [("email", pymongo.ASCENDING), ("course_id", pymongo.ASCENDING), ("active", pymongo.ASCENDING)],
            {"name": "enrollment_email_course_active"},
        ),
        (
            "user_lesson_unique",
            db.lesson_progress,
            [("user_id", pymongo.ASCENDING), ("lesson_id", pymongo.ASCENDING)],
            {"unique": True, "name": "user_lesson_unique"},
        ),
        (
            "attempts_user_lesson_prompt",
            db.prompt_attempts,
            [
                ("user_id", pymongo.ASCENDING),
                ("lesson_id", pymongo.ASCENDING),
                ("prompt_id", pymongo.ASCENDING),
                ("attempted_at", pymongo.DESCENDING),
            ],
            {"name": "attempts_user_lesson_prompt"},
        ),
        ("enrollment_status", db.enrollments, [("user_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)], {}),
        ("lesson_progress_course", db.lesson_progress, [("user_id", pymongo.ASCENDING), ("course_id", pymongo.ASCENDING)], {}),
        ("lesson_progress_recent", db.lesson_progress, [("user_id", pymongo.ASCENDING), ("last_watched_at", pymongo.DESCENDING)], {}),
        ("learning_activities_recent", db.learning_activities, [("user_id", pymongo.ASCENDING), ("occurred_at", pymongo.DESCENDING)], {}),
        ("watchlists_default", db.watchlists, [("user_id", pymongo.ASCENDING), ("is_default", pymongo.DESCENDING)], {}),
        ("watchlist_item_unique", db.watchlist_items, [("watchlist_id", pymongo.ASCENDING), ("symbol", pymongo.ASCENDING), ("exchange", pymongo.ASCENDING)], {"unique": True}),
        ("ai_conversations_recent", db.ai_conversations, [("user_id", pymongo.ASCENDING), ("updated_at", pymongo.DESCENDING)], {}),
        ("ai_messages_order", db.ai_messages, [("conversation_id", pymongo.ASCENDING), ("created_at", pymongo.ASCENDING)], {}),
        ("notifications_recent", db.notifications, [("user_id", pymongo.ASCENDING), ("read_at", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)], {}),
        ("session_registration_unique", db.session_registrations, [("session_id", pymongo.ASCENDING), ("user_id", pymongo.ASCENDING)], {"unique": True}),
        ("subscription_plans_slug", db.subscriptionPlans, "slug", {"unique": True}),
        ("subscriptions_user_status", db.subscriptions, [("user_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)], {}),
        ("subscriptions_razorpay_id", db.subscriptions, "razorpay_subscription_id", {"unique": True, "sparse": True}),
        ("payments_razorpay_id", db.payments, "razorpay_payment_id", {"unique": True, "sparse": True}),
        ("payments_user_created", db.payments, [("user_id", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)], {}),
        ("gem_wallets_user", db.gemWallets, "user_id", {"unique": True}),
        ("gem_transactions_user_created", db.gemTransactions, [("user_id", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)], {}),
        ("usage_records_user_capability", db.usageRecords, [("user_id", pymongo.ASCENDING), ("capability", pymongo.ASCENDING)], {}),
        ("checkout_sessions_user_status", db.checkoutSessions, [("user_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)], {}),
        ("checkout_sessions_subscription", db.checkoutSessions, "subscription_id", {"sparse": True}),
        ("coupons_code", db.coupons, "code", {"unique": True}),
        ("course_purchases_user_course", db.coursePurchases, [("user_id", pymongo.ASCENDING), ("course_id", pymongo.ASCENDING)], {"unique": True}),
        ("gem_packages_id", db.gemPackages, "package_id", {"unique": True}),
        ("audit_logs_user_timestamp", db.auditLogs, [("user_id", pymongo.ASCENDING), ("timestamp", pymongo.DESCENDING)], {}),
        ("simulator_accounts_learner_mode_status", db.simulator_accounts, [("learner_id", pymongo.ASCENDING), ("mode", pymongo.ASCENDING), ("status", pymongo.ASCENDING)], {}),
        ("simulator_sessions_learner_created", db.simulator_sessions, [("learner_id", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)], {}),
        ("simulator_events_session_sequence", db.simulator_events, [("session_id", pymongo.ASCENDING), ("sequence", pymongo.ASCENDING)], {"unique": True}),
        ("simulator_idempotency_session_key", db.simulator_idempotency, [("session_id", pymongo.ASCENDING), ("key", pymongo.ASCENDING)], {"unique": True}),
        ("simulator_command_idempotency_scope_key", db.simulator_command_idempotency, [("session_id", pymongo.ASCENDING), ("scope", pymongo.ASCENDING), ("key", pymongo.ASCENDING)], {"unique": True}),
        ("simulator_positions_session_instrument", db.simulator_positions, [("session_id", pymongo.ASCENDING), ("instrument_id", pymongo.ASCENDING)], {"unique": True}),
    ]
    for label, collection, keys, options in index_specs:
        try:
            collection.create_index(keys, **options)
        except Exception as exc:
            print(f"Warning ensuring MongoDB index {label}: {exc}")


def get_db() -> Database:
    # FastAPI dependency yielding database handle
    return db


# Backward-compatible factory for contexts (e.g. websockets) that previously used SessionLocal
def SessionLocal() -> Database:
    return db
