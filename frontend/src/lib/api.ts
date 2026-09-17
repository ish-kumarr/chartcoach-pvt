// This file talks to the FastAPI backend.
// Every other part of the frontend should call these functions
// instead of calling fetch() directly, so the API logic lives in one place.
//
// Login state lives in an httpOnly cookie the backend sets — never in
// localStorage or JS-readable state. That means:
// - Every request below passes credentials: "include" so the browser
//   attaches (and, on login, stores) that cookie.
// - There is no token to pass around here; the browser handles it.

type BrowserLocation = Pick<Location, "protocol" | "hostname">;

export function resolveApiUrl(configured: string | undefined, location?: BrowserLocation): string {
  if (configured?.trim()) return configured.trim().replace(/\/$/, "");
  const browser = location ?? (typeof window === "undefined" ? undefined : window.location);
  if (browser) return `${browser.protocol}//${browser.hostname}:8000`;
  return "http://localhost:8000";
}

const API_URL = resolveApiUrl(process.env.NEXT_PUBLIC_API_URL);

export type User = {
  id: number | string;
  email: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
  has_face_enrolled: boolean;
  avatar_url?: string;
  subscription_plan?: string;
  subscription_status?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let isRedirectingToLogin = false;

// When login cannot be verified or session expires on a protected endpoint,
// automatically clear local user state and redirect to the sign-in page.
export function handleUnauthorizedSession(message?: string) {
  if (typeof window === "undefined") return;

  // Never redirect if already on login or register page
  if (window.location.pathname.startsWith("/login") || window.location.pathname.startsWith("/register")) {
    return;
  }

  if (isRedirectingToLogin) return;
  isRedirectingToLogin = true;

  try {
    // Notify AuthContext and other components to immediately wipe user state
    window.dispatchEvent(
      new CustomEvent("chartcoach:unauthorized", {
        detail: { message: message || "Could not verify your login. Please log in again." },
      })
    );

    // Wipe cookie in the background
    fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  } finally {
    const encodedNotice = encodeURIComponent("session_expired");
    window.location.href = `/login?notice=${encodedNotice}`;
  }
}

// Reads the error message FastAPI sends back, or falls back to a generic one
async function readErrorMessage(
  response: Response,
  isAuthAttempt = false,
  silent = false
): Promise<string> {
  let message = "Something went wrong. Please try again.";

  try {
    const data = await response.json();

    if (data?.error?.message && typeof data.error.message === "string") {
      message = data.error.message;
    } else if (typeof data.detail === "string") {
      message = data.detail;
    } else if (Array.isArray(data.detail) && data.detail.length > 0) {
      const first = data.detail[0];
      if (typeof first?.msg === "string") message = first.msg;
    }
  } catch {
    // fallback default
  }

  // Check if this response indicates unverified or expired login credentials
  const isAuthFailure =
    response.status === 401 ||
    message.toLowerCase().includes("could not verify your login") ||
    message.toLowerCase().includes("please log in again");

  if (isAuthFailure && !isAuthAttempt && !silent) {
    handleUnauthorizedSession(message);
  }

  return message;
}

export async function registerUser(email: string, fullName: string, password: string): Promise<User> {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, full_name: fullName, password }),
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, true), response.status);
  }

  return response.json();
}

export async function loginUser(email: string, password: string): Promise<void> {
  // The backend expects form data here (OAuth2 standard), not JSON
  const body = new URLSearchParams();
  body.set("username", email);
  body.set("password", password);

  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, true), response.status);
  }
  // The login cookie is now set by the browser — nothing else to do here.
}

export async function faceLogin(email: string, images: string[]): Promise<void> {
  // The email turns this into a 1:1 face check against just that one
  // account, instead of a slower, less accurate search across everyone.
  // images is a burst of frames spanning one blink, verified server-side.
  const response = await fetch(`${API_URL}/auth/face-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, images_base64: images }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, true), response.status);
  }
}

export async function logoutUser(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
}

export async function fetchCurrentUser(silent = false): Promise<User> {
  const response = await fetch(`${API_URL}/users/me`, { credentials: "include" });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, false, silent), response.status);
  }

  return response.json();
}

export async function enrollFace(imagesBase64: string[]): Promise<void> {
  // One photo per sample — no blink needed, since this only runs inside an
  // already-logged-in session (see the note on FaceCapture for why).
  const response = await fetch(`${API_URL}/face/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images_base64: imagesBase64 }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
}

