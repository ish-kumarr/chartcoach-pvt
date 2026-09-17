import mongomock
import pytest

from app.services.media_keys import DevelopmentKeyBroker, DevelopmentKeyUnavailable


def test_development_key_is_stable_and_never_stored_in_plaintext():
    db = mongomock.MongoClient().chartcoach
    broker = DevelopmentKeyBroker(
        db,
        environment="development",
        wrapping_secret="local-test-wrapping-secret-with-enough-entropy",
    )

    first = broker.get_or_create("asset-1")
    second = broker.get_or_create("asset-1")
    stored = db.media_content_keys.find_one({"asset_id": "asset-1"})

    assert first == second
    assert len(first["kid_hex"]) == 32
    assert len(first["key_hex"]) == 32
    assert first["key_hex"] not in repr(stored)
    assert first["kid"]
    assert first["key"]
    assert "encrypted_key" in stored
    assert db.media_content_keys.count_documents({"asset_id": "asset-1"}) == 1


def test_development_key_broker_is_refused_in_production():
    broker = DevelopmentKeyBroker(
        mongomock.MongoClient().chartcoach,
        environment="production",
        wrapping_secret="local-test-wrapping-secret-with-enough-entropy",
    )

    with pytest.raises(DevelopmentKeyUnavailable, match="development-only"):
        broker.get_or_create("asset-1")


def test_development_key_broker_requires_a_wrapping_secret():
    broker = DevelopmentKeyBroker(
        mongomock.MongoClient().chartcoach,
        environment="development",
        wrapping_secret=None,
    )

    with pytest.raises(DevelopmentKeyUnavailable, match="wrapping secret"):
        broker.get_or_create("asset-1")
