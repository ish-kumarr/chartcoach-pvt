import os


os.environ.setdefault("DATABASE_URL", "mongodb://localhost:27017")
os.environ.setdefault("DATABASE_NAME", "chartcoach_test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
