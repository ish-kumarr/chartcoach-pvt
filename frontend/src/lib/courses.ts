export type Lesson = {
  id: string;
  title: string;
  duration: string;
  type: "video" | "interactive_chart" | "quiz";
  completed?: boolean;
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
  category: "Price Action" | "Smart Money (SMC)" | "Options & Derivatives" | "Quantitative" | "Risk Management";
  level: "Beginner" | "Intermediate" | "Advanced" | "All Levels";
  /** Compatibility fields used by the dashboard learning-path view. */
  levelNumber: 1 | 2 | 3 | 4 | 5;
  levelName: string;
  rating: number;
  reviewsCount: number;
  studentsCount: number;
  totalModules: number;
  totalLessons: number;
  duration: string;
  progress?: number;
  isEnrolled?: boolean;
  featured?: boolean;
  instructor: {
    name: string;
    role: string;
    avatarBg: string;
  };
  description: string;
  learnings: string[];
  modules: CourseModule[];
};

const RAW_COURSES: Omit<Course, "levelNumber" | "levelName">[] = [
  {
    id: "price-action-secrets",
    title: "Mastering Candlestick Psychology & Price Action Dynamics",
    tagline: "Decode high-probability market setups purely using price behavior and market structure.",
    category: "Price Action",
    level: "All Levels",
    rating: 4.9,
    reviewsCount: 2420,
    studentsCount: 14850,
    totalModules: 4,
    totalLessons: 12,
    duration: "14.5 Hours",
    progress: 0,
    isEnrolled: false,
    featured: true,
    instructor: {
      name: "Rajesh Varma",
      role: "Ex-Prop Desk Head & CMT",
      avatarBg: "from-blue-600 to-indigo-600",
    },
    description:
      "Stop trading lagging indicators. This institutional-grade masterclass teaches you how market makers and proprietary trading desks read price delivery, liquidity pools, and candlestick anatomy in real time.",
    learnings: [
      "Read pure price action across NIFTY, BankNIFTY, and Global Equities without clutter",
      "Identify institutional buy/sell signatures inside single and multi-candle formations",
      "Master the Anatomy of Pin Bars, Engulfing Sweeps, and Inside Bar Expansion",
      "Execute high R:R entries at key market support and resistance pivots",
    ],
    modules: [
      {
        id: "m1",
        title: "Module 1: The Foundations of Price Delivery",
        lessons: [
          { id: "l1", title: "Why Retail Indicators Lag & How Price Actually Moves", duration: "18m", type: "video", completed: false },
          { id: "l2", title: "Anatomy of a Candlestick: Body vs. Wicks & Volume", duration: "24m", type: "video", completed: false },
          { id: "l3", title: "Market Structure: Swing Highs, Swing Lows & Trends", duration: "32m", type: "interactive_chart", completed: false },
        ],
      },
      {
        id: "m2",
        title: "Module 2: High-Probability Candlestick Formations",
        lessons: [
          { id: "l4", title: "The Liquidity Sweep Hammer & Reversal Dynamics", duration: "28m", type: "video", completed: false },
          { id: "l5", title: "Institutional Engulfing Bars at Value Areas", duration: "35m", type: "video", completed: false },
          { id: "l6", title: "Inside Bar Compression & Explosive Range Expansion", duration: "22m", type: "interactive_chart", completed: false },
        ],
      },
      {
        id: "m3",
        title: "Module 3: Confluence & Live Execution",
        lessons: [
          { id: "l7", title: "Key Support & Resistance Flipping into Support", duration: "25m", type: "video", completed: false },
          { id: "l8", title: "Multi-Timeframe Analysis: Daily Bias to 5m Entry", duration: "40m", type: "video", completed: false },
          { id: "l9", title: "Calculating Minimum 1:3 Risk-to-Reward Ratios", duration: "30m", type: "quiz", completed: false },
        ],
      },
      {
        id: "m4",
        title: "Module 4: Simulator Practice & Case Studies",
        lessons: [
          { id: "l10", title: "NIFTY 50 Intraday Reversal Case Study", duration: "45m", type: "interactive_chart", completed: false },
          { id: "l11", title: "Live Market Simulator Walkthrough", duration: "35m", type: "interactive_chart", completed: false },
          { id: "l12", title: "Final Assessment & Certificate Examination", duration: "20m", type: "quiz", completed: false },
        ],
      },
    ],
  },
  {
    id: "smc-institutional-order-flow",
    title: "Institutional Order Flow & Smart Money Concepts (SMC)",
    tagline: "Track Big Money footprints: Order Blocks, Imbalances (FVG), and Liquidity Sweeps.",
    category: "Smart Money (SMC)",
    level: "Advanced",
    rating: 4.95,
    reviewsCount: 1890,
    studentsCount: 9400,
    totalModules: 3,
    totalLessons: 10,
    duration: "18.0 Hours",
    progress: 0,
    isEnrolled: false,
    featured: true,
    instructor: {
      name: "Vikram Malhotra",
      role: "Quantitative Order Flow Analyst",
      avatarBg: "from-purple-600 to-indigo-600",
    },
    description:
      "Master the mechanics of institutional liquidity. Learn how algorithmic central bank dealers manipulate price to grab liquidity before initiating massive trending moves.",
    learnings: [
      "Locate and trade high-probability Bullish & Bearish Order Blocks",
      "Identify Fair Value Gaps (FVG) and premium/discount valuation zones",
      "Master Break of Structure (BOS) vs Change of Character (CHoCH)",
      "Avoid retail traps and trade in alignment with institutional algorithms",
    ],
    modules: [
      {
        id: "smc-m1",
        title: "Module 1: Liquidity Engineering & Market Manipulation",
        lessons: [
          { id: "smc-l1", title: "Buy-side vs Sell-side Liquidity Pools", duration: "24m", type: "video", completed: false },
          { id: "smc-l2", title: "Change of Character (CHoCH) vs Break of Structure (BOS)", duration: "36m", type: "video", completed: false },
        ],
      },
      {
        id: "smc-m2",
        title: "Module 2: Order Blocks & Fair Value Gaps",
        lessons: [
          { id: "smc-l3", title: "Identifying Valid Institutional Order Blocks", duration: "30m", type: "interactive_chart", completed: false },
          { id: "smc-l4", title: "Fair Value Gap (FVG) Imbalance Trading", duration: "28m", type: "video", completed: false },
        ],
      },
      {
        id: "smc-m3",
        title: "Module 3: Institutional Trade Execution",
        lessons: [
          { id: "smc-l5", title: "Optimal Trade Entry (OTE) Fibonacci Confluence", duration: "42m", type: "interactive_chart", completed: false },
          { id: "smc-l6", title: "Live Market SMC Blueprint & Quiz", duration: "25m", type: "quiz", completed: false },
        ],
      },
    ],
  },
  {
    id: "advanced-options-hedging",
    title: "Advanced Options Trading: Greeks, Volatility & Hedging",
    tagline: "Master Theta decay, Implied Volatility crush, and multi-leg delta-neutral strategies.",
    category: "Options & Derivatives",
    level: "Intermediate",
    rating: 4.85,
    reviewsCount: 1650,
    studentsCount: 11200,
    totalModules: 3,
    totalLessons: 9,
    duration: "12.0 Hours",
    progress: 0,
    isEnrolled: false,
    instructor: {
      name: "Dr. Ananya Sharma",
      role: "Derivatives Strategist & Ph.D. Finance",
      avatarBg: "from-emerald-600 to-teal-600",
    },
    description:
      "A systematic, mathematical approach to trading options in Indian & Global derivative markets. Understand non-linear risk and build consistent option selling & buying systems.",
    learnings: [
      "Master Option Greeks: Delta, Gamma, Theta, Vega in practical trading",
      "Deploy Iron Condors, Strangles, and Ratio Spreads with defined risk",
      "Capitalize on Volatility Skew and IV rank before earnings & expiry days",
    ],
    modules: [
      {
        id: "opt-m1",
        title: "Module 1: Option Greeks in Plain English",
        lessons: [
          { id: "opt-l1", title: "Delta & Gamma: Directional Speed & Risk", duration: "20m", type: "video", completed: false },
          { id: "opt-l2", title: "Theta & Vega: Time Value Decay & Volatility Spikes", duration: "32m", type: "video", completed: false },
        ],
      },
      {
        id: "opt-m2",
        title: "Module 2: Non-Directional Income Strategies",
        lessons: [
          { id: "opt-l3", title: "Iron Condor & Strangle Execution Rules", duration: "38m", type: "interactive_chart", completed: false },
          { id: "opt-l4", title: "Managing Adjustments when Tested", duration: "45m", type: "video", completed: false },
        ],
      },
    ],
  },
  {
    id: "systematic-risk-psychology",
    title: "Systematic Risk Architecture & Trading Psychology",
    tagline: "Position sizing algorithms, drawdown prevention, and emotional discipline mastery.",
    category: "Risk Management",
    level: "All Levels",
    rating: 4.98,
    reviewsCount: 3100,
    studentsCount: 22400,
    totalModules: 2,
    totalLessons: 6,
    duration: "8.5 Hours",
    progress: 0,
    isEnrolled: false,
    instructor: {
      name: "Capt. Arvind Nair",
      role: "Trading Psychology Consultant & Fund Manager",
      avatarBg: "from-amber-600 to-orange-600",
    },
    description:
      "90% of traders fail not because of strategy, but due to lack of risk architecture. Master Kelly Criterion, fractional sizing, and neurological control under market stress.",
    learnings: [
      "Never blow up an account: Maximum 1% risk per trade architecture",
      "Calculate optimal lot size dynamically based on stop-loss distance",
      "Eliminate FOMO, revenge trading, and over-leveraging with behavioral rules",
    ],
    modules: [
      {
        id: "risk-m1",
        title: "Module 1: The Mathematics of Capital Preservation",
        lessons: [
          { id: "risk-l1", title: "The Ruin Probability Curve & Fixed Fractional Sizing", duration: "22m", type: "video", completed: false },
          { id: "risk-l2", title: "Building an Asymmetrical Risk-to-Reward Matrix", duration: "30m", type: "quiz", completed: false },
        ],
      },
      {
        id: "risk-m2",
        title: "Module 2: Cognitive Biases & Trader Mindset",
        lessons: [
          { id: "risk-l3", title: "Rewiring the Brain Against Loss Aversion", duration: "35m", type: "video", completed: false },
          { id: "risk-l4", title: "Developing a Systematic Daily Pre-Market Routine", duration: "28m", type: "interactive_chart", completed: false },
        ],
      },
    ],
  },
];

// The DRM catalog is ordered from foundational to advanced content. Keep the
// dashboard's legacy level fields available without duplicating them in every
// catalog entry.
export const INITIAL_COURSES: Course[] = RAW_COURSES.map((course, index) => {
  const levelNumber = Math.min(index + 1, 5) as Course["levelNumber"];
  return {
    ...course,
    levelNumber,
    levelName: `Level ${levelNumber}: ${
      levelNumber === 1
        ? "Foundations"
        : levelNumber === 2
          ? "Technician"
          : levelNumber === 3
            ? "Strategist"
            : levelNumber === 4
              ? "Risk Manager"
              : "Elite Analyst"
    }`,
  };
});

export const COURSES = INITIAL_COURSES;

// LocalStorage helpers for real user state
export function getSavedCourses(userEmail: string): Course[] {
  if (typeof window === "undefined") return INITIAL_COURSES;
  try {
    const saved = localStorage.getItem(`chartcoach_courses_${userEmail}`);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Fallback
  }
  return INITIAL_COURSES;
}

export function saveCourses(userEmail: string, courses: Course[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`chartcoach_courses_${userEmail}`, JSON.stringify(courses));
  } catch {
    // Ignore error
  }
}
