"""Idempotently link legacy Mux lessons to provider-neutral media assets."""

from __future__ import annotations

import argparse
import os

import pymongo

from app.services.playback_providers import migrate_lesson_media_assets


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--database-name", default=os.getenv("DATABASE_NAME", "chartcoach"))
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    client = pymongo.MongoClient(args.database_url, serverSelectionTimeoutMS=5000)
    result = migrate_lesson_media_assets(client[args.database_name])
    print(f"Media asset migration complete: {result['created']} created, {result['linked']} linked.")


if __name__ == "__main__":
    main()
