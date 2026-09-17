"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import LessonExperience from "@/components/learning/LessonExperience";
import LessonPreview from "@/components/learning/LessonPreview";
import { lessonPageMode } from "@/lib/lesson-page-mode";

/** Legacy pilot URL retained for existing bookmarks; new links use the slug/module route. */
function LegacyPilotLessonContent() {
  const searchParams = useSearchParams();
  if (
    lessonPageMode({
      isProduction: process.env.NODE_ENV === "production",
      preview: searchParams.get("preview"),
    }) === "preview"
  ) {
    return <LessonPreview />;
  }
  return <LessonExperience lessonId="l1" />;
}

export default function LegacyPilotLessonPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" aria-busy="true" />}>
      <LegacyPilotLessonContent />
    </Suspense>
  );
}
