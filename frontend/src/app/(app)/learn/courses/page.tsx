"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Search,
  BookOpen,
  Clock,
  ArrowRight,
  Play,
  CheckCircle2,
  Lock,
  Sparkles,
  RotateCcw,
  Zap,
  Target,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import UpgradeModal from "@/components/billing/UpgradeModal";
import { RazorpayCheckoutModal } from "@/components/billing/RazorpayCheckoutModal";
import { createCourseCheckout, verifyCoursePayment } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const COURSE_PRICES: Record<string, number> = {
  "trading-101": 1,
  "course-1": 1,
  "chart-reading-101": 2,
  "course-2": 2,
  "reading-the-market": 3,
  "course-3": 3,
  "language-of-price": 4,
  "course-4": 4,
  "building-trading-strategy": 5,
  "course-5": 5,
};

const STAGES = [
  { step: "01", name: "FOUNDATION", title: "Trading 101" },
  { step: "02", name: "OBSERVATION", title: "Chart Reading 101" },
  { step: "03", name: "INTERPRETATION", title: "Reading the Market" },
  { step: "04", name: "PRICE BEHAVIOUR", title: "The Language of Price" },
  { step: "05", name: "EXECUTION FRAMEWORK", title: "Building a Trading Strategy" },
];

export type CourseItem = {
  id: string;
  title: string;
  tagline?: string;
  description?: string;
  level: string;
  levelNumber: number;
  levelName: string;
  lessonCount: number;
  durationHours: number;
  durationLabel: string;
  modules?: any[];
  userState?: {
    enrolled: boolean;
    progressPercentage: number;
    status: string;
    completedLessons: number;
    totalLessons: number;
    isLocked: boolean;
    requiredPlan: string;
    requiredPlanName: string;
    state: "not_started" | "in_progress" | "completed" | "locked";
  };
};

function CoursesContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & level filter
  const initialSearch = searchParams.get("search") || "";
  const initialLevel = searchParams.get("level") || "All";
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [selectedLevel, setSelectedLevel] = useState<string>(initialLevel);

  // Contextual upgrade modal state
  const [upgradeModalState, setUpgradeModalState] = useState<{
    isOpen: boolean;
    courseTitle: string;
    requiredPlan: string;
    requiredPlanName: string;
  }>({
    isOpen: false,
    courseTitle: "",
    requiredPlan: "pro",
    requiredPlanName: "Pro",
  });

  // Standalone course purchase modal state
  const [courseCheckout, setCourseCheckout] = useState<{
    isOpen: boolean;
    sessionData: any;
    courseId: string;
    courseTitle: string;
  } | null>(null);
  const [purchaseSuccessMessage, setPurchaseSuccessMessage] = useState<string | null>(null);

  async function handleBuyCourseStandalone(courseId: string, courseTitle: string) {
    try {
      const data = await createCourseCheckout(courseId);

      // Launch official Razorpay popup modal directly on this page
      if (typeof window !== "undefined" && (window as any).Razorpay && data.orderId) {
        const razorpayKey = data.keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "rzp_test_TbsCmYg0P5vtka";
        const options: any = {
          key: razorpayKey,
          amount: data.amount || (data.price * 100),
          currency: "INR",
          name: "ChartCoach",
          description: `${courseTitle} — Lifetime Access`,
          order_id: data.orderId,
          prefill: {
            ...(user?.full_name ? { name: user.full_name } : {}),
            ...(user?.email ? { email: user.email } : {}),
          },
          theme: {
            color: "#2563eb",
            backdrop_color: "rgba(15, 23, 42, 0.65)",
          },
          modal: {
            confirm_close: true,
          },
          handler: async (response: any) => {
            try {
              await verifyCoursePayment(courseId, response.razorpay_payment_id);
              setPurchaseSuccessMessage(
                `Success! You now have permanent lifetime access to "${courseTitle}".`
              );
              await loadCourses();
              setTimeout(() => setPurchaseSuccessMessage(null), 8000);
            } catch (err: any) {
              alert(err.message || "Payment verification failed.");
            }
          },
        };

        const rzp = new (window as any).Razorpay(options);
        rzp.on("payment.failed", (failRes: any) => {
          alert(failRes?.error?.description || "Payment failed at gateway.");
        });
        rzp.open();
        return;
      }

      setCourseCheckout({
        isOpen: true,
        courseId,
        courseTitle,
        sessionData: {
          sessionId: data.courseId,
          orderId: data.orderId,
          finalPrice: data.price,
          amount: data.amount,
          keyId: data.keyId,
          planName: `${courseTitle} — Lifetime Access`,
          planSlug: courseId,
          isMock: data.isMock,
        },
      });
    } catch (err: any) {
      console.error("Course checkout error:", err);
      alert(err.message || "Could not initiate course purchase.");
    }
  }

  async function handleCoursePaymentSuccess(paymentData: {
    paymentId: string;
    subscriptionId: string;
    signature: string;
  }) {
    if (!courseCheckout) return;
    try {
      await verifyCoursePayment(courseCheckout.courseId, paymentData.paymentId);
      setPurchaseSuccessMessage(
        `Success! You now have permanent lifetime access to "${courseCheckout.courseTitle}".`
      );
      setCourseCheckout(null);
      await loadCourses();
      setTimeout(() => setPurchaseSuccessMessage(null), 8000);
    } catch (err: any) {
      alert(err.message || "Payment verification failed.");
    }
  }

  async function loadCourses() {
    try {
      const res = await fetch(`${API_URL}/api/v1/courses`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setCourses(data);
        }
      }
    } catch (err) {
      console.warn("Failed to load courses from API:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCourses();
  }, [user]);

  function handleLevelChange(level: string) {
    setSelectedLevel(level);
    const params = new URLSearchParams(searchParams.toString());
    if (level === "All") params.delete("level");
    else params.set("level", level.toLowerCase());
    router.replace(`/learn/courses?${params.toString()}`);
  }

  function handleSearchChange(q: string) {
    setSearchQuery(q);
    const params = new URLSearchParams(searchParams.toString());
    if (!q.trim()) params.delete("search");
    else params.set("search", q.trim());
    router.replace(`/learn/courses?${params.toString()}`);
  }

  // Filtered courses
  const filteredCourses = useMemo(() => {
    return courses.filter((course) => {
      if (selectedLevel !== "All" && course.level.toLowerCase() !== selectedLevel.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = course.title.toLowerCase().includes(q);
        const matchTag = (course.tagline || "").toLowerCase().includes(q);
        const matchDesc = (course.description || "").toLowerCase().includes(q);
        if (!matchTitle && !matchTag && !matchDesc) return false;
      }
      return true;
    });
  }, [courses, selectedLevel, searchQuery]);

  // Recommendation Engine (Section 9)
  const recommendation = useMemo(() => {
    if (!courses || courses.length === 0) return null;

    const c1 = courses.find((c) => c.levelNumber === 1);
    const c2 = courses.find((c) => c.levelNumber === 2);
    const c3 = courses.find((c) => c.levelNumber === 3);
    const c4 = courses.find((c) => c.levelNumber === 4);
    const c5 = courses.find((c) => c.levelNumber === 5);

    const isC1Done = (c1?.userState?.progressPercentage || 0) >= 100;
    const isC2Done = (c2?.userState?.progressPercentage || 0) >= 100;
    const isC3Done = (c3?.userState?.progressPercentage || 0) >= 100;
    const isC4Done = (c4?.userState?.progressPercentage || 0) >= 100;
    const isC5Done = (c5?.userState?.progressPercentage || 0) >= 100;

    if (isC5Done) {
      return {
        allCompleted: true,
        title: "Curriculum Completed!",
        description: "You've completed the ChartCoach learning path.",
        actionText: "Practice in Simulator",
        actionHref: "/simulator",
      };
    }

    if (!isC1Done) return { course: c1, levelNumber: 1, actionText: "Start Foundation" };
    if (!isC2Done) return { course: c2, levelNumber: 2, actionText: "Continue to Level 2" };
    if (!isC3Done) return { course: c3, levelNumber: 3, actionText: "Advance to Level 3" };
    if (!isC4Done) return { course: c4, levelNumber: 4, actionText: "Study Level 4" };
    return { course: c5, levelNumber: 5, actionText: "Complete Capstone Strategy" };
  }, [courses]);

  // Overall journey metrics
  const activeCourse = recommendation?.course || courses[0];
  const activeLevelNumber = activeCourse?.levelNumber || 1;
  const activeCompletedLessons = activeCourse?.userState?.completedLessons || 0;
  const activeTotalLessons = activeCourse?.lessonCount || 14;
  const activeProgressPct = activeCourse?.userState?.progressPercentage || 0;

  const levelTabs = ["All", "Beginner", "Intermediate", "Advanced"];

  return (
    <div className="space-y-8 animate-fade-up">
      {purchaseSuccessMessage && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{purchaseSuccessMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setPurchaseSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Section 7 Hero */}
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200/60 text-blue-600 text-[11px] font-bold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Curriculum Roadmap</span>
        </div>
        <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-slate-900">
          Master the Market, One Skill at a Time
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium max-w-2xl leading-relaxed">
          Follow a structured path from trading fundamentals to building your own rule-based trading approach.
        </p>
      </header>

      {/* Section 6 & 7: Learning Journey 5-Stage Progression Flow */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-7 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
              The 5-Stage Methodology
            </span>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              Learn → Understand → Analyze → Practice → Build
            </h3>
          </div>
          <span className="text-xs font-semibold text-slate-400">
            Stage {activeLevelNumber} of 5 Active
          </span>
        </div>

        {/* Progression Chain */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {STAGES.map((st, i) => {
            const stepNum = i + 1;
            const isCurrent = activeLevelNumber === stepNum;
            const isPassed = activeLevelNumber > stepNum;

            return (
              <div
                key={st.step}
                className={`relative p-3.5 rounded-2xl border transition-all ${
                  isCurrent
                    ? "bg-blue-50/80 border-blue-300 ring-2 ring-blue-500/20 shadow-xs"
                    : isPassed
                    ? "bg-emerald-50/50 border-emerald-200 text-slate-700"
                    : "bg-slate-50 border-slate-200/70 text-slate-400"
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono font-bold">
                  <span className={isCurrent ? "text-blue-600" : isPassed ? "text-emerald-600" : "text-slate-400"}>
                    {st.step} {st.name}
                  </span>
                  {isPassed && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                </div>
                <p className="mt-1 text-xs font-bold text-slate-900 leading-snug line-clamp-1">
                  {st.title}
                </p>
              </div>
            );
          })}
        </div>

        {/* Summary Card (Section 7) */}
        {activeCourse && (
          <div className="mt-4 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-blue-400 font-bold">
                YOUR LEARNING JOURNEY • Level {activeLevelNumber} of 5
              </span>
              <h4 className="text-base sm:text-lg font-black">{activeCourse.title}</h4>
              <p className="text-xs text-slate-300">
                {activeCompletedLessons} / {activeTotalLessons} lessons complete ({activeProgressPct}%)
              </p>

              {/* Progress track */}
              <div className="w-full sm:max-w-md h-2 bg-slate-800 rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${activeProgressPct}%` }}
                />
              </div>
            </div>

            <div className="shrink-0">
              {activeCourse.userState?.isLocked ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setUpgradeModalState({
                        isOpen: true,
                        courseTitle: activeCourse.title,
                        requiredPlan: activeCourse.userState?.requiredPlan || "pro",
                        requiredPlanName: activeCourse.userState?.requiredPlanName || "Pro",
                      })
                    }
                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Unlock with {activeCourse.userState?.requiredPlanName || "Pro"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBuyCourseStandalone(activeCourse.id, activeCourse.title)}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
                  >
                    <span>or Buy (₹{COURSE_PRICES[activeCourse.id] ?? 1} Lifetime)</span>
                  </button>
                </div>
              ) : (
                <Link
                  href={`/learn/courses/${activeCourse.id}`}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Continue Learning</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Search & Level Filters */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 custom-scrollbar">
          {levelTabs.map((level) => {
            const isSelected = selectedLevel.toLowerCase() === level.toLowerCase();
            return (
              <button
                key={level}
                type="button"
                onClick={() => handleLevelChange(level)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap border ${
                  isSelected
                    ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {level}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search courses..."
            className="w-full pl-9 pr-3 py-2 bg-white text-xs text-slate-800 placeholder-slate-400 rounded-xl border border-slate-200/90 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all shadow-xs"
          />
        </div>
      </section>

      {/* Courses Grid with 4 Primary States (Section 8) */}
      <section>
        {filteredCourses.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-500 space-y-3">
            <BookOpen className="w-10 h-10 mx-auto text-slate-300" />
            <h3 className="text-base font-bold text-slate-800">No courses found.</h3>
            <p className="text-xs text-slate-400">Try adjusting your keyword search or selected level filter.</p>
            <button
              type="button"
              onClick={() => {
                handleLevelChange("All");
                handleSearchChange("");
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredCourses.map((course) => {
              const uState = course.userState;
              const isLocked = uState?.isLocked ?? false;
              const progressPct = uState?.progressPercentage ?? 0;
              const isCompleted = progressPct >= 100;
              const isStarted = progressPct > 0 && !isCompleted;
              const reqPlanName = uState?.requiredPlanName || "Pro";

              return (
                <div
                  key={course.id}
                  className={`bg-white border rounded-2xl p-5 sm:p-6 shadow-xs hover:shadow-sm transition-all duration-200 flex flex-col justify-between group ${
                    isLocked ? "border-slate-200/80 opacity-95 bg-slate-50/40" : "border-slate-200/90 hover:border-slate-300"
                  }`}
                >
                  <div className="space-y-3">
                    {/* Top: Badges & Level */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200/70">
                          {course.level}
                        </span>
                        {isLocked && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                            <Lock className="w-3 h-3" />
                            <span>{reqPlanName}</span>
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-semibold text-slate-400">
                        Level {course.levelNumber}
                      </span>
                    </div>

                    {/* Title & Tagline */}
                    <div>
                      {isLocked ? (
                        <button
                          type="button"
                          onClick={() =>
                            setUpgradeModalState({
                              isOpen: true,
                              courseTitle: course.title,
                              requiredPlan: uState?.requiredPlan || "pro",
                              requiredPlanName: reqPlanName,
                            })
                          }
                          className="text-left w-full"
                        >
                          <h3 className="text-base font-bold text-slate-900 hover:text-blue-600 transition-colors leading-snug">
                            {course.title}
                          </h3>
                        </button>
                      ) : (
                        <Link href={`/learn/courses/${course.id}`}>
                          <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">
                            {course.title}
                          </h3>
                        </Link>
                      )}
                      <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">
                        {course.tagline || course.description}
                      </p>
                    </div>

                    {/* Meta details */}
                    <div className="flex items-center gap-3 text-xs text-slate-400 pt-1 font-mono">
                      <span className="flex items-center gap-1 text-slate-500">
                        <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                        <span>{course.lessonCount} Lessons</span>
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1 text-slate-500">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{course.durationLabel}</span>
                      </span>
                    </div>

                    {/* Progress Bar (if in progress or completed) */}
                    {isStarted && (
                      <div className="pt-2 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-medium">In Progress</span>
                          <span className="font-bold text-blue-600">{progressPct}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-600 transition-all duration-500"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card Bottom CTA Supporting 4 Primary States */}
                  <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">
                      {isLocked
                        ? `Available with ${reqPlanName}`
                        : isCompleted
                        ? "Completed"
                        : isStarted
                        ? `${uState?.completedLessons || 0}/${course.lessonCount} lessons`
                        : "Not started"}
                    </span>

                    {isLocked ? (
                      /* State 4 — Locked */
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setUpgradeModalState({
                              isOpen: true,
                              courseTitle: course.title,
                              requiredPlan: uState?.requiredPlan || "pro",
                              requiredPlanName: reqPlanName,
                            })
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all bg-amber-500 hover:bg-amber-600 text-white shadow-xs cursor-pointer"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>Unlock with {reqPlanName}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBuyCourseStandalone(course.id, course.title)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all border border-slate-200 hover:bg-slate-50 text-slate-700 cursor-pointer"
                        >
                          <span>or Buy (₹{COURSE_PRICES[course.id] ?? 1} Lifetime)</span>
                        </button>
                      </div>
                    ) : isCompleted ? (
                      /* State 3 — Completed */
                      <Link
                        href={`/learn/courses/${course.id}`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-slate-700 shadow-xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Review Course</span>
                      </Link>
                    ) : isStarted ? (
                      /* State 2 — In Progress */
                      <Link
                        href={`/learn/courses/${course.id}`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20 shadow-xs"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Continue</span>
                      </Link>
                    ) : (
                      /* State 1 — Not Started */
                      <Link
                        href={`/learn/courses/${course.id}`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-slate-900 hover:bg-slate-800 text-white shadow-xs"
                      >
                        <span>Start Course</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Contextual Upgrade Modal */}
      <UpgradeModal
        isOpen={upgradeModalState.isOpen}
        onClose={() => setUpgradeModalState({ ...upgradeModalState, isOpen: false })}
        title={upgradeModalState.courseTitle}
        description={`This course is part of the ChartCoach structured path and is included with ${upgradeModalState.requiredPlanName}.`}
        requiredPlan={upgradeModalState.requiredPlan}
        requiredPlanName={upgradeModalState.requiredPlanName}
        onSuccess={() => {
          loadCourses();
        }}
      />

      {/* Standalone Course Razorpay Checkout Modal */}
      {courseCheckout && (
        <RazorpayCheckoutModal
          isOpen={courseCheckout.isOpen}
          onClose={() => setCourseCheckout(null)}
          sessionData={courseCheckout.sessionData}
          onPaymentSuccess={handleCoursePaymentSuccess}
        />
      )}
    </div>
  );
}

export default function CoursesPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6 animate-pulse">
          <div className="h-8 w-64 bg-slate-200 rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="h-56 bg-slate-100 rounded-2xl" />
            <div className="h-56 bg-slate-100 rounded-2xl" />
            <div className="h-56 bg-slate-100 rounded-2xl" />
          </div>
        </div>
      }
    >
      <CoursesContent />
    </Suspense>
  );
}
