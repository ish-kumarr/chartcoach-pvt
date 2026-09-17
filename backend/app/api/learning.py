from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pymongo.database import Database

from app.api.deps import get_current_user
from app.config import settings
from app.core.rate_limit import limiter
from app.database import get_db
from app.domain.learning import ProgressError
from app.models.user import User
from app.schemas.learning import ProgressUpdateIn, PromptAttemptIn
from app.services.learning import (
    EnrollmentRequired,
    LearningService,
    LessonNotFound,
    PlaybackSessionMismatch,
    PromptNotFound,
    PromptNotReady,
)
from app.services.mux import MuxSigningUnavailable
from app.services.playback_providers import (
    PlaybackProviderUnavailable,
    build_playback_provider,
)


router = APIRouter(prefix="/learning", tags=["learning"])


def get_learning_service(db: Database = Depends(get_db)) -> LearningService:
    return LearningService(db, build_playback_provider(settings))


def _translate_service_error(operation: Callable[[], Any]) -> Any:
    try:
        return operation()
    except LessonNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EnrollmentRequired as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except PromptNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (PlaybackSessionMismatch, PromptNotReady) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ProgressError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except (MuxSigningUnavailable, PlaybackProviderUnavailable) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Secure video playback is temporarily unavailable.",
        ) from exc


@router.get("/lessons/{lesson_id}")
def get_lesson(
    lesson_id: str,
    user: User = Depends(get_current_user),
    service: LearningService = Depends(get_learning_service),
):
    return _translate_service_error(lambda: service.get_lesson(lesson_id, user))


@router.post("/lessons/{lesson_id}/playback")
@limiter.limit("30/minute")
def start_playback(
    request: Request,
    lesson_id: str,
    user: User = Depends(get_current_user),
    service: LearningService = Depends(get_learning_service),
):
    return _translate_service_error(lambda: service.start_playback(lesson_id, user))


@router.post("/lessons/{lesson_id}/playback-sessions")
@limiter.limit("30/minute")
def create_playback_session(
    request: Request,
    lesson_id: str,
    user: User = Depends(get_current_user),
    service: LearningService = Depends(get_learning_service),
):
    return _translate_service_error(lambda: service.start_playback(lesson_id, user))


@router.post("/lessons/{lesson_id}/playback-sessions/{playback_session_id}/renew")
@limiter.limit("30/minute")
def renew_playback_session(
    request: Request,
    lesson_id: str,
    playback_session_id: str,
    user: User = Depends(get_current_user),
    service: LearningService = Depends(get_learning_service),
):
    return _translate_service_error(
        lambda: service.renew_playback(lesson_id, user, playback_session_id)
    )


@router.put("/lessons/{lesson_id}/progress")
@limiter.limit("120/minute")
def update_progress(
    request: Request,
    lesson_id: str,
    data: ProgressUpdateIn,
    user: User = Depends(get_current_user),
    service: LearningService = Depends(get_learning_service),
):
    return _translate_service_error(
        lambda: service.update_progress(
            lesson_id,
            user,
            data.playback_session_id,
            data.position_seconds,
            [data.start_seconds, data.end_seconds],
        )
    )


@router.post("/lessons/{lesson_id}/prompts/{prompt_id}/attempts")
@limiter.limit("60/minute")
def attempt_prompt(
    request: Request,
    lesson_id: str,
    prompt_id: str,
    data: PromptAttemptIn,
    user: User = Depends(get_current_user),
    service: LearningService = Depends(get_learning_service),
):
    return _translate_service_error(
        lambda: service.attempt_prompt(
            lesson_id,
            prompt_id,
            user,
            data.playback_session_id,
            data.option_id,
        )
    )
