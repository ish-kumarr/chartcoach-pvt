# This is the entry point of the FastAPI app.
# It creates the app, sets up CORS, and connects all the routes.

from contextlib import asynccontextmanager
from time import perf_counter
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import auth, courses, face, learning, media, monitor, simulator, users
from app.api.v1 import (
    courses as courses_v1,
    dashboard as dashboard_v1,
    learning as learning_v1,
    market as market_v1,
    billing as billing_v1,
    gems as gems_v1,
    coach as coach_v1,
)
from app.config import settings
from app.core.face_engine import load_face_app
from app.core.rate_limit import limiter
from app.core.errors import (
    AppError,
    app_error_handler,
    http_exception_handler,
    validation_exception_handler,
    generate_request_id,
)
from app.database import init_db
from app.services.drm_readiness import get_drm_readiness


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database indexes
    init_db()
    # Load the face recognition model once, when the server starts,
    # so the first user request does not have to wait for it.
    load_face_app()
    yield


app = FastAPI(title="ChartCoach API", version="0.1.0", lifespan=lifespan)

# Correlation ID middleware
@app.middleware("http")
async def correlation_id_middleware(request, call_next):
    request.state.request_id = request.headers.get("x-request-id") or generate_request_id()
    response = await call_next(request)
    response.headers["x-request-id"] = request.state.request_id
    return response


@app.middleware("http")
async def server_timing_middleware(request, call_next):
    started_at = perf_counter()
    response = await call_next(request)
    if request.url.path.startswith("/learning/lessons/"):
        response.headers["Server-Timing"] = f"app;dur={(perf_counter() - started_at) * 1000:.1f}"
    return response

# Wire up rate limiting & standardized error envelopes
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)

# CORS lets the Next.js frontend (a different port) call this API from the browser
allowed_frontend_origins = [settings.frontend_origin.rstrip("/")]
configured_origin = urlsplit(settings.frontend_origin)
if configured_origin.hostname in {"localhost", "127.0.0.1"}:
    port = f":{configured_origin.port}" if configured_origin.port else ""
    for hostname in ("localhost", "127.0.0.1"):
        origin = f"{configured_origin.scheme}://{hostname}{port}"
        if origin not in allowed_frontend_origins:
            allowed_frontend_origins.append(origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Server-Timing", "X-Request-ID"],
)

# Connect the route files to the app
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(face.router)
app.include_router(monitor.router)
app.include_router(learning.router)
app.include_router(media.router)
app.include_router(courses.router)
# Version 1 Modular Domain Routes
app.include_router(dashboard_v1.router)
app.include_router(learning_v1.router)
app.include_router(courses_v1.router)
app.include_router(market_v1.router)
app.include_router(billing_v1.router)
app.include_router(gems_v1.router)
app.include_router(coach_v1.router)
app.include_router(simulator.router)
app.include_router(simulator.admin_router)


@app.get("/health")
def health_check():
    # Simple route to check the API is running
    return {"status": "ok"}


@app.get("/health/drm")
def drm_health_check():
    """Expose non-secret DRM readiness for local operators and diagnostics."""
    return get_drm_readiness(settings)
