"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  Minus,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Zap,
  ArrowRight,
  Flame,
  HelpCircle,
  Crown,
  BookOpen,
  Wrench,
  CheckCircle2,
  LifeBuoy,
  Link2,
  Plus,
  ArrowDown,
} from "lucide-react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion";
import { useAuth } from "@/context/AuthContext";
import {
  fetchPlans,
  fetchMembership,
  cancelSubscription,
  SubscriptionPlan,
  MembershipDetails,
} from "@/lib/api";
import { BillingCheckoutModal } from "@/components/billing/BillingCheckoutModal";
import { DowngradeModal } from "@/components/billing/DowngradeModal";
import { PostPurchaseSuccessModal } from "@/components/billing/PostPurchaseSuccessModal";
import NumberFlow, { NumberFlowGroup } from "@number-flow/react";

const PLAN_RANKS: Record<string, number> = {
  free: 0,
  basic: 1,
  trader: 2,
  pro: 3,
  elite: 4,
};

export default function PricingPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [membership, setMembership] = useState<MembershipDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [isAnnualAnimActive, setIsAnnualAnimActive] = useState(false);
  const [showComparison, setShowComparison] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function handleSelectInterval(newInterval: "monthly" | "yearly") {
    setInterval(newInterval);
    if (newInterval === "yearly") {
      setIsAnnualAnimActive(true);
      setTimeout(() => setIsAnnualAnimActive(false), 900);
    }
  }

  // Modals state
  const [selectedPlanForCheckout, setSelectedPlanForCheckout] = useState<SubscriptionPlan | null>(null);
  const [planForDowngrade, setPlanForDowngrade] = useState<SubscriptionPlan | null>(null);
  const [postPurchaseData, setPostPurchaseData] = useState<{
    planName: string;
    planSlug: string;
    monthlyGems: number;
    coursesCount: number;
    toolsCount: number;
  } | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [plansData, membershipData] = await Promise.all([
          fetchPlans(),
          user ? fetchMembership().catch(() => null) : Promise.resolve(null),
        ]);
        setPlans(plansData);
        setMembership(membershipData);
      } catch (err) {
        console.error("Error loading pricing data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [user]);

  const currentPlanSlug = membership?.plan || user?.subscription_plan || "free";

  function handlePlanAction(plan: SubscriptionPlan) {
    if (!user) {
      router.push(`/login?redirect=/pricing`);
      return;
    }
    setStatusMessage(null);

    const currentRank = PLAN_RANKS[currentPlanSlug] ?? 0;
    const targetRank = PLAN_RANKS[plan.slug] ?? 0;

    // Active plan
    if (plan.slug === currentPlanSlug && currentPlanSlug !== "free") {
      return;
    }

    // Downgrade confirmation if user has higher active plan
    if (currentPlanSlug !== "free" && targetRank < currentRank) {
      setPlanForDowngrade(plan);
      return;
    }

    // Direct single-step billing checkout
    setSelectedPlanForCheckout(plan);
  }

  async function handleConfirmDowngrade(targetSlug: string) {
    try {
      await cancelSubscription();
      await refreshUser();
      setStatusMessage({
        type: "success",
        text: `Your switch to the ${targetSlug.toUpperCase()} tier will take effect at the end of your prepaid billing period.`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to schedule plan change.",
      });
    }
  }

  const FAQS = [
    {
      id: "faq-1",
      icon: Sparkles,
      title: "How do ChartCoach subscriptions work?",
      sub: "Instant access to courses, simulator & monthly AI gems",
      content:
        "When you subscribe, you instantly unlock the courses and tools in your chosen plan, plus a fresh batch of AI Coach gems every month. You can learn at your own pace, practice on the simulator, and cancel or change plans anytime with one click.",
    },
    {
      id: "faq-2",
      icon: Zap,
      title: "What are AI Coach Gems and how do they work?",
      sub: "Ask questions, analyze stock charts, and get instant feedback",
      content:
        "Gems let you ask your personal AI Coach questions, analyze charts, and review trading decisions. Each month, your gem balance automatically refreshes based on your plan. Gems never expire as long as your plan is active.",
    },
    {
      id: "faq-3",
      icon: ShieldCheck,
      title: "Can I practice without risking real money?",
      sub: "Risk-free paper trading with live market simulations",
      content:
        "Yes! Our Trader, Pro, and Elite plans include a real-time market simulator (paper trading). You can practice buying and selling stocks with virtual money in live market conditions without any financial risk.",
    },
    {
      id: "faq-4",
      icon: LifeBuoy,
      title: "Can I change or cancel my plan later?",
      sub: "Flexible monthly or annual plans with one-click cancellation",
      content:
        "Yes, anytime. If you cancel, your access stays active until the end of your prepaid billing period. You will never be charged unexpected fees, and you can easily resume whenever you're ready.",
    },
    {
      id: "faq-5",
      icon: BookOpen,
      title: "Will I lose my progress or notes if my subscription ends?",
      sub: "Your completed lessons and notes stay saved forever",
      content:
        "No. All your completed lessons, quiz scores, simulator trade history, and personal notes are safely saved to your account forever.",
    },
    {
      id: "faq-6",
      icon: Link2,
      title: "What payment methods are supported?",
      sub: "Fast, 100% secure checkout powered by Razorpay",
      content:
        "We support all major payment methods via secure Razorpay checkout: UPI (Google Pay, PhonePe, Paytm, BHIM, QR code), Credit and Debit Cards (Visa, Mastercard, RuPay), and NetBanking across 50+ banks.",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-16 animate-fade-up">
      {/* ── Friendly Hero Section ── */}
      <header className="relative text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200/70 text-blue-700 text-xs font-bold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span>Simple, transparent pricing</span>
        </div>

        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 leading-[1.15]">
          Plans that grow with your{" "}
          <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 bg-clip-text text-transparent">
            trading journey
          </span>
        </h1>

        <p className="text-sm sm:text-base text-slate-500 font-medium leading-relaxed max-w-2xl mx-auto">
          Learn to read price charts, practice trading with virtual money, and get real-time feedback from your personal AI coach. Switch plans or cancel anytime.
        </p>

        {/* ── Monthly / Annual Billing Toggle ── */}
        <div className="pt-2 flex items-center justify-center">
          <div className="inline-flex items-center p-1.5 rounded-2xl bg-slate-100/90 border border-slate-200/90 shadow-inner">
            <button
              type="button"
              onClick={() => handleSelectInterval("monthly")}
              className={`px-5 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                interval === "monthly"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              onClick={() => handleSelectInterval("yearly")}
              className={`px-5 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-2 relative ${
                interval === "yearly"
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <span>Annual Billing</span>
              <span
                className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full tracking-wide transition-all flex items-center gap-1 ${
                  interval === "yearly"
                    ? "bg-white text-blue-700 shadow-xs"
                    : "bg-emerald-100 text-emerald-800"
                } ${isAnnualAnimActive ? "animate-celebration ring-2 ring-emerald-400/80" : ""}`}
              >
                <Sparkles className={`w-2.5 h-2.5 ${isAnnualAnimActive ? "animate-spin text-amber-500" : "text-current"}`} />
                <span>Save 20%</span>
              </span>
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            className={`mt-4 p-4 rounded-2xl text-xs sm:text-sm font-semibold border transition-all ${
              statusMessage.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-red-50 text-red-800 border-red-200"
            }`}
          >
            {statusMessage.text}
          </div>
        )}
      </header>

      {/* ── 4 Clean Pricing Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
        {plans.map((plan) => {
          const isCurrent = currentPlanSlug === plan.slug;
          const isPro = plan.slug === "pro";
          const isElite = plan.slug === "elite";
          const isYearly = interval === "yearly";

          const displayPrice = isYearly
            ? (plan.price_yearly || Math.round(plan.price * 12 * 0.8))
            : plan.price;

          const monthlyEquivalent = isYearly ? Math.round(displayPrice / 12) : plan.price;
          const annualSavings = isYearly ? plan.price * 12 - displayPrice : 0;

          const planRank = PLAN_RANKS[plan.slug] ?? 0;
          const currentRank = PLAN_RANKS[currentPlanSlug] ?? 0;

          // Upgrades and downgrades are strictly relative to the user's active membership plan:
          const isDowngrade = currentRank > 0 && planRank < currentRank;
          const isUpgrade = planRank > currentRank;

          return (
            <div
              key={plan.slug}
              className={`relative rounded-3xl p-6 sm:p-7 flex flex-col justify-between transition-all duration-300 ${
                isPro
                  ? "bg-white border-2 border-blue-600 shadow-xl shadow-blue-500/10 lg:-translate-y-2 ring-4 ring-blue-500/10"
                  : isElite
                  ? "bg-gradient-to-b from-slate-900 via-slate-900 to-[#042014] text-white border border-emerald-500/30 shadow-xl shadow-emerald-950/20 hover:border-emerald-500/50"
                  : "bg-white border border-slate-200/90 hover:border-slate-300 shadow-xs hover:shadow-md"
              }`}
            >
              {/* Pro Badge */}
              {isPro && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-[10px] uppercase tracking-wider shadow-md flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 fill-current text-amber-300" />
                  <span>Most Popular</span>
                </div>
              )}

              {/* Elite Badge */}
              {isElite && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-black text-[10px] uppercase tracking-wider shadow-md shadow-emerald-500/20 flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 fill-current text-white" />
                  <span>All-Inclusive</span>
                </div>
              )}

              <div>
                {/* Plan Header */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h3 className={`text-xl font-black ${isElite ? "text-white" : "text-slate-900"}`}>
                      {plan.name}
                    </h3>
                    {isCurrent && (
                      <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        Current Plan
                      </span>
                    )}
                  </div>
                  <p className={`text-[11px] font-extrabold uppercase tracking-wider ${isElite ? "text-emerald-400" : "text-blue-600"}`}>
                    {plan.positioning}
                  </p>
                  <p className={`text-xs mt-1.5 min-h-[36px] leading-relaxed font-medium ${isElite ? "text-slate-400" : "text-slate-500"}`}>
                    {plan.description}
                  </p>
                </div>

                {/* Price Display */}
                <div className={`mt-5 pb-5 border-b ${isElite ? "border-slate-800" : "border-slate-100"}`}>
                  <NumberFlowGroup>
                    <div className="flex items-baseline gap-1">
                      <NumberFlow
                        value={monthlyEquivalent}
                        prefix="₹"
                        locales="en-IN"
                        className={`text-3xl sm:text-4xl font-black font-mono tracking-tight ${
                          isElite ? "text-white" : "text-slate-900"
                        }`}
                      />
                      <span className={`text-xs font-medium ${isElite ? "text-slate-400" : "text-slate-400"}`}>
                        / month
                      </span>
                    </div>

                    {isYearly ? (
                      <div className={`mt-1 flex items-center gap-1.5 text-[11px] transition-all ${isAnnualAnimActive ? "animate-in fade-in slide-in-from-top-1 duration-300" : ""}`}>
                        <span className={`font-semibold ${isElite ? "text-slate-400" : "text-slate-500"}`}>
                          <NumberFlow value={displayPrice} prefix="₹" locales="en-IN" /> billed yearly
                        </span>
                        <span
                          className={`font-bold px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 transition-transform ${
                            isElite ? "bg-emerald-950 text-emerald-400" : "bg-emerald-50 text-emerald-700"
                          } ${isAnnualAnimActive ? "animate-celebration ring-1 ring-emerald-500/40" : ""}`}
                        >
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>Save </span>
                          <NumberFlow value={annualSavings} prefix="₹" locales="en-IN" />
                        </span>
                      </div>
                    ) : (
                      <span className={`text-[11px] block mt-1 ${isElite ? "text-slate-500" : "text-slate-400"}`}>
                        Billed monthly • Cancel anytime
                      </span>
                    )}
                  </NumberFlowGroup>
                </div>

                {/* Highlights */}
                <div className="mt-5 space-y-3 text-xs">
                  <div className={`flex items-center gap-2.5 font-bold ${isElite ? "text-white" : "text-slate-800"}`}>
                    <div className={`w-5 h-5 rounded-lg flex items-center justify-center shrink-0 ${
                      isElite ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-50 text-blue-600"
                    }`}>
                      <Zap className="w-3 h-3 fill-current" />
                    </div>
                    <span>{Number(plan.monthly_gems ?? 0).toLocaleString("en-IN")} AI Coach Gems / month</span>
                  </div>

                  <div className={`flex items-start gap-2.5 ${isElite ? "text-slate-300" : "text-slate-600"}`}>
                    <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                    <span>
                      {plan.included_courses.length === 5
                        ? "All 5 Complete Courses"
                        : `${plan.included_courses.length} Course${
                            plan.included_courses.length > 1 ? "s" : ""
                          } Included`}
                    </span>
                  </div>

                  <div className={`flex items-start gap-2.5 ${isElite ? "text-slate-300" : "text-slate-600"}`}>
                    <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                    <span>
                      {plan.included_tools.length >= 6
                        ? "All 6 Trading Tools"
                        : `${plan.included_tools.length} Trading Tools`}
                    </span>
                  </div>

                  <div className={`flex items-start gap-2.5 ${isElite ? "text-slate-300" : "text-slate-600"}`}>
                    {plan.simulator_access === "full" ? (
                      <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-slate-200/70 text-slate-400 flex items-center justify-center shrink-0 mt-0.5">
                        <Minus className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    )}
                    <span className={plan.simulator_access === "full" ? "" : isElite ? "text-slate-500" : "text-slate-400"}>
                      {plan.simulator_access === "full"
                        ? "Live Market Simulator (Paper Trading)"
                        : "Simulator Not Included"}
                    </span>
                  </div>

                  <div className={`flex items-start gap-2.5 ${isElite ? "text-slate-300" : "text-slate-600"}`}>
                    <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                    <span>
                      {plan.community_tier === "priority"
                        ? "Priority Community Support"
                        : `${plan.community_tier.charAt(0).toUpperCase() + plan.community_tier.slice(1)} Community Access`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Action CTA */}
              <div className={`mt-7 pt-4 border-t ${isElite ? "border-slate-800" : "border-slate-100"}`}>
                <button
                  type="button"
                  disabled={isCurrent}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlanAction(plan);
                  }}
                  className={`w-full py-3.5 px-4 rounded-2xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 group ${
                    isCurrent
                      ? "bg-slate-100 text-slate-500 cursor-default"
                      : isDowngrade
                      ? isElite
                        ? "bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 shadow-xs"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300/80 shadow-xs"
                      : isPro
                      ? "bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-lg shadow-blue-500/25"
                      : isElite
                      ? "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/25 active:scale-[0.99]"
                      : "bg-slate-900 hover:bg-slate-800 text-white"
                  }`}
                >
                  {isCurrent ? (
                    <span>Active Plan</span>
                  ) : isDowngrade ? (
                    <>
                      <ArrowDown className="w-4 h-4 text-slate-500 group-hover:translate-y-0.5 transition-transform" />
                      <span>Downgrade to {plan.name}</span>
                    </>
                  ) : isUpgrade ? (
                    <>
                      <span>
                        {currentRank > 0
                          ? `Upgrade to ${plan.name}`
                          : isPro
                          ? "Get Pro"
                          : isElite
                          ? "Get Elite"
                          : `Get Started with ${plan.name}`}
                      </span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </>
                  ) : (
                    <>
                      <span>
                        {isPro
                          ? "Get Pro"
                          : isElite
                          ? "Get Elite"
                          : `Get Started with ${plan.name}`}
                      </span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Detailed Feature Comparison (Approachable & Clear) ── */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900">
              Compare all plan features
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
              See what’s included in each plan to find the right fit for you.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowComparison(!showComparison)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors cursor-pointer w-fit"
          >
            <span>{showComparison ? "Hide Comparison" : "Show Full Comparison"}</span>
            {showComparison ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {showComparison && (
          <div className="overflow-x-auto pt-4 border-t border-slate-100">
            <table className="w-full text-left text-xs border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Feature</th>
                  <th className="py-3 px-4 text-center">Basic (₹499)</th>
                  <th className="py-3 px-4 text-center">Trader (₹999)</th>
                  <th className="py-3 px-4 text-center bg-blue-50/60 text-blue-700 font-black rounded-t-xl">
                    Pro (₹1,999)
                  </th>
                  <th className="py-3 px-4 text-center font-black text-slate-900">Elite (₹3,499)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {/* ── Courses ── */}
                <tr className="bg-slate-50/80 font-black text-slate-900">
                  <td colSpan={5} className="py-2.5 px-4 text-[11px] uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Courses & Lessons</span>
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Trading 101: Stock Market Basics</td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Chart Reading 101: Candlestick Patterns</td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Reading the Market: Trends & Momentum</td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">The Language of Price: Support & Resistance</td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Building Your Trading Strategy</td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>

                {/* ── AI Coach & Gems ── */}
                <tr className="bg-slate-50/80 font-black text-slate-900">
                  <td colSpan={5} className="py-2.5 px-4 text-[11px] uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    <span>AI Coach & Monthly Gems</span>
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Monthly AI Coach Gems</td>
                  <td className="py-3 px-4 text-center font-mono font-bold text-slate-700">200</td>
                  <td className="py-3 px-4 text-center font-mono font-bold text-slate-700">500</td>
                  <td className="py-3 px-4 text-center font-mono font-black text-blue-700 bg-blue-50/40">1,500</td>
                  <td className="py-3 px-4 text-center font-mono font-black text-emerald-600">4,000</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Personal AI Coach Access</td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>

                {/* ── Practice & Tools ── */}
                <tr className="bg-slate-50/80 font-black text-slate-900">
                  <td colSpan={5} className="py-2.5 px-4 text-[11px] uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5" />
                    <span>Practice & Trading Tools</span>
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Stock Screener & Economic Calendar</td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">AI Chart Pattern Scanner</td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Virtual Market Simulator (Paper Trading)</td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Options Chain & Strategy Builder</td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center"><MinusBadge /></td>
                  <td className="py-3 px-4 text-center bg-blue-50/40"><CheckBadge /></td>
                  <td className="py-3 px-4 text-center"><CheckBadge /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-900">Community Discussion Access</td>
                  <td className="py-3 px-4 text-center text-slate-500 font-semibold">Limited</td>
                  <td className="py-3 px-4 text-center text-slate-700 font-semibold">Standard</td>
                  <td className="py-3 px-4 text-center text-blue-700 font-bold bg-blue-50/40">Full Access</td>
                  <td className="py-3 px-4 text-center text-emerald-600 font-black">Priority</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Frequently Asked Questions (Interactive Radix Accordion) ── */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-blue-600" />
            <span>Frequently asked questions</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
            Quick answers about subscriptions, billing, AI gems, and cancellation.
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full" defaultValue="faq-1">
          {FAQS.map((faq) => (
            <AccordionItem value={faq.id} key={faq.id} className="py-2.5 border-b border-slate-100 last:border-b-0">
              <AccordionPrimitive.Header className="flex">
                <AccordionPrimitive.Trigger className="flex flex-1 items-center justify-between py-2 text-left text-[15px] font-bold leading-6 transition-all [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 [&[data-state=open]>svg]:rotate-180 group cursor-pointer">
                  <span className="flex items-center gap-3.5">
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50/80 text-blue-600 border border-blue-100/80 group-hover:bg-blue-100 transition-colors"
                      aria-hidden="true"
                    >
                      <faq.icon size={18} strokeWidth={2} className="opacity-90" />
                    </span>
                    <span className="flex flex-col space-y-0.5">
                      <span className="text-slate-900 group-hover:text-blue-600 transition-colors">
                        {faq.title}
                      </span>
                      {faq.sub && (
                        <span className="text-xs font-normal text-slate-500">
                          {faq.sub}
                        </span>
                      )}
                    </span>
                  </span>
                  <Plus
                    size={18}
                    strokeWidth={2}
                    className="shrink-0 text-slate-400 opacity-70 group-hover:opacity-100 transition-transform duration-200 ml-4"
                    aria-hidden="true"
                  />
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionContent className="ms-3 pb-3 ps-10 text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
                {faq.content}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {/* ── Peace of Mind Guarantee Bar ── */}
      <div className="p-6 sm:p-7 rounded-3xl bg-gradient-to-br from-slate-50 to-blue-50/30 border border-slate-200/80 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 shadow-xs">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-black text-slate-900 text-sm sm:text-base">
              Clear terms & simple cancellation
            </h4>
            <p className="text-xs text-slate-500 mt-0.5 max-w-xl font-medium leading-relaxed">
              No contracts or hidden fees. Switch plans or cancel anytime from your settings in one click.
              Your access continues until the end of your billing cycle.
            </p>
          </div>
        </div>

        <Link
          href="/learn/courses"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white border border-slate-200/90 text-slate-800 hover:text-slate-950 hover:bg-slate-50 text-xs font-black transition-all shadow-xs shrink-0 group"
        >
          <span>Browse Courses First</span>
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      {/* ── Modals ── */}
      {selectedPlanForCheckout && (
        <BillingCheckoutModal
          isOpen={!!selectedPlanForCheckout}
          onClose={() => setSelectedPlanForCheckout(null)}
          plan={selectedPlanForCheckout}
          initialInterval={interval}
          onSuccess={(data) => {
            setSelectedPlanForCheckout(null);
            setPostPurchaseData(data);
            refreshUser();
          }}
          onError={(err) => {
            setStatusMessage({ type: "error", text: err });
          }}
        />
      )}

      {planForDowngrade && (
        <DowngradeModal
          isOpen={!!planForDowngrade}
          onClose={() => setPlanForDowngrade(null)}
          targetPlan={{
            name: planForDowngrade.name,
            slug: planForDowngrade.slug,
            price: planForDowngrade.price,
            priceYearly: planForDowngrade.price_yearly,
            description: planForDowngrade.description,
          }}
          currentPlanName={membership?.planName || currentPlanSlug.toUpperCase()}
          renewalDate={
            membership?.renewalDate
              ? new Date(membership.renewalDate).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : undefined
          }
          onConfirmDowngrade={handleConfirmDowngrade}
        />
      )}

      {postPurchaseData && (
        <PostPurchaseSuccessModal
          isOpen={!!postPurchaseData}
          onClose={() => setPostPurchaseData(null)}
          planName={postPurchaseData.planName}
          planSlug={postPurchaseData.planSlug}
          monthlyGems={postPurchaseData.monthlyGems}
          coursesCount={postPurchaseData.coursesCount}
          toolsCount={postPurchaseData.toolsCount}
        />
      )}
    </div>
  );
}

/* ── Vector Check & Minus Badges (Zero Raw Emojis) ── */
function CheckBadge() {
  return (
    <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700">
      <Check className="w-3 h-3 stroke-[3]" />
    </div>
  );
}

function MinusBadge() {
  return (
    <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-400">
      <Minus className="w-3 h-3 stroke-[2.5]" />
    </div>
  );
}
