from functools import lru_cache

import pymongo

from app.config import settings


@lru_cache
def get_simulator_client():
    return pymongo.MongoClient(settings.simulator_database_url, serverSelectionTimeoutMS=5000, retryWrites=True)


def get_simulator_db():
    return get_simulator_client()[settings.simulator_database_name]
