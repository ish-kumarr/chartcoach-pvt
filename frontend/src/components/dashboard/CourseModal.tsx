"use client";

import { useEffect, useState } from "react";
import { Course, Lesson } from "@/lib/courses";
import Link from "next/link";

type CourseModalProps = {
  course: Course;
  userEmail: string;
  onClose: () => void;
  onLaunchSimulator: (course: Course) => void;
  onProgressChange?: (courseId: string, progress: number) => void;
};

export default function CourseModal({
  course,
  userEmail,
  onClose,
  onLaunchSimulator,
  onProgressChange,
}: CourseModalProps) {
  const [activeTab, setActiveTab] = useState<"curriculum" | "overview" | "notes">("curriculum");
  const [completedLessons, setCompletedLessons] = useState<Record<string, boolean>>({});
  const [selectedLesson, setSelectedLesson] = useState<Lesson>(course.modules[0]?.lessons[0]);
  const [isPlaying, setIsPlaying] = useState(false);

  // Load saved completed lessons from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`chartcoach_completed_${userEmail}_${course.id}`);
      if (saved) {
        setCompletedLessons(JSON.parse(saved));
      } else {
        setCompletedLessons({});
      }
    } catch {
      // Ignore fallback
    }
  }, [userEmail, course.id]);

  function toggleLesson(id: string) {
    const updated = { ...completedLessons, [id]: !completedLessons[id] };
    setCompletedLessons(updated);
    try {
      localStorage.setItem(`chartcoach_completed_${userEmail}_${course.id}`, JSON.stringify(updated));
    } catch {
      // Ignore
    }

    const allLessons = course.modules.flatMap((m) => m.lessons);
    const totalCompleted = allLessons.filter((l) => updated[l.id]).length;
    const progressPercent = Math.round((totalCompleted / Math.max(allLessons.length, 1)) * 100);
    if (onProgressChange) {
      onProgressChange(course.id, progressPercent);
    }
  }

  const allLessons = course.modules.flatMap((m) => m.lessons);
  const totalCompleted = allLessons.filter((l) => completedLessons[l.id]).length;
  const progressPercent = Math.round((totalCompleted / Math.max(allLessons.length, 1)) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-fadeIn overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-spring-pop my-auto">
        {/* Modal Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg border border-blue-200/80">
              {course.category}
            </span>
            <span className="text-xs text-slate-500 font-medium">• {course.level}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onLaunchSimulator(course)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold border border-emerald-200 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
              <span>Practice in Simulator</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body Container */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
          {/* Left: Video Player & Overview (7 cols) */}
          <div className="lg:col-span-7 p-6 space-y-5">
            {/* Simulated High-Definition Video Player */}
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center border border-slate-800 shadow-md group">
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />

              {!isPlaying ? (
                <div className="text-center space-y-3 z-10 p-4">
                  {selectedLesson?.id === "l1" && selectedLesson.type === "video" ? <Link href="/learn/price-action-secrets/1" className="inline-flex rounded-xl bg-blue-600 px-6 py-4 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4">Open lesson</Link> : <button
                    type="button"
                    onClick={() => setIsPlaying(true)}
                    className="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center mx-auto shadow-xl hover:scale-105 transition-all cursor-pointer ring-4 ring-white/10"
                  >
                    <svg className="w-6 h-6 fill-current translate-x-0.5" viewBox="0 0 24 24">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>}
                  <div>
                    <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider block">Now Playing</span>
                    <h4 className="text-sm font-bold text-white max-w-sm mx-auto line-clamp-1">{selectedLesson?.title}</h4>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col justify-between p-4 z-10 text-white">
                  <div className="flex items-center justify-between text-xs">
                    <span className="bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-700 font-mono text-[10px]">
                      1080p HD • 60 FPS
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsPlaying(false)}
                      className="p-1 hover:bg-white/10 rounded-lg"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 w-1/3 rounded-full" />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-300 font-mono">
                      <span>06:42</span>
                      <span>{selectedLesson?.duration}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Course Title & Description */}
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-900 leading-snug">{course.title}</h2>
              <p className="text-xs text-slate-500 leading-relaxed">{course.description}</p>
            </div>

            {/* Instructor Profile Card */}
            <div className="flex items-center gap-3 p-3.5 bg-slate-50 border border-slate-100 rounded-2xl">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${course.instructor.avatarBg} text-white flex items-center justify-center font-bold text-sm shadow-xs`}>
                {course.instructor.name.charAt(0)}
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900">{course.instructor.name}</h4>
                <p className="text-[11px] text-slate-400">{course.instructor.role}</p>
              </div>
            </div>
          </div>

          {/* Right: Interactive Syllabus & Lesson Checklist (5 cols) */}
          <div className="lg:col-span-5 p-6 flex flex-col justify-between bg-slate-50/50">
            <div className="space-y-4">
              {/* Progress Summary */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-800">Your Curriculum Progress</span>
                  <span className="text-blue-600 font-mono">{progressPercent}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 block">
                  {totalCompleted} of {allLessons.length} lessons completed
                </span>
              </div>

              {/* Module List */}
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {course.modules.map((mod, modIdx) => (
                  <div key={mod.id} className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-2xs">
                    <div className="px-4 py-3 bg-slate-100/60 border-b border-slate-100 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">{mod.title}</span>
                      <span className="text-[10px] text-slate-400 font-medium">{mod.lessons.length} Lessons</span>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {mod.lessons.map((lesson) => {
                        const isDone = !!completedLessons[lesson.id];
                        const isCurrent = selectedLesson?.id === lesson.id;

                        return (
                          <div
                            key={lesson.id}
                            className={`p-3 flex items-center justify-between gap-3 transition-colors ${
                              isCurrent ? "bg-blue-50/40" : "hover:bg-slate-50"
                            }`}
                          >
                            <div
                              onClick={() => {
                                setSelectedLesson(lesson);
                                setIsPlaying(false);
                              }}
                              className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                            >
                              <div className="w-5 h-5 rounded-md bg-slate-100 flex items-center justify-center shrink-0 text-slate-500">
                                {lesson.type === "video" && (
                                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                  </svg>
                                )}
                                {lesson.type === "interactive_chart" && (
                                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                                  </svg>
                                )}
                                {lesson.type === "quiz" && (
                                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                  </svg>
                                )}
                              </div>
                              {lesson.id === "l1" && lesson.type === "video" ? <Link href="/learn/price-action-secrets/1" className="text-xs font-bold text-blue-600 rounded focus-visible:outline-2 focus-visible:outline-offset-4">{lesson.title}</Link> : <span className={`text-xs truncate ${isCurrent ? "font-bold text-blue-600" : "text-slate-700"}`}>
                                {lesson.title}
                              </span>}
                            </div>

                            {/* Checkbox button */}
                            {lesson.id === "l1" && lesson.type === "video" ? <span className="text-[10px] text-slate-500">Saved in lesson</span> : <button
                              type="button"
                              onClick={() => toggleLesson(lesson.id)}
                              className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                                isDone
                                  ? "bg-emerald-500 border-emerald-500 text-white"
                                  : "border-slate-300 hover:border-blue-400 bg-white"
                              }`}
                              title={isDone ? "Mark as Incomplete" : "Mark as Completed"}
                            >
                              {isDone && (
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </button>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 mt-4">
              <button
                type="button"
                onClick={() => onLaunchSimulator(course)}
                className="chartcoach-btn-primary !w-full !py-3 text-xs"
              >
                <span>Launch Interactive Practice Sandbox</span>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
