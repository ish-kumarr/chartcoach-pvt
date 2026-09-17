// ChartCoach LMS Phase 1 Data Architecture & Persistence Layer
import curriculumJson from "./curriculum.json";

export type LevelType = "Beginner" | "Intermediate" | "Advanced";

export type ContentBlock =
  | {
      type: "paragraph";
      content: string;
    }
  | {
      type: "heading";
      content: string;
      level?: 2 | 3;
    }
  | {
      type: "callout";
      variant: "info" | "tip" | "warning" | "rule";
      title: string;
      content: string;
    }
  | {
      type: "chart_figure";
      title: string;
      caption: string;
      patternType: "hammer" | "engulfing" | "support_resistance" | "head_shoulders" | "order_block";
    }
  | {
      type: "steps";
      title: string;
      steps: string[];
    };

export type KnowledgeCheckQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type Lesson = {
  id: string;
  courseId: string;
  title: string;
  order: number;
  durationMinutes: number;
  completed: boolean;
  locked: boolean;
  summary: string;
  contentBlocks: ContentBlock[];
  knowledgeCheck?: KnowledgeCheckQuestion;
  keyTakeaways: string[];
};

export type CourseModule = {
  id: string;
  title: string;
  lessons: Lesson[];
};

export type Course = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  level: LevelType;
  levelNumber: 1 | 2 | 3 | 4 | 5;
  levelName: string;
  lessonCount: number;
  durationHours: number;
  durationLabel: string;
  isEnrolled: boolean;
  progressPercent: number;
  instructor: {
    name: string;
    role: string;
  };
  modules: CourseModule[];
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topic: string;
};

export type Quiz = {
  id: string;
  courseId: string;
  title: string;
  description: string;
  questionCount: number;
  completed: boolean;
  bestScore?: number;
  questions: QuizQuestion[];
};

export type LearningActivity = {
  id: string;
  title: string;
  subtitle: string;
  type: "lesson_completed" | "quiz_completed" | "course_started";
  timestamp: number;
  timeAgo: string;
};

export type DashboardData = {
  user: {
    name: string;
    email: string;
  };
  currentLearning: {
    courseId: string;
    courseTitle: string;
    lessonId: string;
    lessonTitle: string;
    lessonNumber: number;
    totalLessons: number;
    progressPercent: number;
  } | null;
  stats: {
    lessonsCompleted: number;
    totalLessons: number;
    coursesCompleted: number;
    learningStreak: number;
    learningTimeMinutes: number;
    practiceScore?: string;
  };
  progress: {
    courseId: string;
    title: string;
    percent: number;
    completedLessons: number;
    totalLessons: number;
  }[];
  recommendedNext: {
    title: string;
    description: string;
    actionLabel: string;
    courseId: string;
    lessonId: string;
  } | null;
  recentActivity: LearningActivity[];
  upNextLessons?: {
    id: string;
    courseId: string;
    title: string;
    order: number;
    durationMinutes: number;
    isAccessible: boolean;
  }[];
  marketTicker?: any[];
  marketOverview?: any;
  hasActiveLearning?: boolean;
};

// ─── INITIAL CURRICULUM DATA ───

export const INITIAL_COURSES: Course[] = (curriculumJson as unknown as Course[]).map((course) => ({
  ...course,
  isEnrolled: false,
  progressPercent: 0,
  modules: course.modules.map((m) => ({
    ...m,
    lessons: m.lessons.map((l) => ({
      ...l,
      completed: false,
      locked: false,
    })),
  })),
}));

