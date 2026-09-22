"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MonitorDot, ChefHat, BarChart3, UtensilsCrossed, Settings, LogOut,
  X, Check, Menu, ShieldCheck, RefreshCw
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { useCurrentCashier } from "@/hooks/useCurrentCashier";
import { DrawerHandoverModal } from "@/components/cashier/DrawerHandoverModal";

export function Navbar({ rightActions }: { rightActions?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { settings } = useSettings();
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [toastMessage, setToastMessage] = useState("");
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  const logoutConfirmBtnRef = useRef<HTMLButtonElement>(null);

  const { isAuthenticated, login, logout } = useAuth();
  const cashier = useCurrentCashier();
  const currencySymbol = settings?.currency || "LKR";

  const handleLogoutConfirm = useCallback(() => {
    setShowLogoutConfirm(false);
    setShowMobileNav(false);
    logout();
  }, [logout]);

  const handleLogoutCancel = useCallback(() => {
    setShowLogoutConfirm(false);
  }, []);

  useEffect(() => {
    if (!showLogoutConfirm) return;
    setTimeout(() => logoutConfirmBtnRef.current?.focus(), 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleLogoutCancel();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleLogoutConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showLogoutConfirm, handleLogoutConfirm, handleLogoutCancel]);

  useEffect(() => {
    setMounted(true);
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (showMobileNav) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [showMobileNav]);

  const links = [
    { href: "/menu", label: "Menu", icon: UtensilsCrossed },
    { href: "/kitchen", label: "Kitchen", icon: ChefHat },
    { href: "/cashier", label: "Cashier", icon: MonitorDot },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/admin", label: "Settings", icon: Settings },
  ];

  const visibleLinks = links.filter((link) => {
    if (link.href === "/menu") return true;
    return isAuthenticated;
  });

  const formatDateTime = (date: Date) => {
    const weekday = date.toLocaleString("en-US", { weekday: "short" });
    const day = date.toLocaleString("en-US", { day: "2-digit" });
    const month = date.toLocaleString("en-US", { month: "short" });
    const time = date.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    return `${weekday}, ${month} ${day} | ${time}`;
  };

  const formatTimeOnly = (date: Date) => {
    return date.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  };

  const brandDisplayName = settings?.name || "Restaurant POS";

  return (
    <>
      <nav
        className={`fixed top-0 left-0 w-full z-40 transition-all duration-200 no-print flex items-center justify-between px-2.5 sm:px-4 h-16 select-none flex-nowrap ${scrolled
          ? "bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-xs"
          : "bg-white border-b border-slate-200/80"
          }`}
      >
        {/* Left Section: Logo, Primary Cashier & Date */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 min-w-0">
          {/* Logo & Subtitle */}
          <Link href="/cashier" className="flex items-center gap-2 shrink-0 group">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-500 text-white flex items-center justify-center shadow-md shadow-orange-500/30 shrink-0 group-hover:scale-105 transition-transform">
              <MonitorDot className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="flex flex-col min-w-0">
              <h1 className="text-slate-900 font-black text-xs sm:text-sm leading-tight tracking-tight truncate">
                Smart POS
              </h1>
              <p className="text-[9px] sm:text-[10px] text-orange-600 font-black uppercase tracking-wider truncate">
                {brandDisplayName}
              </p>
            </div>
          </Link>

          {/* Active Cashier Badge */}
          {mounted && isAuthenticated && (
            <div
              title={`Role: ${cashier.role}`}
              className="hidden lg:flex items-center gap-1.5 h-8 px-3 rounded-full bg-emerald-50/80 border border-emerald-300 text-emerald-800 shadow-2xs shrink-0 cursor-default"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="text-[11px] font-black uppercase tracking-wider whitespace-nowrap">
                Cashier: {cashier.name}
              </span>
            </div>
          )}

          {/* Date & Time Pill (Laptops: Time only | Wide 2XL Screens: Full Date + Time) */}
          {mounted && (
            <div className="hidden sm:flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-full bg-slate-50/80 border border-slate-200/90 text-[11px] font-bold text-slate-700 whitespace-nowrap shrink-0 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="hidden 2xl:inline">{formatDateTime(currentTime)}</span>
              <span className="inline 2xl:hidden">{formatTimeOnly(currentTime)}</span>
            </div>
          )}
        </div>

        {/* Center Section: Navigation (Desktop Only) */}
        <div className="hidden md:flex items-center justify-center absolute left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-2xl border border-slate-200/70 shadow-2xs">
            {visibleLinks.map((link) => {
              const isActive = pathname.startsWith(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  title={link.label}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${isActive
                    ? "bg-white text-orange-600 shadow-xs scale-[1.02]"
                    : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                    }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden 2xl:inline">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right Section: Buttons, Logout & Mobile Hamburger Button */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0 ml-auto">
          {rightActions}

          {/* Switch Cashier Button */}
          {mounted && isAuthenticated && (
            <button
              onClick={() => setShowHandoverModal(true)}
              title={`Switch Cashier (currently: ${cashier.name})`}
              className="hidden sm:flex items-center gap-1.5 h-8 sm:h-9 px-3 rounded-full text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 hover:border-amber-300 transition-all shrink-0 active:scale-95 cursor-pointer shadow-2xs text-[11px] font-bold whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5 stroke-[2.2] shrink-0" />
              <span className="hidden xl:inline">Switch Cashier</span>
            </button>
          )}

          {/* Logout Button */}
          {mounted && isAuthenticated && (
            <button
              onClick={() => setShowLogoutConfirm(true)}
              title="Log Out"
              className="h-8 sm:h-9 w-8 sm:w-9 flex items-center justify-center rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200/90 hover:border-rose-200 transition-all shrink-0 bg-white active:scale-95 cursor-pointer shadow-2xs"
            >
              <LogOut className="w-3.5 h-3.5 stroke-[2.2]" />
            </button>
          )}

          {/* Mobile Hamburger Button */}
          <button
            type="button"
            onClick={() => setShowMobileNav(true)}
            className="md:hidden h-8 w-8 flex items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 active:scale-95 transition-all shrink-0 border border-slate-200 cursor-pointer"
            aria-label="Open navigation menu"
          >
            <Menu className="w-4.5 h-4.5 stroke-[2.5]" />
          </button>
        </div>
      </nav>

      {/* Mobile Navigation Drawer */}
      {showMobileNav && (
        <div
          className="fixed inset-0 z-[110] md:hidden flex justify-end bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setShowMobileNav(false)}
        >
          <div
            className="w-72 bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center shadow-sm shadow-orange-500/20">
                  <MonitorDot className="w-4.5 h-4.5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm leading-tight">Smart POS</h3>
                  <p className="text-[9px] text-orange-500 font-bold uppercase tracking-wider">{brandDisplayName}</p>
                </div>
              </div>
              <button
                onClick={() => setShowMobileNav(false)}
                className="p-1.5 bg-slate-200 hover:bg-slate-300 rounded-full text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-3">Navigation</p>
              {visibleLinks.map((link) => {
                const isActive = pathname.startsWith(link.href);
                const Icon = link.icon;
                const emoji =
                  link.href === "/menu"
                    ? "🍽️"
                    : link.href === "/cashier"
                      ? "💵"
                      : link.href === "/kitchen"
                        ? "👨‍🍳"
                        : link.href === "/analytics"
                          ? "📊"
                          : "⚙️";

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setShowMobileNav(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${isActive
                      ? "bg-orange-50 text-orange-600 border border-orange-200 shadow-xs"
                      : "text-slate-700 hover:bg-slate-50 border border-transparent"
                      }`}
                  >
                    <span className="text-base leading-none">{emoji}</span>
                    <Icon className="w-4 h-4" />
                    <span>{link.label}</span>
                    {isActive && <span className="ml-auto w-2 h-2 rounded-full bg-orange-500" />}
                  </Link>
                );
              })}
            </div>

            {mounted && isAuthenticated && (
              <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-3">
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 shadow-xs">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Cashier</p>
                    <p className="text-slate-800 font-bold">{cashier.name}</p>
                    <p className="text-[9px] text-slate-400 font-medium capitalize">{cashier.role}</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowMobileNav(false); setShowHandoverModal(true); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 text-sm font-bold hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  Switch Cashier
                </button>
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 text-sm font-bold hover:bg-rose-100 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full shadow-xl shadow-slate-900/20 font-bold text-sm z-[99999] animate-in fade-in slide-in-from-top-4 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" /> {toastMessage}
        </div>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={handleLogoutCancel}
        >
          <div
            className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-sm w-full animate-in zoom-in-95 duration-200 border border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mb-5 shadow-inner border border-rose-100">
              <LogOut className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Log Out</h2>
            <p className="text-sm font-medium text-slate-500 mb-6">Are you sure you want to log out?</p>
            <div className="flex gap-3">
              <button
                onClick={handleLogoutCancel}
                className="flex-1 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-bold text-sm hover:bg-slate-100 transition-all active:scale-[0.98] cursor-pointer"
              >
                Cancel
              </button>
              <button
                ref={logoutConfirmBtnRef}
                onClick={handleLogoutConfirm}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm transition-all shadow-[0_8px_20px_rgba(225,29,72,0.25)] active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-rose-250 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Log Out
              </button>
            </div>
            <p className="text-[10px] text-slate-400 text-center mt-4 font-medium">
              Press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px]">Enter</kbd> to confirm · <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px]">Esc</kbd> to cancel
            </p>
          </div>
        </div>
      )}

      {/* Cash Drawer Handover Modal */}
      <DrawerHandoverModal
        isOpen={showHandoverModal}
        outgoingCashier={cashier}
        currencySymbol={currencySymbol}
        onConfirm={(incomingProfile) => {
          setShowHandoverModal(false);
          login(incomingProfile.name, true, incomingProfile);
          router.push("/cashier");
        }}
        onQuickSwitch={() => {
          setShowHandoverModal(false);
          logout();
        }}
        onClose={() => setShowHandoverModal(false)}
      />
    </>
  );
}