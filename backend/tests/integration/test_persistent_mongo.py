import os
from uuid import uuid4

import pytest
from pymongo import MongoClient


LOCAL_MONGODB_TEST_URL = os.getenv("LOCAL_MONGODB_TEST_URL")


@pytest.mark.skipif(
    not LOCAL_MONGODB_TEST_URL,
    reason="LOCAL_MONGODB_TEST_URL is required for the Docker persistence check",
)
def test_document_survives_a_fresh_mongo_client() -> None:
    marker = uuid4().hex
    first = MongoClient(LOCAL_MONGODB_TEST_URL, serverSelectionTimeoutMS=2_000)
    collection = first["chartcoach_local_acceptance"]["persistence_checks"]

    try:
        collection.insert_one({"marker": marker})
    finally:
        first.close()

    second = MongoClient(LOCAL_MONGODB_TEST_URL, serverSelectionTimeoutMS=2_000)
    try:
        persisted = second["chartcoach_local_acceptance"]["persistence_checks"].find_one(
            {"marker": marker}
        )
        assert persisted is not None
    finally:
        second["chartcoach_local_acceptance"]["persistence_checks"].delete_one(
            {"marker": marker}
        )
        second.close()