export const INITIAL_QUIZZES: Quiz[] = [
  {
    id: "quiz-trading-101",
    courseId: "trading-101",
    title: "Trading 101 Foundations Quiz",
    description: "Validate your grasp of trading basics, order types, bid/ask spread, and asset classes.",
    questionCount: 4,
    completed: true,
    bestScore: 100,
    questions: [
      {
        id: "q1",
        prompt: "What is the primary difference between trading and investing?",
        options: [
          "Trading focuses on profiting from short-to-medium term price movements, while investing focuses on long-term value accumulation",
          "Trading is completely risk-free, while investing is dangerous",
          "Trading only happens on weekends",
          "Investing requires a physical trading floor",
        ],
        correctIndex: 0,
        explanation: "Trading focuses on shorter horizon price fluctuations, while investing focuses on long-term value compounding.",
        topic: "Trading Foundations",
      },
      {
        id: "q2",
        prompt: "What is the 'Spread' in financial markets?",
        options: [
          "The fee paid to your internet provider",
          "The difference between the Bid (highest buy price) and Ask (lowest sell price)",
          "A type of indicator on TradingView",
          "The total volume traded in a day",
        ],
        correctIndex: 1,
        explanation: "The spread is the difference between what buyers are willing to pay (Bid) and what sellers ask for (Ask).",
        topic: "Market Mechanics",
      },
      {
        id: "q3",
        prompt: "Which order type executes immediately at the currently best available market price?",
        options: ["Limit Order", "Stop Loss Order", "Market Order", "Good-Till-Cancelled Order"],
        correctIndex: 2,
        explanation: "A Market Order guarantees immediate execution by filling against available limit orders.",
        topic: "Order Types",
      },
      {
        id: "q4",
        prompt: "Why do financial exchanges and regulated brokers exist?",
        options: [
          "To ensure every retail trader makes profits",
          "To provide organized, transparent execution, matching, and clearing between buyers and sellers",
          "To hide price data from ordinary people",
          "To manually fix stock prices at the end of the day",
        ],
        correctIndex: 1,
        explanation: "Exchanges centralize market access and ensure standardized, reliable transaction clearing.",
        topic: "Market Structure",
      },
    ],
  },
  {
    id: "quiz-chart-reading-101",
    courseId: "chart-reading-101",
    title: "Chart Reading 101 Quiz",
    description: "Test your recognition of candlesticks, wicks, timeframes, and chart navigation.",
    questionCount: 3,
    completed: false,
    questions: [
      {
        id: "q-cr-1",
        prompt: "A candlestick's real body represents which data?",
        options: [
          "The volume of shares traded",
          "The price difference between the Open and Close of that time period",
          "The high and low price reached during the entire week",
          "The broker commission rate",
        ],
        correctIndex: 1,
        explanation: "The real body is the rectangular area between the Open and Close prices.",
        topic: "Candlestick Anatomy",
      },
      {
        id: "q-cr-2",
        prompt: "A long upper shadow (wick) on a candle indicates:",
        options: [
          "Buyers pushed price higher, but aggressive sellers rejected those high prices before the close",
          "Buyers were in complete command until the bell",
          "The stock was halted by regulators",
          "A guaranteed continuation to new highs",
        ],
        correctIndex: 0,
        explanation: "Long upper wicks prove that price reached high levels but encountered overwhelming selling resistance.",
        topic: "Wick Analysis",
      },
      {
        id: "q-cr-3",
        prompt: "Before trading an intraday setup on a 5-minute chart, what should you inspect?",
        options: [
          "A 1-minute chart",
          "Higher timeframes (Daily or 1-Hour) to establish the overarching market trend",
          "Social media rumors",
          "Random oscillator crosses",
        ],
        correctIndex: 1,
        explanation: "Higher timeframes govern market trend and provide context for lower timeframe execution.",
        topic: "Timeframes",
      },
    ],
  },
  {
    id: "quiz-reading-the-market",
    courseId: "reading-the-market",
    title: "Reading the Market Quiz",
    description: "Assess your ability to read uptrends, downtrends, sideways markets, and key decision zones.",
    questionCount: 3,
    completed: false,
    questions: [
      {
        id: "q-rtm-1",
        prompt: "An established Uptrend is structurally defined by which sequence?",
        options: [
          "Higher Highs accompanied by Higher Lows",
          "Lower Highs accompanied by Lower Lows",
          "Erratic horizontal price bars",
          "Alternating red and green candles with no direction",
        ],
        correctIndex: 0,
        explanation: "Uptrends continuously form Higher Highs and Higher Lows as buyers remain in control.",
        topic: "Trend Mechanics",
      },
      {
        id: "q-rtm-2",
        prompt: "What is happening during a Sideways / Consolidation market?",
        options: [
          "Buyers and sellers are in temporary balance, storing energy for the next directional break",
          "The market will never move again",
          "Only high-frequency bots are allowed to trade",
          "Price moves in random circles",
        ],
        correctIndex: 0,
        explanation: "Consolidation represents a state of equilibrium between buying and selling forces.",
        topic: "Consolidation",
      },
      {
        id: "q-rtm-3",
        prompt: "When a confirmed Resistance level is broken with conviction, what does it often become upon a retest?",
        options: [
          "Instant sell signal",
          "New Support floor",
          "An invalid zone",
          "A guaranteed stop-out",
        ],
        correctIndex: 1,
        explanation: "The principle of polarity / role reversal states that broken resistance tends to become new support.",
        topic: "Support & Resistance",
      },
    ],
  },
  {
    id: "quiz-language-of-price",
    courseId: "language-of-price",
    title: "The Language of Price Quiz",
    description: "Evaluate your understanding of impulse vs correction, breakouts, pullbacks, and momentum.",
    questionCount: 3,
    completed: false,
    questions: [
      {
        id: "q-lop-1",
        prompt: "What visually distinguishes an Impulsive move from a Corrective move?",
        options: [
          "Impulsive moves feature large, clean candles with momentum; corrective moves are overlapping, slow, and choppy",
          "Impulsive moves only happen on Mondays",
          "Corrective moves have giant single-direction candles",
          "There is no visual difference",
        ],
        correctIndex: 0,
        explanation: "Impulses show strong institutional intent with consecutive full bodies; corrections are sluggish pauses.",
        topic: "Impulse & Correction",
      },
      {
        id: "q-lop-2",
        prompt: "What is a 'Failed Breakout' (Trap)?",
        options: [
          "When price briefly breaks a key level, traps early breakout traders, and violently reverses back inside the range",
          "When your broker rejects an order",
          "When a market closes for lunch",
          "When a trend continues without pausing",
        ],
        correctIndex: 0,
        explanation: "Failed breakouts trap eager breakout participants before smart money moves price the opposite way.",
        topic: "Breakouts & Traps",
      },
      {
        id: "q-lop-3",
        prompt: "Why is Market Context more critical than pattern memorization?",
        options: [
          "Because the same pin bar at major trend support has vastly higher probability than one inside a choppy middle range",
          "Because candle patterns have no meaning at all",
          "Because indicators are 100% accurate",
          "Because brokers change candle patterns randomly",
        ],
        correctIndex: 0,
        explanation: "Context (where the pattern occurs in relation to trend and key levels) dictates probability.",
        topic: "Market Context",
      },
    ],
  },
  {
    id: "quiz-building-trading-strategy",
    courseId: "building-trading-strategy",
    title: "Building a Trading Strategy Quiz",
    description: "Test your knowledge of rules, 1% risk management, entry/exit criteria, and trade journaling.",
    questionCount: 3,
    completed: false,
    questions: [
      {
        id: "q-bts-1",
        prompt: "Under the professional 1% risk rule, how is position size determined?",
        options: [
          "Always buy a fixed 100 shares regardless of risk distance",
          "Position Size = (Account Capital × 1%) ÷ (Entry Price - Stop Loss Price)",
          "Invest 100% of your account on high conviction ideas",
          "Let your broker decide",
        ],
        correctIndex: 1,
        explanation: "Position size is mathematically sized so that hitting your stop loss results in losing no more than 1% of total capital.",
        topic: "Position Sizing",
      },
      {
        id: "q-bts-2",
        prompt: "When should your Stop Loss and Exit Target be defined?",
        options: [
          "Before you execute the entry order, based on structural chart invalidation",
          "After you enter and see how the market reacts",
          "Only when you get a margin alert",
          "At the end of the month",
        ],
        correctIndex: 0,
        explanation: "A disciplined trader plans the exit and protection parameters before committing any capital.",
        topic: "Trade Architecture",
      },
      {
        id: "q-bts-3",
        prompt: "What is the primary purpose of maintaining a consistent Trading Journal?",
        options: [
          "To show off profits to other traders",
          "To objectively track rule compliance, review setup statistics, and eliminate recurring behavioral mistakes",
          "To fulfill broker regulatory mandates",
          "To calculate tax rates",
        ],
        correctIndex: 1,
        explanation: "The trading journal is your personalized feedback mechanism that reveals performance and psychological leaks.",
        topic: "Trading Journal",
      },
    ],
  },
];

