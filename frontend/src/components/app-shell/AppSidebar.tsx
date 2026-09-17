"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TrendingUp,
  Crosshair,
  BookOpen,
  Target,
  Sparkles,
  Wrench,
  Users,
  Briefcase,
  BarChart2,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import { User } from "@/lib/api";
import ChartCoachLogo from "@/components/brand/ChartCoachLogo";
import { BentoGridIcon } from "@/components/brand/Icons";

type AppSidebarProps = {
  user: User;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSecurity: () => void;
  onLogout: () => void;
};

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

export default function AppSidebar({
  user,
  collapsed,
  onToggleCollapse,
  onOpenSecurity,
  onLogout,
}: AppSidebarProps) {
  const pathname = usePathname();

  // The 11 exact sidebar items from the reference design
  const navItems: NavItem[] = [
    {
      label: "Dashboard",
      href: "/dashboard",
      icon: BentoGridIcon,
      exact: true,
    },
    {
      label: "Market",
      href: "/market",
      icon: TrendingUp,
    },
    {
      label: "Trade",
      href: "/trade",
      icon: Crosshair,
    },
    {
      label: "Learn",
      href: "/learn/courses",
      icon: BookOpen,
    },
    {
      label: "Test player",
      href: "/learn/price-action-secrets/1",
      icon: BookOpen,
    },
    {
      label: "Preview video (no DRM)",
      href: "/learn/price-action-secrets/1?preview=1",
      icon: BookOpen,
    },
    {
      label: "Practice",
      href: "/simulator",
      icon: Target,
    },
    {
      label: "AI Coach",
      href: "/coach",
      icon: Sparkles,
    },
    {
      label: "Tools",
      href: "/tools",
      icon: Wrench,
    },
    {
      label: "Community",
      href: "/community",
      icon: Users,
    },
    {
      label: "Portfolio",
      href: "/portfolio",
      icon: Briefcase,
    },
    {
      label: "Reports",
      href: "/reports",
      icon: BarChart2,
    },
    {
      label: "Settings",
      href: "/settings",
      icon: SettingsIcon,
    },
  ];

  function isActive(item: NavItem): boolean {
    if (item.exact) {
      return pathname === item.href;
    }
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  return (
    <aside
      className={`hidden lg:flex flex-col fixed top-0 bottom-0 left-0 z-40 bg-white border-r border-slate-200/80 transition-all duration-300 ease-in-out ${
        collapsed ? "w-[76px]" : "w-60"
      }`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-4 sm:px-5 border-b border-slate-100">
        <ChartCoachLogo collapsed={collapsed} size="md" href="/dashboard" />

        {!collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation Body */}
      <div className="flex-1 flex flex-col justify-between overflow-y-auto custom-scrollbar p-3 space-y-4">
        {/* Main 11 Navigation Items */}
        <div className="space-y-1">
          {navItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-all duration-150 ${
                  active
                    ? "bg-[#EBF3FE] text-blue-600 font-bold shadow-xs"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 font-medium"
                } ${collapsed ? "justify-center px-0" : ""}`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    active ? "text-blue-600" : "text-slate-400 group-hover:text-slate-700"
                  }`}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>

        {/* Bottom Section: Upgrade to Pro Card */}
        {!collapsed ? (
          <div className="pt-2 space-y-3">
            {user.subscription_plan === "elite" ? (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#061e16] via-[#09291e] to-[#041710] p-4 text-white border border-emerald-500/30 shadow-lg shadow-emerald-950/20">
                <div className="flex items-center justify-between">
                  <span className="text-lg leading-none" role="img" aria-label="crown">👑</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 border border-emerald-400/40">
                    Elite Active
                  </span>
                </div>
                <h4 className="mt-2 text-sm font-extrabold tracking-tight text-white">Full Access Active</h4>
                <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">
                  All 5 courses, all tools, and 4,000 monthly gems.
                </p>
                <Link
                  href="/settings"
                  className="mt-3.5 flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer"
                >
                  <span>Manage Membership</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ) : user.subscription_plan === "pro" ? (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#09152B] via-[#0E2042] to-[#0A1628] p-4 text-white border border-blue-500/30 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="text-lg leading-none" role="img" aria-label="crown">👑</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/40">
                    Pro Active
                  </span>
                </div>
                <h4 className="mt-2 text-sm font-extrabold tracking-tight text-white">Pro Membership</h4>
                <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">
                  1,500 Gems, live simulator & advanced tools active.
                </p>
                <Link
                  href="/settings"
                  className="mt-3.5 flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer"
                >
                  <span>Manage Membership</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#09152B] via-[#0E2042] to-[#0A1628] p-4 text-white border border-slate-800 shadow-lg">
                <div className="flex items-center gap-2">
                  <span className="text-lg leading-none" role="img" aria-label="crown">👑</span>
                </div>
                <h4 className="mt-2 text-sm font-extrabold tracking-tight text-white">Upgrade to Pro</h4>
                <ul className="mt-2 space-y-1.5 text-[11px] text-slate-300">
                  <li className="flex items-center gap-1.5">
                    <span className="text-blue-400 font-bold text-xs">✦</span>
                    <span>Unlock advanced tools</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-blue-400 font-bold text-xs">✦</span>
                    <span>Live trading sessions</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-blue-400 font-bold text-xs">✦</span>
                    <span>Premium courses</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-blue-400 font-bold text-xs">✦</span>
                    <span>1,500 monthly Gems</span>
                  </li>
                </ul>
                <Link
                  href="/pricing"
                  className="mt-3.5 flex items-center justify-center gap-1.5 w-full py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-600/30 transition-all cursor-pointer"
                >
                  <span>Upgrade Now</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}

            {/* Subtle Biometric Status */}
            <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
              <button
                type="button"
                onClick={onOpenSecurity}
                className="flex items-center gap-1.5 hover:text-slate-600 transition-colors"
              >
                {user.has_face_enrolled ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                )}
                <span>{user.has_face_enrolled ? "Face ID Secured" : "Setup Face ID"}</span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="hover:text-rose-600 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-2 flex flex-col items-center gap-2">
            <Link
              href="/pricing"
              title="Upgrade to Pro"
              className="w-10 h-10 rounded-xl bg-gradient-to-b from-[#09152B] to-[#0E2042] text-amber-400 border border-slate-800 flex items-center justify-center text-sm shadow-md hover:scale-105 transition-all"
            >
              👑
            </Link>
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              className="w-full flex items-center justify-center p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
