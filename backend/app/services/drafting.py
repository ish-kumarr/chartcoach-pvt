from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel, Field, model_validator

from app.domain.learning import LessonSegment


class DraftProviderUnavailable(RuntimeError):
    """Raised when no lesson-drafting provider has been configured."""


class LessonDraft(BaseModel):
    duration_seconds: float = Field(gt=0)
    segments: list[LessonSegment]
    published: Literal[False] = False

    @model_validator(mode="after")
    def validate_timeline(self) -> "LessonDraft":
        previous_end = 0.0
        for segment in self.segments:
            if segment.start_seconds < previous_end or segment.end_seconds > self.duration_seconds:
                raise ValueError("draft segments must be ordered and inside lesson duration")
            previous_end = segment.end_seconds
        return self


class LessonDraftProvider(Protocol):
    def draft(self, transcript_text: str, lesson_duration_seconds: float) -> LessonDraft:
        """Return an unpublished lesson outline without persisting it."""


class UnconfiguredDraftProvider:
    def draft(self, transcript_text: str, lesson_duration_seconds: float) -> LessonDraft:
        raise DraftProviderUnavailable("AI lesson drafting is not configured")
