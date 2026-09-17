"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import * as learningApi from "@/lib/learning-api";
import type { LessonMetadata, PlaybackAuthorization } from "@/lib/learning-api";
import type { LessonApi } from "@/lib/lesson-controller";
import type { PlayerAdapterFactory } from "@/lib/player-adapter";
import LessonPlayer from "./LessonPlayer";
type Props = {
  lessonId: string;
  api?: LessonApi;
  factory?: PlayerAdapterFactory;
};
export default function LessonExperience({
  lessonId,
  api = learningApi,
  factory,
}: Props) {
  const { user, isLoading } = useAuth();
  const [result, setResult] = useState<{
    lesson: LessonMetadata;
    authorization: PlaybackAuthorization;
  } | null>(null);
  const [error, setError] = useState<learningApi.LearningApiError | null>(null),
    [retry, setRetry] = useState(0),
    [signedOut, setSignedOut] = useState(false);
  const unauthorized = useCallback(() => setSignedOut(true), []);
  const retryPlayback = useCallback(() => {
    setResult(null);
    setError(null);
    setRetry((n) => n + 1);
  }, []);
  useEffect(() => {
    if (isLoading || !user) return;
    let stale = false;
    async function load() {
      try {
        const lesson = await api.getLesson(lessonId);
        if (stale) return;
        const authorization = await api.authorizePlayback(lessonId);
        if (!stale) setResult({ lesson, authorization });
      } catch (cause) {
        if (stale) return;
        const error =
          cause instanceof learningApi.LearningApiError
            ? cause
            : new learningApi.LearningApiError(503);
        if (error.status === 401) setSignedOut(true);
        else setError(error);
      }
    }
    void load();
    return () => {
      stale = true;
    };
  }, [lessonId, api, user, isLoading, retry]);
  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-8 sm:px-8 sm:py-12 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <Link
          href="/dashboard"
          className="inline-block mb-8 text-sm text-blue-600 rounded focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          ← Back to your learning
        </Link>
        {isLoading ? (
          <p role="status">Checking your session…</p>
        ) : !user || signedOut ? (
          <section>
            <h1 className="text-2xl mb-3">Sign in to your lesson</h1>
            <Link href="/login" className="text-blue-600 underline">
              Sign in
            </Link>
          </section>
        ) : error ? (
          <section role="alert">
            <h1 className="text-2xl mb-3">
              {error.status === 403
                ? "Enrollment required"
                : "Lesson unavailable"}
            </h1>
            <p>{error.message}</p>
            {error.status !== 403 && error.status !== 404 && (
              <button
                className="mt-5 rounded-lg border px-5 py-3"
                onClick={retryPlayback}
              >
                Retry
              </button>
            )}
          </section>
        ) : result ? (
          <>
            <p className="text-xs uppercase tracking-[.18em] text-blue-600 mb-3">
              Learn at your pace
            </p>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
              {result.lesson.title}
            </h1>
            <p className="text-sm text-slate-600 mb-8">
              Watch closely. Explore each chapter. Check your understanding as
              you go.
            </p>
            {result.authorization.drm_readiness?.credentials_status ===
              "pending" && (
              <div
                role="status"
                className="mb-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
              >
                <span className="font-semibold">Development protected playback.</span>{" "}
                Vendor DRM credentials are pending; this local encrypted path
                is enabled for testing.
              </div>
            )}
            <LessonPlayer
              key={`${lessonId}-${retry}`}
              lesson={result.lesson}
              authorization={result.authorization}
              api={api}
              factory={factory}
              onUnauthorized={unauthorized}
              onRetry={retryPlayback}
              tourStorageKey={`chartcoach-lesson-tour-${user.email}`}
            />
          </>
        ) : (
          <p role="status">Opening your lesson…</p>
        )}
      </div>
    </main>
  );
}
