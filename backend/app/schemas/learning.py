from pydantic import BaseModel, Field


class ProgressUpdateIn(BaseModel):
    playback_session_id: str = Field(min_length=1)
    position_seconds: float
    start_seconds: float
    end_seconds: float


class PromptAttemptIn(BaseModel):
    playback_session_id: str = Field(min_length=1)
    option_id: str = Field(min_length=1)