// ─── LOCAL STORAGE & DATA LAYER FUNCTIONS ───

function getStorageKey(email: string, key: string): string {
  const safeEmail = email || "guest";
  return `chartcoach_phase1_${key}_${safeEmail}`;
}

export function getCourses(userEmail: string = "trader@chartcoach.com"): Course[] {
  if (typeof window === "undefined") return INITIAL_COURSES;
  try {
    const raw = localStorage.getItem(getStorageKey(userEmail, "courses"));
    if (raw) {
      const parsed: Course[] = JSON.parse(raw);
      // Merge with INITIAL_COURSES so any newly added lessons/content are never lost
      return INITIAL_COURSES.map((initCourse) => {
        const saved = parsed.find((p) => p.id === initCourse.id);
        if (!saved) return initCourse;

        // Merge module & lesson states
        const mergedModules = initCourse.modules.map((m) => {
          const savedModule = saved.modules?.find((sm) => sm.id === m.id);
          if (!savedModule) return m;

          const mergedLessons = m.lessons.map((l) => {
            const savedLesson = savedModule.lessons?.find((sl) => sl.id === l.id);
            if (!savedLesson) return l;
            return {
              ...l,
              completed: savedLesson.completed ?? l.completed,
              locked: savedLesson.locked ?? l.locked,
            };
          });

          return { ...m, lessons: mergedLessons };
        });

        const totalLessons = mergedModules.reduce((acc, m) => acc + m.lessons.length, 0);
        const completedLessons = mergedModules.reduce(
          (acc, m) => acc + m.lessons.filter((l) => l.completed).length,
          0
        );
        const progressPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

        return {
          ...initCourse,
          isEnrolled: saved.isEnrolled ?? initCourse.isEnrolled,
          progressPercent,
          modules: mergedModules,
        };
      });
    }
  } catch {
    // Fallback to initial
  }
  return INITIAL_COURSES;
}

