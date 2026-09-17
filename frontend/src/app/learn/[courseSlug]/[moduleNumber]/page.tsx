"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import LessonExperience from "@/components/learning/LessonExperience";
import LessonPreview from "@/components/learning/LessonPreview";
import { lessonPageMode } from "@/lib/lesson-page-mode";
import { resolveLessonRoute } from "@/lib/lesson-route";

export default function CanonicalLessonPage() {
  const { courseSlug, moduleNumber } = useParams<{
    courseSlug: string;
    moduleNumber: string;
  }>();
  const searchParams = useSearchParams();
  const lessonId = resolveLessonRoute({ courseSlug, moduleNumber });

  if (!lessonId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Lesson unavailable</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">We couldn’t find that module.</h1>
        <Link href="/learn/courses" className="mt-6 inline-flex text-blue-600">Back to courses</Link>
      </main>
    );
  }

  if (lessonPageMode({ isProduction: process.env.NODE_ENV === "production", preview: searchParams.get("preview") }) === "preview") {
    return <LessonPreview />;
  }
  return <LessonExperience key={lessonId} lessonId={lessonId} />;
}