export async function removeFace(): Promise<void> {
  const response = await fetch(`${API_URL}/face/enroll`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
}

export function getMonitorSocketUrl(): string {
  // The login cookie rides along automatically on this connection too,
  // since it is same-site with the backend.
  const wsUrl = API_URL.replace(/^http/, "ws");
  return `${wsUrl}/ws/monitor`;
}

// ─── API V1 TYPED DTOs & SERVICES ───

export type ContinueLearningDTO = {
  status?: "ready" | "empty" | "completed" | string;
  hasActiveLearning: boolean;
  course?: {
    id: string;
    title: string;
    slug: string;
    levelName: string;
    levelNumber: number;
    totalLessons?: number;
  } | null;
  lesson?: {
    id: string;
    courseId: string;
    title: string;
    lessonNumber: number;
    durationMinutes: number;
    durationSeconds: number;
    progressPercentage: number;
    lastPositionSeconds?: number;
    summary: string;
    videoUrl?: string;
    thumbnailUrl?: string;
  } | null;
  instructor?: {
    name: string;
    role: string;
    avatarUrl?: string | null;
  } | null;
  upNext: Array<{
    id: string;
    courseId: string;
    title: string;
    order: number;
    durationMinutes: number;
    isAccessible: boolean;
  }>;
  progress?: Record<string, unknown> | null;
  recommendedCourse?: {
    id: string;
    title: string;
    slug?: string;
    levelName?: string;
    lessonCount?: number;
    durationLabel?: string;
    description?: string;
  } | null;
};

export type CourseUserStateDTO = {
  enrolled: boolean;
  progressPercentage: number;
  status: "not_enrolled" | "in_progress" | "completed" | string;
  completedLessons: number;
  totalLessons: number;
  lastAccessedLessonId?: string | null;
};

export type CourseCatalogItemDTO = {
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
  instructor?: Record<string, unknown> | null;
  modules?: Array<{
    id: string;
    title: string;
    description?: string;
    lessons: Array<{
      id: string;
      title: string;
      order?: number;
      durationMinutes?: number;
      completed?: boolean;
    }>;
  }>;
  userState: CourseUserStateDTO;
};

export type EnrollmentDTO = {
  id: string;
  courseId: string;
  status: string;
  progressPercentage: number;
  enrolledAt: string;
};

export type LearningSummaryDTO = {
  lessonsCompleted: number;
  totalLessons: number;
  coursesCompleted: number;
  totalCourses: number;
  completionPercentage: number;
  learningStreak: number;
  learningTimeMinutes: number;
  activeStage: string;
  progressScore: string;
};

export type CourseProgressDTO = {
  courseId: string;
  title: string;
  completedLessons: number;
  totalLessons: number;
  percent: number;
  isEnrolled: boolean;
  levelNumber: number;
};

export type LearningActivityDTO = {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  timeAgo: string;
  timestamp: number;
};

export type MarketQuoteDTO = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  isPositive: boolean;
};

export type MarketOverviewDTO = {
  marketStatus: "OPEN" | "CLOSED" | "PRE_OPEN";
  marketBreadth: { advances: number; declines: number; unchanged: number };
  vix: number;
  topGainer: MarketQuoteDTO | null;
  topLoser: MarketQuoteDTO | null;
  timestamp: string;
};

export type AnnouncementDTO = {
  id: string;
  title: string;
  body: string;
  type: "info" | "warning" | "success" | "feature";
  createdAt: string;
  isDismissible: boolean;
};

export type DashboardDTO = {
  user: {
    id: string;
    publicUserId: string;
    fullName: string;
    email: string;
    role: string;
    hasFaceEnrolled: boolean;
  };
  continueLearning: ContinueLearningDTO;
  learningSummary: LearningSummaryDTO;
  curriculumProgress: CourseProgressDTO[];
  recentActivities: LearningActivityDTO[];
  marketTicker: MarketQuoteDTO[];
  marketOverview: MarketOverviewDTO;
  announcements: AnnouncementDTO[];
  entitlements: {
    canAccessLiveStream: boolean;
    canAccessSim: boolean;
    tier: string;
  };
};

