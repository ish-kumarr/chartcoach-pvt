# This file reads settings from the .env file.
# We keep secrets here instead of hardcoding them in code.

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database connection string
    database_url: str
    database_name: str = "chartcoach"
    simulator_database_url: str = "mongodb://127.0.0.1:27019/?replicaSet=simulator-rs&directConnection=true"
    simulator_database_name: str = "chartcoach_simulator"
    simulator_redis_url: str = "redis://localhost:6380/0"

    # Secret key used to sign login tokens (JWT)
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"

    # How long a login token stays valid (in minutes)
    access_token_expire_minutes: int = 60

    # Allowed frontend origin (for CORS)
    frontend_origin: str = "http://localhost:3000"

    # Polygon.io API key for live financial market data & TradingView charts.
    # Configure POLYGON_API_KEY through the backend environment; never commit it.
    polygon_api_key: str = ""

    # Whether the login cookie requires HTTPS. Keep False for local dev over
    # plain http://, but this MUST be True in any real deployment.
    cookie_secure: bool = False

    app_environment: str = "development"
    playback_provider: str = "mux"
    # Vendor DRM credentials may remain pending while local encrypted
    # playback is used for development verification.
    drm_credentials_status: str = "pending"
    media_base_url: str = "http://127.0.0.1:8000"
    local_playback_session_minutes: int = 15
    local_media_wrapping_secret: str | None = None
    media_root: str = "../.media"
    # Production must select a real server-side renderer. The local proof keeps
    # this disabled so existing Clear Key fixtures remain playable.
    watermark_mode: str = "disabled"
    watermark_secret: str | None = None
    watermark_startup_budget_seconds: int = 5
    watermark_renderer_enabled: bool = False

    # Razorpay subscription and webhook settings.
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    razorpay_mock_mode: bool = False

    @property
    def is_razorpay_mock(self) -> bool:
        return self.razorpay_mock_mode or not self.razorpay_key_id or self.razorpay_key_id.startswith("mock_")

    # Mux signing is optional so unrelated APIs can start without video credentials.
    mux_signing_key_id: str | None = None
    mux_signing_private_key_base64: str | None = None
    mux_playback_token_expire_minutes: int = 120
    mux_playback_restriction_id: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


# One shared settings object used everywhere in the app
settings = Settings()