export function saveCourses(userEmail: string, courses: Course[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(userEmail, "courses"), JSON.stringify(courses));
  } catch {
    // Ignore error
  }
}

export function getCourse(courseId: string, userEmail: string = "trader@chartcoach.com"): Course | null {
  const allCourses = getCourses(userEmail);
  return allCourses.find((c) => c.id === courseId) || null;
}

export function getLesson(
  courseId: string,
  lessonId: string,
  userEmail: string = "trader@chartcoach.com"
): { course: Course; lesson: Lesson; module: CourseModule; nextLesson: Lesson | null; prevLesson: Lesson | null } | null {
  const course = getCourse(courseId, userEmail);
  if (!course) return null;

  const allLessons: Lesson[] = [];
  course.modules.forEach((m) => {
    m.lessons.forEach((l) => allLessons.push(l));
  });

  const lessonIndex = allLessons.findIndex((l) => l.id === lessonId);
  if (lessonIndex === -1) return null;

  const lesson = allLessons[lessonIndex];
  const prevLesson = lessonIndex > 0 ? allLessons[lessonIndex - 1] : null;
  const nextLesson = lessonIndex < allLessons.length - 1 ? allLessons[lessonIndex + 1] : null;

  const parentModule = course.modules.find((m) => m.lessons.some((l) => l.id === lessonId))!;

  return {
    course,
    lesson,
    module: parentModule,
    nextLesson,
    prevLesson,
  };
}

