"""
Standardized API Error Envelope and Custom Exceptions for ChartCoach.
Complies with Section 35 of the Senior Engineering Specification.
"""

import time
import os
from typing import Optional, Dict, Any
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException


def generate_request_id() -> str:
    """Generate a lightweight, unique correlation/request ID."""
    t = int(time.time() * 1000)
    r = os.urandom(4).hex()
    return f"req_{t}_{r}"


class AppError(Exception):
    """Base application exception with explicit error code and HTTP status."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def build_error_response(
    code: str,
    message: str,
    status_code: int,
    request_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> JSONResponse:
    """Builds a standardized error envelope JSON response."""
    payload = {
        "success": False,
        "error": {
            "code": code,
            "message": message,
        },
        "requestId": request_id or generate_request_id(),
    }
    if details:
        payload["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=payload)


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    req_id = getattr(request.state, "request_id", None) or generate_request_id()
    return build_error_response(
        code=exc.code,
        message=exc.message,
        status_code=exc.status_code,
        request_id=req_id,
        details=exc.details,
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    req_id = getattr(request.state, "request_id", None) or generate_request_id()
    code = "HTTP_ERROR"
    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        code = "UNAUTHORIZED"
    elif exc.status_code == status.HTTP_403_FORBIDDEN:
        code = "FORBIDDEN"
    elif exc.status_code == status.HTTP_404_NOT_FOUND:
        code = "NOT_FOUND"
    elif exc.status_code == status.HTTP_409_CONFLICT:
        code = "CONFLICT"
    elif exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        code = "RATE_LIMIT_EXCEEDED"

    if isinstance(exc.detail, dict):
        code = exc.detail.get("code", code)
        message = exc.detail.get("message", "An HTTP error occurred.")
        details = {key: value for key, value in exc.detail.items() if key not in {"code", "message"}}
    else:
        message = exc.detail if isinstance(exc.detail, str) else "An HTTP error occurred."
        details = None
    return build_error_response(
        code=code,
        message=message,
        status_code=exc.status_code,
        request_id=req_id,
        details=details,
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    req_id = getattr(request.state, "request_id", None) or generate_request_id()
    first_error = exc.errors()[0] if exc.errors() else {}
    msg = first_error.get("msg", "Invalid request parameters.")
    field = ".".join(str(loc) for loc in first_error.get("loc", []))
    if field:
        msg = f"{field}: {msg}"

    return build_error_response(
        code="VALIDATION_ERROR",
        message=msg,
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        request_id=req_id,
        details={"errors": exc.errors()},
    )
