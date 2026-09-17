import math

import pytest
from pydantic import ValidationError

from app.domain.learning import (
    Lesson,
    ProgressError,
    merge_intervals,
    normalize_progress,
    validate_progress_observation,
)


def lesson_payload() -> dict:
    return {
        "id": "l1",
        "course_id": "price-action-secrets",
        "title": "Reading market structure",
        "duration_seconds": 100.0,
        "mux_playback_id": "signed-playback-id",
        "captions": {
            "language": "en",
            "label": "English",
            "url": "https://captions.example.test/l1.vtt",
        },
        "published": True,
        "segments": [
            {
                "id": "intro",
                "title": "Structure",
                "description": "Find swing structure.",
                "start_seconds": 0,
                "end_seconds": 40,
                "thumbnail": {"time_seconds": 10, "url": "https://images.example.test/intro.jpg"},
                "required_prompt": {
                    "id": "p1",
                    "question": "Which observation confirms an upswing?",
                    "options": [
                        {"id": "a", "text": "Higher high and higher low"},
                        {"id": "b", "text": "Lower high and lower low"},
                    ],
                    "correct_option_id": "a",
                    "explanation": "Higher highs and lows define an upswing.",
                },
            },
            {
                "id": "finish",
                "title": "Review",
                "description": "Review the chart.",
                "start_seconds": 40,
                "end_seconds": 100,
                "thumbnail": {"time_seconds": 50, "url": "https://images.example.test/review.jpg"},
                "required_prompt": None,
            },
        ],
    }


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda data: data["segments"][1].update(start_seconds=39), "ordered, non-overlapping"),
        (lambda data: data["segments"][0].update(end_seconds=101), "inside lesson duration"),
        (lambda data: data["segments"][0].update(start_seconds=40, end_seconds=40), "start before end"),
        (lambda data: data["segments"][0]["thumbnail"].update(time_seconds=41), "thumbnail time"),
    ],
)
def test_lesson_rejects_invalid_segment_ranges(mutate, message):
    data = lesson_payload()
    mutate(data)

    with pytest.raises(ValidationError, match=message):
        Lesson.model_validate(data)


def test_public_lesson_hides_answers_and_pre_attempt_explanations():
    lesson = Lesson.model_validate(lesson_payload())

    public = lesson.to_public_dict()

    prompt = public["segments"][0]["required_prompt"]
    assert prompt == {
        "id": "p1",
        "question": "Which observation confirms an upswing?",
        "options": [
            {"id": "a", "text": "Higher high and higher low"},
            {"id": "b", "text": "Lower high and lower low"},
        ],
    }


def test_merge_intervals_counts_unique_seconds_for_overlaps_and_adjacency():
    merged = merge_intervals([[0, 5], [4, 8], [8, 10], [20, 25]])

    assert merged == [[0.0, 10.0], [20.0, 25.0]]


def test_completion_requires_ninety_percent_unique_coverage_and_all_prompts():
    incomplete = normalize_progress(
        lesson_id="l1",
        user_id="user-1",
        duration_seconds=100,
        watched_intervals=[[0, 95]],
        passed_prompt_ids=[],
        required_prompt_ids=["p1"],
        position_seconds=95,
    )
    complete = normalize_progress(
        lesson_id="l1",
        user_id="user-1",
        duration_seconds=100,
        watched_intervals=[[0, 90]],
        passed_prompt_ids=["p1"],
        required_prompt_ids=["p1"],
        position_seconds=90,
    )

    assert incomplete["completed"] is False
    assert incomplete["watched_seconds"] == 95.0
    assert complete["completed"] is True
    assert complete["watch_percent"] == 90.0


@pytest.mark.parametrize("value", [-1, 101, math.inf, math.nan])
def test_progress_rejects_invalid_position(value):
    with pytest.raises(ProgressError, match="position_seconds"):
        validate_progress_observation(
            duration_seconds=100,
            position_seconds=value,
            interval=[0, 1],
            next_prompt_boundary=None,
        )


def test_progress_rejects_long_or_gate_crossing_observations_and_forward_position():
    with pytest.raises(ProgressError, match="15 seconds"):
        validate_progress_observation(100, 16, [0, 16], None)
    with pytest.raises(ProgressError, match="required prompt"):
        validate_progress_observation(100, 41, [39, 41], 40)
    with pytest.raises(ProgressError, match="required prompt"):
        validate_progress_observation(100, 41, [39, 40], 40)
