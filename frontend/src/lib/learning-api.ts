import { resolveApiUrl } from "./api";

const API_URL = resolveApiUrl(process.env.NEXT_PUBLIC_API_URL);

export type LessonProgress = {
  user_id: string;
  lesson_id: string;
  playback_session_id: string | null;
  resume_position_seconds: number;
  watched_intervals: number[][];
  watched_seconds: number;
  watch_percent: number;
  passed_prompt_ids: string[];
  pending_prompt_id: string | null;
  completed: boolean;
  completed_at: string | null;
  updated_at: string;
};
export type LessonPrompt = {
  id: string;
  question: string;
  options: { id: string; text: string }[];
};
export type LessonSegment = {
  id: string;
  title: string;
  description: string;
  start_seconds: number;
  end_seconds: number;
  thumbnail: { time_seconds: number; url: string };
  required_prompt: LessonPrompt | null;
};
export type LessonMetadata = {
  id: string;
  course_id: string;
  title: string;
  duration_seconds: number;
  captions: { language: string; label: string; url: string };
  segments: LessonSegment[];
  progress: LessonProgress;
};
export type PlaybackAuthorization = {
  provider?: "mux" | "local";
  media_asset_id?: string;
  drm?: {
    type: "mux" | "development-clear-key";
    license_url?: string;
  };
  drm_readiness?: {
    mode: "development-clear-key" | "mux-managed-drm" | "unavailable";
    credentials_status: "pending" | "configured";
    production_ready: boolean;
  };
  watermark?: {
    mode: "server";
    visible_text: string;
    segment_duration_seconds: 10;
    forensic_algorithm: string;
  };
  drm_policy?: {
    require_hdcp: boolean;
    widevine_video_robustness?: string;
    widevine_audio_robustness?: string;
  };
  playback_session_id: string;
  resume_position_seconds: number;
  pending_prompt_id: string | null;
  playback_id: string;
  manifest_url: string;
  widevine_license_url: string;
  playready_license_url: string;
  fairplay_license_url: string;
  fairplay_certificate_url: string;
  playback_token: string;
  drm_token: string;
  expires_at: string;
};
export type ProgressObservation = {
  playback_session_id: string;
  position_seconds: number;
  start_seconds: number;
  end_seconds: number;
};
export type PromptAttempt = { playback_session_id: string; option_id: string };
export type AttemptResult = {
  is_correct: boolean;
  explanation: string;
  feedback: string;
  retry_allowed: boolean;
  progress: LessonProgress;
};
export class LearningApiError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? "Please sign in to continue."
        : status === 403
          ? "An active enrollment is required for this lesson."
          : status === 404
            ? "This lesson is unavailable."
            : status === 409 || status === 422
              ? "Your lesson progress needs to be refreshed."
              : "Secure playback is temporarily unavailable. Please retry.",
    );
  }
}
async function request<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const response = await fetch(
      `${API_URL}/learning/lessons/${path}`,
      {
        method,
        credentials: "include",
        cache: "no-store",
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      },
    );
    if (process.env.NODE_ENV !== "test") {
      console.info("[ChartCoach API timing]", {
        operation: `${method} /learning/lessons/${path.split("/")[0]}`,
        status: response.status,
        duration_ms: Math.round(performance.now() - startedAt),
        server_timing: response.headers.get("server-timing") ?? undefined,
      });
    }
    if (!response.ok) throw new LearningApiError(response.status);
    return (await response.json()) as T;
  } catch (error) {
    throw error instanceof LearningApiError ? error : new LearningApiError(503);
  }
}
export const getLesson = (id: string) =>
  request<LessonMetadata>(encodeURIComponent(id), "GET");
export const authorizePlayback = (id: string) =>
  request<PlaybackAuthorization>(
    `${encodeURIComponent(id)}/playback-sessions`,
    "POST",
  );
export const renewPlayback = (id: string, playbackSessionId: string) =>
  request<PlaybackAuthorization>(
    `${encodeURIComponent(id)}/playback-sessions/${encodeURIComponent(playbackSessionId)}/renew`,
    "POST",
  );
export const saveProgress = (id: string, body: ProgressObservation) =>
  request<LessonProgress>(`${encodeURIComponent(id)}/progress`, "PUT", body);
export const submitAttempt = (
  id: string,
  prompt: string,
  body: PromptAttempt,
) =>
  request<AttemptResult>(
    `${encodeURIComponent(id)}/prompts/${encodeURIComponent(prompt)}/attempts`,
    "POST",
    body,
  );