export function markLessonComplete(
  courseId: string,
  lessonId: string,
  userEmail: string = "trader@chartcoach.com"
): { updatedCourse: Course; nextLessonId: string | null } {
  const courses = getCourses(userEmail);

  let nextLessonToUnlock: string | null = null;

  const updatedCourses = courses.map((course) => {
    if (course.id !== courseId) return course;

    const allLessons: Lesson[] = [];
    course.modules.forEach((m) => m.lessons.forEach((l) => allLessons.push(l)));

    const currentIdx = allLessons.findIndex((l) => l.id === lessonId);
    if (currentIdx !== -1 && currentIdx < allLessons.length - 1) {
      nextLessonToUnlock = allLessons[currentIdx + 1].id;
    }

    const updatedModules = course.modules.map((m) => {
      const updatedLessons = m.lessons.map((l) => {
        if (l.id === lessonId) {
          return { ...l, completed: true };
        }
        if (nextLessonToUnlock && l.id === nextLessonToUnlock) {
          return { ...l, locked: false };
        }
        return l;
      });
      return { ...m, lessons: updatedLessons };
    });

    const totalLessons = updatedModules.reduce((acc, m) => acc + m.lessons.length, 0);
    const completedLessons = updatedModules.reduce(
      (acc, m) => acc + m.lessons.filter((l) => l.completed).length,
      0
    );
    const progressPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    return {
      ...course,
      isEnrolled: true,
      progressPercent,
      modules: updatedModules,
    };
  });

  saveCourses(userEmail, updatedCourses);

  // Record recent activity
  recordActivity(
    userEmail,
    "Lesson Completed",
    `Finished lesson in ${courses.find((c) => c.id === courseId)?.title || "Course"}`,
    "lesson_completed"
  );

  const updatedTargetCourse = updatedCourses.find((c) => c.id === courseId)!;
  return { updatedCourse: updatedTargetCourse, nextLessonId: nextLessonToUnlock };
}

export function getQuizzes(userEmail: string = "trader@chartcoach.com"): Quiz[] {
  if (typeof window === "undefined") return INITIAL_QUIZZES;
  try {
    const raw = localStorage.getItem(getStorageKey(userEmail, "quizzes"));
    if (raw) {
      const parsed: Quiz[] = JSON.parse(raw);
      return INITIAL_QUIZZES.map((initQuiz) => {
        const saved = parsed.find((p) => p.id === initQuiz.id);
        if (!saved) return initQuiz;
        return {
          ...initQuiz,
          completed: saved.completed ?? initQuiz.completed,
          bestScore: saved.bestScore ?? initQuiz.bestScore,
        };
      });
    }
  } catch {
    // Fallback
  }
  return INITIAL_QUIZZES;
}

export function getQuiz(quizId: string, userEmail: string = "trader@chartcoach.com"): Quiz | null {
  const quizzes = getQuizzes(userEmail);
  return quizzes.find((q) => q.id === quizId) || null;
}

export function saveQuizResult(
  quizId: string,
  scorePercent: number,
  userEmail: string = "trader@chartcoach.com"
): void {
  const quizzes = getQuizzes(userEmail);
  const updated = quizzes.map((q) => {
    if (q.id === quizId) {
      return {
        ...q,
        completed: true,
        bestScore: Math.max(q.bestScore || 0, scorePercent),
      };
    }
    return q;
  });

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(getStorageKey(userEmail, "quizzes"), JSON.stringify(updated));
    } catch {
      // Ignore
    }
  }

  recordActivity(
    userEmail,
    "Quiz Completed",
    `Scored ${scorePercent}% on ${quizzes.find((q) => q.id === quizId)?.title || "Quiz"}`,
    "quiz_completed"
  );
}

function recordActivity(
  userEmail: string,
  title: string,
  subtitle: string,
  type: LearningActivity["type"]
): void {
  if (typeof window === "undefined") return;
  try {
    const key = getStorageKey(userEmail, "activities");
    const raw = localStorage.getItem(key);
    const list: LearningActivity[] = raw ? JSON.parse(raw) : [];

    const newAct: LearningActivity = {
      id: `${Date.now()}`,
      title,
      subtitle,
      type,
      timestamp: Date.now(),
      timeAgo: "Just now",
    };

    const updated = [newAct, ...list].slice(0, 10);
    localStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // Ignore
  }
}

export function getRecentActivities(userEmail: string = "trader@chartcoach.com"): LearningActivity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getStorageKey(userEmail, "activities"));
    if (raw) {
      const list: LearningActivity[] = JSON.parse(raw);
      return list.map((item) => {
        const mins = Math.round((Date.now() - item.timestamp) / (1000 * 60));
        let timeAgo = "Just now";
        if (mins >= 60 * 24) timeAgo = `${Math.floor(mins / (60 * 24))}d ago`;
        else if (mins >= 60) timeAgo = `${Math.floor(mins / 60)}h ago`;
        else if (mins > 0) timeAgo = `${mins}m ago`;
        return { ...item, timeAgo };
      });
    }
  } catch {
    // Ignore
  }
  // If no activities recorded yet for brand new user, return empty list
  return [];
}

