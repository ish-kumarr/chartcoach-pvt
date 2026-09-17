"use client";

import { useMemo, useState } from "react";
import LessonPlayer from "./LessonPlayer";
import { createLocalPlayerAdapter } from "@/lib/local-player-adapter";
import type { LessonApi } from "@/lib/lesson-controller";
import type { LessonMetadata, LessonProgress, PlaybackAuthorization } from "@/lib/learning-api";

const duration = 728.652336;
const initialProgress: LessonProgress = {
  user_id: "local-preview", lesson_id: "local-lecture", playback_session_id: "local",
  resume_position_seconds: 0, watched_intervals: [], watched_seconds: 0, watch_percent: 0,
  passed_prompt_ids: [], pending_prompt_id: null, completed: false, completed_at: null, updated_at: "",
};
const lesson: LessonMetadata = {
  id: "local-lecture", course_id: "local", title: "How to Start Trading in 2026 — Umar Punjabi",
  duration_seconds: duration, captions: { language: "hi", label: "Hindi (auto-generated)", url: "/api/local-lecture/captions.vtt" },
  segments: [{ id: "lecture", title: "Complete beginner’s guide", description: "Full lecture · Chapter and question review pending", start_seconds: 0, end_seconds: duration, thumbnail: { time_seconds: 15, url: "/api/local-lecture/poster.jpg" }, required_prompt: null }],
  progress: initialProgress,
};
const authorization: PlaybackAuthorization = {
  playback_session_id: "local", resume_position_seconds: 0, pending_prompt_id: null, playback_id: "local",
  manifest_url: "/api/local-lecture/video.mp4", widevine_license_url: "", playready_license_url: "", fairplay_license_url: "", fairplay_certificate_url: "", playback_token: "", drm_token: "", expires_at: "2099-01-01T00:00:00Z",
};
const onUnauthorized = () => {};

function createPreviewSession() {
    let progress = { ...initialProgress };
    const api: LessonApi = {
      getLesson: async () => ({ ...lesson, progress }),
      authorizePlayback: async () => ({ ...authorization, resume_position_seconds: progress.resume_position_seconds }),
      saveProgress: async (_id, observation) => {
        // Credit continuous observations only; moving the playhead never grants watch credit.
        const intervals = [...progress.watched_intervals];
        if (observation.end_seconds > observation.start_seconds && observation.end_seconds - observation.start_seconds <= 15) intervals.push([observation.start_seconds, observation.end_seconds]);
        intervals.sort((a, b) => a[0] - b[0]);
        const merged: number[][] = [];
        for (const [start, end] of intervals) {
          const last = merged.at(-1);
          if (last && start <= last[1]) last[1] = Math.max(last[1], end);
          else merged.push([start, end]);
        }
        const watched = merged.reduce((sum, [start, end]) => sum + end - start, 0);
        progress = { ...progress, resume_position_seconds: observation.position_seconds, watched_intervals: merged, watched_seconds: watched, watch_percent: watched / duration * 100, updated_at: new Date().toISOString() };
        return progress;
      },
      submitAttempt: async () => { throw new Error("No reviewed questions for this lecture yet."); },
    };
    return { api };
}

export default function LessonPreview() {
  const [retry, setRetry] = useState(0);
  const state = useMemo(() => createPreviewSession(), []);

  return <main className="min-h-screen bg-[#f8fafc] px-4 py-8 sm:px-8 sm:py-12 text-slate-900">
    <div className="mx-auto max-w-7xl">
      <p className="mb-5 text-sm text-slate-600">Local lecture preview · Hindi auto-generated captions · Progress lasts for this page session · DRM not enabled</p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{lesson.title}</h1>
      <LessonPlayer key={retry} lesson={lesson} authorization={authorization} api={state.api} factory={createLocalPlayerAdapter} onUnauthorized={onUnauthorized} onRetry={() => setRetry((value) => value + 1)} tourStorageKey="chartcoach-lesson-tour-preview" />
    </div>
  </main>;
}