export type LessonDetailDTO = {
  course: Record<string, unknown>;
  module?: Record<string, unknown> | null;
  lesson: Record<string, unknown>;
  prevLesson?: Record<string, unknown> | null;
  nextLesson?: Record<string, unknown> | null;
  userProgress?: {
    lesson_id: string;
    course_id: string;
    duration_seconds: number;
    last_position_seconds: number;
    watched_seconds: number;
    progress_percentage: number;
    completed: boolean;
  } | null;
};

export type LessonProgressOut = {
  status: string;
  courseId: string;
  lessonId: string;
  progressPercentage: number;
  completed: boolean;
  totalCompletedLessons: number;
};

export async function fetchDashboard(): Promise<DashboardDTO> {
  const response = await fetch(`${API_URL}/api/v1/dashboard`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export type ChartPointDTO = {
  time: string;
  value: number;
};

export type LiveMarketOverviewDTO = {
  primarySymbol: string;
  primaryName: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  chartPoints: ChartPointDTO[];
};

export async function fetchMarketTicker(): Promise<MarketQuoteDTO[]> {
  const response = await fetch(`${API_URL}/api/v1/market/ticker`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export async function fetchLiveMarketOverview(symbol: string = "NIFTY 50"): Promise<LiveMarketOverviewDTO> {
  const response = await fetch(`${API_URL}/api/v1/market/overview?symbol=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export async function fetchContinueLearning(): Promise<ContinueLearningDTO> {
  const response = await fetch(`${API_URL}/api/v1/learning/continue`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export async function fetchLearningSummary(): Promise<LearningSummaryDTO> {
  const response = await fetch(`${API_URL}/api/v1/learning/summary`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export async function fetchCurriculumProgress(): Promise<CourseProgressDTO[]> {
  const response = await fetch(`${API_URL}/api/v1/learning/progress`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export async function fetchLessonDetail(courseId: string, lessonId: string): Promise<LessonDetailDTO> {
  const response = await fetch(`${API_URL}/api/v1/learning/courses/${courseId}/lessons/${lessonId}`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export async function syncLessonProgress(
  courseId: string,
  lessonId: string,
  data: {
    currentPositionSeconds?: number;
    lastPositionSeconds?: number;
    watchedSeconds?: number;
    durationSeconds?: number;
    completed?: boolean;
  }
): Promise<LessonProgressOut> {
  const response = await fetch(`${API_URL}/api/v1/learning/courses/${courseId}/lessons/${lessonId}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export async function markLessonCompleteV1(
  courseId: string,
  lessonId: string
): Promise<LessonProgressOut> {
  const response = await fetch(`${API_URL}/api/v1/learning/courses/${courseId}/lessons/${lessonId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export async function enrollInCourse(courseId: string): Promise<EnrollmentDTO> {
  const response = await fetch(`${API_URL}/api/v1/courses/${courseId}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

export async function fetchCourseCatalog(): Promise<CourseCatalogItemDTO[]> {
  const response = await fetch(`${API_URL}/api/v1/courses`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json();
}

// ─── Polygon.io & TradingView Lightweight Charts API ─────────────────────────

export type TradingViewBar = {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  value: number;
};

export type PolygonQuote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  is_positive: boolean;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  volume: number;
  updated_at: number;
};

export type PolygonHistory = {
  symbol: string;
  name: string;
  timeframe: string;
  bars: TradingViewBar[];
  current_price: number;
  change: number;
  change_percent: number;
  is_positive: boolean;
  high_period: number;
  low_period: number;
  source: string;
};

export async function fetchPolygonHistory(
  symbol: string,
  timeframe: string = "1D",
  signal?: AbortSignal
): Promise<PolygonHistory> {
  const clean = encodeURIComponent(symbol.trim().replace(" ", "").toUpperCase());
  const tf = encodeURIComponent(timeframe.trim().toUpperCase());
  const response = await fetch(
    `${API_URL}/api/v1/market/polygon/history?symbol=${clean}&timeframe=${tf}`,
    { credentials: "include", cache: "no-store", signal }
  );

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function fetchPolygonQuote(
  symbol: string,
  signal?: AbortSignal
): Promise<PolygonQuote> {
  const clean = encodeURIComponent(symbol.trim().replace(" ", "").toUpperCase());
  const response = await fetch(
    `${API_URL}/api/v1/market/polygon/quote?symbol=${clean}`,
    { credentials: "include", cache: "no-store", signal }
  );

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function fetchPolygonWatchlist(
  signal?: AbortSignal
): Promise<PolygonQuote[]> {
  const response = await fetch(`${API_URL}/api/v1/market/polygon/watchlist`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function fetchPolygonTicker(
  signal?: AbortSignal
): Promise<PolygonQuote[]> {
  const response = await fetch(`${API_URL}/api/v1/market/polygon/ticker`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export type LiveTick = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  is_positive: boolean;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  volume: number;
  tick_direction: "up" | "down" | "flat";
  timestamp: number;
};

export async function fetchPolygonTick(
  symbol: string,
  signal?: AbortSignal
): Promise<LiveTick> {
  const clean = encodeURIComponent(symbol.trim().replace(" ", "").toUpperCase());
  const response = await fetch(`${API_URL}/api/v1/market/polygon/tick?symbol=${clean}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export function getPolygonStreamUrl(symbols: string[] = ["NVDA", "AAPL", "TSLA", "SPY", "MSFT", "AMZN", "INFY", "XAUUSD"]): string {
  return `${API_URL}/api/v1/market/polygon/stream?symbols=${encodeURIComponent(symbols.join(","))}`;
}

// ─── PHASE 1: BILLING, GEMS & SUBSCRIPTION TYPES & CLIENT ───

export type SubscriptionPlan = {
  id: string;
  slug: string;
  name: string;
  positioning: string;
  description: string;
  price: number;
  price_yearly?: number;
  yearly_discount_percent?: number;
  currency: string;
  billing_interval: string;
  included_courses: string[];
  included_tools: string[];
  simulator_access: string;
  community_tier: string;
  ai_coach_access: boolean;
  monthly_gems: number;
  is_popular?: boolean;
};

export type MembershipDetails = {
  plan: string;
  planName: string;
  status: string;
  billingInterval?: string;
  renewalDate: string | null;
  autoRenew: boolean;
  gems: {
    balance: number;
    monthlyAllocation: number;
  };
  unlockedCourses: {
    unlocked: number;
    total: number;
    courses: string[];
  };
  unlockedTools: {
    unlocked: number;
    total: number;
    tools: string[];
  };
  simulatorAccess: boolean;
  communityAccess: string;
  paymentHistory: {
    id: string;
    paymentId: string;
    amount: number;
    currency: string;
    status: string;
    date: string;
  }[];
};

export type GemTransaction = {
  id: string;
  type: string;
  amount: number;
  source: string;
  description: string;
  balanceAfter: number;
  createdAt: string;
};

export type GemWalletData = {
  balance: number;
  lifetimeCredited: number;
  lifetimeDebited: number;
  currentPeriodAllocated: number;
  history: GemTransaction[];
};

export type CheckoutSessionResponse = {
  sessionId: string;
  subscriptionId: string;
  keyId: string;
  amount: number;
  originalAmount: number;
  discountAmount: number;
  finalPrice: number;
  currency: string;
  planName: string;
  planSlug: string;
  interval: string;
  couponCode?: string | null;
  isUpgrade?: boolean;
  isDowngrade?: boolean;
  isMock: boolean;
};

export type CouponValidationResponse = {
  valid: boolean;
  code?: string;
  discountType?: string;
  discountValue?: number;
  discountAmount?: number;
  basePrice?: number;
  finalPrice?: number;
  message: string;
};

export type GemPackage = {
  package_id: string;
  name: string;
  gems: number;
  price: number;
  currency: string;
  is_popular?: boolean;
};

export async function fetchPlans(): Promise<SubscriptionPlan[]> {
  const response = await fetch(`${API_URL}/api/v1/billing/plans`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function fetchMembership(): Promise<MembershipDetails> {
  const response = await fetch(`${API_URL}/api/v1/billing/membership`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function createSubscriptionCheckout(
  plan: string,
  interval: string = "monthly",
  couponCode?: string
): Promise<CheckoutSessionResponse> {
  const response = await fetch(`${API_URL}/api/v1/billing/checkout/subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      plan,
      interval,
      coupon_code: couponCode || null,
    }),
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function verifySubscriptionPayment(data: {
  plan: string;
  interval?: string;
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
  coupon_code?: string;
  session_id?: string;
}): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/billing/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function cancelSubscription(): Promise<{
  success: boolean;
  message: string;
  currentPeriodEnd?: string;
  autoRenew: boolean;
}> {
  const response = await fetch(`${API_URL}/api/v1/billing/subscription/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function resumeSubscription(): Promise<{
  success: boolean;
  message: string;
  autoRenew: boolean;
  status: string;
}> {
  const response = await fetch(`${API_URL}/api/v1/billing/subscription/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function validateCoupon(
  code: string,
  plan: string,
  interval: string = "monthly"
): Promise<CouponValidationResponse> {
  const response = await fetch(`${API_URL}/api/v1/billing/coupons/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code, plan, interval }),
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function fetchGemPackages(): Promise<GemPackage[]> {
  const response = await fetch(`${API_URL}/api/v1/gems/packages`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function createGemCheckout(packageId: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/gems/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ package_id: packageId }),
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function verifyGemPayment(packageId: string, paymentId: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/gems/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ package_id: packageId, payment_id: paymentId }),
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function createCourseCheckout(courseId: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/billing/courses/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ course_id: courseId }),
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function verifyCoursePayment(courseId: string, paymentId?: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/billing/courses/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ course_id: courseId, payment_id: paymentId }),
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function fetchAdminAnalytics(): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/billing/admin/analytics`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function fetchGemWallet(): Promise<GemWalletData> {
  const response = await fetch(`${API_URL}/api/v1/gems/wallet`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

export async function askAiCoach(
  question: string,
  context?: string
): Promise<{ answer: string; gemsConsumed: number; remainingGems: number }> {
  const response = await fetch(`${API_URL}/api/v1/coach/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ question, context }),
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}


// ─── MARKETS PAGE TYPES & CLIENT ─────────────────────────────────────────────

export type MarketTickerItem = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  isPositive: boolean;
};

export type HeatmapTile = {
  symbol: string;
  name: string;
  changePercent: number;
  isPositive: boolean;
  sector: string;
  marketCap: string;
  size: number;
  price?: number;
};

export type AIInsight = {
  symbol: string;
  tag: string;
  tagColor: string;
  description: string;
  iconColor: string;
};

export type TopMover = {
  symbol: string;
  name: string;
  changePercent: number;
  isPositive: boolean;
  sparkline: number[];
};

export type SectorPerf = {
  sector: string;
  icon: string;
  changePercent: number;
  isPositive: boolean;
  barPercent: number;
};

export type MarketNewsItem = {
  id: string;
  headline: string;
  summary: string;
  source: string;
  timeAgo: string;
  category: string;
  thumbnailUrl?: string;
};

export type EconomicEvent = {
  id: string;
  day: number;
  month: string;
  title: string;
  time: string;
  location: string;
  importance: string;
  category: string;
  icon: string;
};

export type MarketsPageData = {
  indexTicker: MarketTickerItem[];
  heatmap: HeatmapTile[];
  aiInsights: AIInsight[];
  topGainers: TopMover[];
  topLosers: TopMover[];
  mostActive: TopMover[];
  sectorPerformance: SectorPerf[];
  news: MarketNewsItem[];
  calendar: EconomicEvent[];
  marketStatus: string;
  marketStatusTime: string;
};

export async function fetchMarketsPage(signal?: AbortSignal): Promise<MarketsPageData> {
  const response = await fetch(`${API_URL}/api/v1/market/page`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.json();
}