export function enrollCourse(
  courseId: string,
  userEmail: string = "trader@chartcoach.com"
): Course {
  const courses = getCourses(userEmail);
  const updatedCourses = courses.map((course) => {
    if (course.id !== courseId) return course;
    return {
      ...course,
      isEnrolled: true,
      progressPercent: course.progressPercent || 0,
    };
  });
  saveCourses(userEmail, updatedCourses);

  recordActivity(
    userEmail,
    "Enrolled in Course",
    `Started ${courses.find((c) => c.id === courseId)?.title || "Course"}`,
    "lesson_completed"
  );

  return updatedCourses.find((c) => c.id === courseId)!;
}

export function getDashboardData(
  userName: string = "Trader",
  userEmail: string = "trader@chartcoach.com"
): DashboardData {
  const courses = getCourses(userEmail);
  const activities = getRecentActivities(userEmail);

  // Compute stats
  let totalLessonsInCurriculum = 0;
  let totalCompletedLessons = 0;
  let completedCoursesCount = 0;

  courses.forEach((c) => {
    c.modules.forEach((m) => {
      totalLessonsInCurriculum += m.lessons.length;
      totalCompletedLessons += m.lessons.filter((l) => l.completed).length;
    });
    if (c.progressPercent === 100) {
      completedCoursesCount++;
    }
  });

  // Find currently active course and next incomplete lesson
  // Never default to courses[0] if user is not enrolled!
  let activeCourse = courses.find((c) => c.isEnrolled && c.progressPercent < 100) || null;
  let activeLesson: Lesson | null = null;
  let activeLessonNumber = 1;

  if (activeCourse) {
    const flatLessons: Lesson[] = [];
    activeCourse.modules.forEach((m) => flatLessons.push(...m.lessons));
    const firstIncomplete = flatLessons.find((l) => !l.completed);
    activeLesson = firstIncomplete || flatLessons[0] || null;
    activeLessonNumber = flatLessons.findIndex((l) => l.id === activeLesson?.id) + 1;
    if (activeLessonNumber === 0) activeLessonNumber = 1;
  }

  const currentLearning = activeCourse && activeLesson
    ? {
        courseId: activeCourse.id,
        courseTitle: activeCourse.title,
        lessonId: activeLesson.id,
        lessonTitle: activeLesson.title,
        lessonNumber: activeLessonNumber,
        totalLessons: activeCourse.lessonCount,
        progressPercent: activeCourse.progressPercent,
      }
    : null;

  // Recommended next step
  let recommendedNext = null;
  if (activeCourse && activeLesson) {
    recommendedNext = {
      title: `Continue with ${activeLesson.title}`,
      description: `You're currently in ${activeCourse.title}. Complete this lesson to maintain your learning streak.`,
      actionLabel: "Continue Lesson",
      courseId: activeCourse.id,
      lessonId: activeLesson.id,
    };
  } else {
    recommendedNext = {
      title: "Start with Trading 101",
      description: "Begin your trading journey with market foundations and core principles.",
      actionLabel: "Start Course",
      courseId: "trading-101",
      lessonId: "t101-l1",
    };
  }

  // Progress bars per topic
  const progressList = courses.map((c) => {
    const courseLessons = c.modules.reduce((acc, m) => acc + m.lessons.length, 0);
    const completed = c.modules.reduce((acc, m) => acc + m.lessons.filter((l) => l.completed).length, 0);
    return {
      courseId: c.id,
      title: c.title,
      percent: c.progressPercent,
      completedLessons: completed,
      totalLessons: courseLessons,
    };
  });

  return {
    user: {
      name: userName,
      email: userEmail,
    },
    currentLearning,
    stats: {
      lessonsCompleted: totalCompletedLessons,
      totalLessons: totalLessonsInCurriculum,
      coursesCompleted: completedCoursesCount,
      learningStreak: totalCompletedLessons > 0 ? 1 : 0,
      learningTimeMinutes: totalCompletedLessons * 22,
    },
    progress: progressList,
    recommendedNext,
    recentActivity: activities,
  };
}

