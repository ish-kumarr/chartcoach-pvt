import mongomock

from app import database


def test_mongomock_database_url_creates_isolated_in_memory_client(monkeypatch):
    monkeypatch.setattr(database.settings, "database_url", "mongomock://local")

    client = database.create_client()
    client["chartcoach"].users.insert_one({"email": "local@example.com"})

    assert isinstance(client, mongomock.MongoClient)
    assert client["chartcoach"].users.find_one({"email": "local@example.com"}) is not None
