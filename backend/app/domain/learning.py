from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProgressError(ValueError):
    """A client progress observation violates the lesson contract."""


class PromptOption(BaseModel):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class RequiredPrompt(BaseModel):
    id: str = Field(min_length=1)
    question: str = Field(min_length=1)
    options: list[PromptOption] = Field(min_length=2)
    correct_option_id: str = Field(min_length=1)
    explanation: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_options(self) -> "RequiredPrompt":
        option_ids = [option.id for option in self.options]
        if len(option_ids) != len(set(option_ids)):
            raise ValueError("prompt option ids must be unique")
        if self.correct_option_id not in option_ids:
            raise ValueError("correct option id must belong to the prompt")
        return self

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "question": self.question,
            "options": [option.model_dump() for option in self.options],
        }


class SegmentThumbnail(BaseModel):
    time_seconds: float
    url: str = Field(min_length=1)


class LessonSegment(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str
    start_seconds: float
    end_seconds: float
    thumbnail: SegmentThumbnail
    required_prompt: RequiredPrompt | None = None

    @model_validator(mode="after")
    def validate_own_range(self) -> "LessonSegment":
        values = (self.start_seconds, self.end_seconds, self.thumbnail.time_seconds)
        if not all(math.isfinite(value) for value in values):
            raise ValueError("segment times must be finite")
        if self.start_seconds < 0 or self.start_seconds >= self.end_seconds:
            raise ValueError("segment must start before end")
        if not self.start_seconds <= self.thumbnail.time_seconds < self.end_seconds:
            raise ValueError("thumbnail time must be inside its segment")
        return self

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "start_seconds": self.start_seconds,
            "end_seconds": self.end_seconds,
            "thumbnail": self.thumbnail.model_dump(),
            "required_prompt": self.required_prompt.to_public_dict() if self.required_prompt else None,
        }


class CaptionMetadata(BaseModel):
    language: str = "en"
    label: str = "English"
    url: str = Field(min_length=1)

    @model_validator(mode="after")
    def require_english(self) -> "CaptionMetadata":
        if self.language.lower() != "en":
            raise ValueError("pilot captions must be English")
        return self


class Lesson(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    course_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    duration_seconds: float
    mux_playback_id: str | None = Field(default=None, min_length=1)
    media_asset_id: str | None = Field(default=None, min_length=1)
    captions: CaptionMetadata
    published: bool = False
    segments: list[LessonSegment] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_timeline(self) -> "Lesson":
        if not self.media_asset_id and not self.mux_playback_id:
            raise ValueError("lesson must reference a media asset")
        if not math.isfinite(self.duration_seconds) or self.duration_seconds <= 0:
            raise ValueError("lesson duration must be finite and positive")
        previous_end = 0.0
        segment_ids: set[str] = set()
        prompt_ids: set[str] = set()
        for segment in self.segments:
            if segment.end_seconds > self.duration_seconds:
                raise ValueError("segments must remain inside lesson duration")
            if segment.start_seconds < previous_end:
                raise ValueError("segments must be ordered, non-overlapping ranges")
            if segment.id in segment_ids:
                raise ValueError("segment ids must be unique")
            segment_ids.add(segment.id)
            if segment.required_prompt:
                if segment.required_prompt.id in prompt_ids:
                    raise ValueError("prompt ids must be unique")
                prompt_ids.add(segment.required_prompt.id)
            previous_end = segment.end_seconds
        return self

    @property
    def required_prompts(self) -> list[tuple[float, RequiredPrompt]]:
        return [
            (segment.end_seconds, segment.required_prompt)
            for segment in self.segments
            if segment.required_prompt is not None
        ]

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "course_id": self.course_id,
            "title": self.title,
            "duration_seconds": self.duration_seconds,
            "captions": self.captions.model_dump(),
            "published": self.published,
            "segments": [segment.to_public_dict() for segment in self.segments],
        }

    def to_storage_dict(self) -> dict[str, Any]:
        return self.model_dump()


def merge_intervals(intervals: list[list[float]]) -> list[list[float]]:
    if not intervals:
        return []
    normalized = sorted([[float(start), float(end)] for start, end in intervals], key=lambda item: item[0])
    merged = [normalized[0]]
    for start, end in normalized[1:]:
        previous = merged[-1]
        if start <= previous[1]:
            previous[1] = max(previous[1], end)
        else:
            merged.append([start, end])
    return merged


def normalize_progress(
    *,
    lesson_id: str,
    user_id: str,
    duration_seconds: float,
    watched_intervals: list[list[float]],
    passed_prompt_ids: list[str],
    required_prompt_ids: list[str],
    position_seconds: float,
    playback_session_id: str | None = None,
    pending_prompt_id: str | None = None,
    completed_at: datetime | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    merged = merge_intervals(watched_intervals)
    watched_seconds = min(duration_seconds, sum(end - start for start, end in merged))
    watch_percent = round((watched_seconds / duration_seconds) * 100, 2)
    completed = watch_percent >= 90 and set(required_prompt_ids).issubset(set(passed_prompt_ids))
    timestamp = now or datetime.now(timezone.utc)
    return {
        "user_id": user_id,
        "lesson_id": lesson_id,
        "playback_session_id": playback_session_id,
        "resume_position_seconds": float(position_seconds),
        "watched_intervals": merged,
        "watched_seconds": round(watched_seconds, 3),
        "watch_percent": watch_percent,
        "passed_prompt_ids": list(dict.fromkeys(passed_prompt_ids)),
        "pending_prompt_id": pending_prompt_id,
        "completed": completed,
        "completed_at": completed_at or (timestamp if completed else None),
        "updated_at": timestamp,
    }


def validate_progress_observation(
    duration_seconds: float,
    position_seconds: float,
    interval: list[float],
    next_prompt_boundary: float | None,
) -> None:
    if not math.isfinite(position_seconds) or not 0 <= position_seconds <= duration_seconds:
        raise ProgressError("position_seconds must be finite and inside the lesson")
    if len(interval) != 2:
        raise ProgressError("observed interval must contain a start and end")
    start, end = interval
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start or end > duration_seconds:
        raise ProgressError("observed interval must be finite, ordered, and inside the lesson")
    if end - start > 15:
        raise ProgressError("observed interval cannot be longer than 15 seconds")
    if next_prompt_boundary is not None and (end > next_prompt_boundary or position_seconds > next_prompt_boundary):
        raise ProgressError("progress cannot move beyond the next unanswered required prompt")