// ─── BACKEND API INTEGRATION ───

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchCoursesFromApi(userEmail: string = "trader@chartcoach.com"): Promise<Course[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/courses`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const localCourses = getCourses(userEmail);
        return data.map((remoteCourse: any) => {
          const localMatch = localCourses.find((c) => c.id === remoteCourse.id);
          if (!localMatch) return remoteCourse as Course;
          return {
            ...remoteCourse,
            isEnrolled: localMatch.isEnrolled || remoteCourse.isEnrolled,
            progressPercent: Math.max(localMatch.progressPercent || 0, remoteCourse.progressPercent || 0),
            modules: (remoteCourse.modules || []).map((rm: any) => {
              const lm = localMatch.modules?.find((m) => m.id === rm.id);
              if (!lm) return rm;
              return {
                ...rm,
                lessons: (rm.lessons || []).map((rl: any) => {
                  const ll = lm.lessons?.find((l) => l.id === rl.id);
                  if (!ll) return rl;
                  return {
                    ...rl,
                    completed: ll.completed || rl.completed,
                    locked: ll.locked !== undefined ? ll.locked : rl.locked,
                  };
                }),
              };
            }),
          } as Course;
        });
      }
    }
  } catch (err) {
    console.warn("Backend API not reachable, using local curriculum:", err);
  }
  return getCourses(userEmail);
}

export async function fetchCourseFromApi(
  courseId: string,
  userEmail: string = "trader@chartcoach.com"
): Promise<Course | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/courses/${courseId}`, { cache: "no-store" });
    if (res.ok) {
      const remoteCourse = await res.json();
      const localCourse = getCourse(courseId, userEmail);
      if (!localCourse) return remoteCourse as Course;
      return {
        ...remoteCourse,
        isEnrolled: localCourse.isEnrolled || remoteCourse.isEnrolled,
        progressPercent: Math.max(localCourse.progressPercent || 0, remoteCourse.progressPercent || 0),
        modules: (remoteCourse.modules || []).map((rm: any) => {
          const lm = localCourse.modules?.find((m) => m.id === rm.id);
          if (!lm) return rm;
          return {
            ...rm,
            lessons: (rm.lessons || []).map((rl: any) => {
              const ll = lm.lessons?.find((l) => l.id === rl.id);
              if (!ll) return rl;
              return {
                ...rl,
                completed: ll.completed || rl.completed,
                locked: ll.locked !== undefined ? ll.locked : rl.locked,
              };
            }),
          };
        }),
      } as Course;
    }
  } catch (err) {
    console.warn("Backend API error for course:", err);
  }
  return getCourse(courseId, userEmail);
}

export async function fetchLessonFromApi(
  courseId: string,
  lessonId: string,
  userEmail: string = "trader@chartcoach.com"
): Promise<{ course: Course; lesson: Lesson; module: CourseModule; nextLesson: Lesson | null; prevLesson: Lesson | null } | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/courses/${courseId}/lessons/${lessonId}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const localData = getLesson(courseId, lessonId, userEmail);
      const isCompleted = localData?.lesson?.completed ?? data.lesson?.completed ?? false;
      return {
        course: (localData?.course || data.course) as Course,
        lesson: { ...data.lesson, completed: isCompleted },
        module: data.module,
        nextLesson: data.nextLesson,
        prevLesson: data.prevLesson,
      };
    }
  } catch (err) {
    console.warn("Backend API error for lesson:", err);
  }
  return getLesson(courseId, lessonId, userEmail);
}

export async function markLessonCompleteApi(
  courseId: string,
  lessonId: string,
  userEmail: string = "trader@chartcoach.com"
): Promise<{ updatedCourse: Course; nextLessonId: string | null }> {
  const localResult = markLessonComplete(courseId, lessonId, userEmail);
  try {
    fetch(`${BACKEND_URL}/api/courses/${courseId}/lessons/${lessonId}/complete?user_email=${encodeURIComponent(userEmail)}`, {
      method: "POST",
    }).catch(() => {});
  } catch {
    // Ignore network error
  }
  return localResult;
}

