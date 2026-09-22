"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X, ShieldCheck, AlertCircle, CheckCircle2, RefreshCw,
  Banknote, ArrowRight, Loader2, Eye, EyeOff,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { verifyStaffByPin, recordCashierHandover } from "@/app/actions/manager";
import type { CashierProfile } from "@/context/AuthContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandoverSummary {
  openingFloat: number;
  cashSales: number;
  pettyCashOut: number;
  expectedCash: number;
}

interface DrawerHandoverModalProps {
  isOpen: boolean;
  outgoingCashier: CashierProfile;
  currencySymbol: string;
  openingFloat?: number;
  onConfirm: (incoming: CashierProfile) => void;
  onQuickSwitch: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchHandoverSummary(openingFloat: number): Promise<HandoverSummary> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Today's cash sales
  const { data: salesData } = await supabase
    .from("orders")
    .select("total_amount, payment_method")
    .in("status", ["completed", "Completed"])
    .gte("created_at", todayStart.toISOString());

  let cashSales = 0;
  for (const row of salesData ?? []) {
    const method = (row.payment_method ?? "Cash").toLowerCase();
    const amount = Number(row.total_amount ?? 0);
    if (method === "cash") {
      cashSales += amount;
    } else if (method.includes("split")) {
      // Approximate: half of split goes to cash
      cashSales += amount / 2;
    }
  }

  // Today's petty cash outflows
  const { data: pettyCashData } = await supabase
    .from("petty_cash_logs")
    .select("amount, is_voided")
    .gte("created_at", todayStart.toISOString());

  const pettyCashOut = (pettyCashData ?? [])
    .filter((r: any) => !r.is_voided)
    .reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0);

  const expectedCash = Math.max(0, openingFloat + cashSales - pettyCashOut);

  return { openingFloat, cashSales, pettyCashOut, expectedCash };
}



// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DrawerHandoverModal({
  isOpen,
  outgoingCashier,
  currencySymbol,
  openingFloat = 0,
  onConfirm,
  onQuickSwitch,
  onClose,
}: DrawerHandoverModalProps) {
  const [summary, setSummary] = useState<HandoverSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState("");
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [incomingProfile, setIncomingProfile] = useState<CashierProfile | null>(null);

  const [verified, setVerified] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [handoverError, setHandoverError] = useState("");

  // Reset state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setPin("");
    setPinError("");
    setIncomingProfile(null);
    setVerified(false);
    setConfirming(false);
    setShowPin(false);
    setHandoverError("");

    setLoadingSummary(true);
    fetchHandoverSummary(openingFloat)
      .then(setSummary)
      .finally(() => setLoadingSummary(false));
  }, [isOpen, openingFloat]);

  // Keyboard: Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleVerifyPin = useCallback(async () => {
    if (!pin.trim() || verifyingPin) return;
    setVerifyingPin(true);
    setPinError("");
    try {
      console.log("[DrawerHandover] Entered PIN:", pin.trim());

      // Use the server action which runs with supabaseAdmin — bypasses RLS
      const result = await verifyStaffByPin(pin.trim());

      console.log("[DrawerHandover] verifyStaffByPin result:", result);

      if (!result.success || !result.name) {
        setPinError(result.error ?? "No active staff member found with that PIN.");
        return;
      }

      // Prevent same cashier switching to themselves
      if (
        result.username === outgoingCashier.username ||
        result.name === outgoingCashier.name
      ) {
        setPinError("Incoming cashier must be a different staff member.");
        return;
      }

      setIncomingProfile({
        name: result.name,
        username: result.username ?? result.name,
        role: result.role ?? "Staff",
      });
    } catch (err: any) {
      console.error("[DrawerHandover] Verification error:", err);
      setPinError(err.message ?? "Verification failed. Please try again.");
    } finally {
      setVerifyingPin(false);
    }
  }, [pin, verifyingPin, outgoingCashier]);

  const handleConfirm = async () => {
    if (!incomingProfile || !verified || !summary || confirming) return;
    setConfirming(true);
    setHandoverError("");
    try {
      const result = await recordCashierHandover(
        outgoingCashier.name,
        incomingProfile.name,
        summary.expectedCash,
        summary.openingFloat,
        summary.cashSales,
        summary.pettyCashOut,
      );
      if (!result.success) {
        console.error("[DrawerHandover] Failed to insert cashier_handover:", result.error);
        setHandoverError(result.error ?? "Failed to record handover. Please try again.");
        return;
      }
      onConfirm(incomingProfile);
    } catch (err: any) {
      console.error("[DrawerHandover] Unexpected handover error:", err);
      setHandoverError(err?.message ?? "Unexpected error during handover.");
    } finally {
      setConfirming(false);
    }
  };

  if (!isOpen) return null;

  const canConfirm = !!incomingProfile && verified && !confirming;

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 no-print animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
              <RefreshCw className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-black text-sm leading-tight">Cash Drawer Handover</h2>
              <p className="text-amber-100 text-[11px] font-semibold">Shift switch verification</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-black/15 hover:bg-black/25 text-white flex items-center justify-center transition-all cursor-pointer active:scale-90"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Outgoing Cashier */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-slate-50 border border-slate-200">
            <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Outgoing Cashier</p>
              <p className="text-sm font-black text-slate-800">{outgoingCashier.name}
                <span className="ml-1.5 text-[10px] font-semibold text-slate-400 capitalize">{outgoingCashier.role}</span>
              </p>
            </div>
          </div>

          {/* Cash Summary */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 overflow-hidden">
            <div className="px-4 py-2 border-b border-amber-200/70 flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">Expected Cash in Drawer</span>
            </div>
            {loadingSummary ? (
              <div className="px-4 py-4 flex items-center justify-center gap-2 text-amber-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-bold">Calculating…</span>
              </div>
            ) : summary ? (
              <div className="px-4 py-3 space-y-1.5">
                <div className="flex justify-between text-[11px] text-slate-600 font-semibold">
                  <span>Opening Float</span>
                  <span>{currencySymbol} {fmt(summary.openingFloat)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-emerald-700 font-semibold">
                  <span>+ Cash Sales (today)</span>
                  <span>{currencySymbol} {fmt(summary.cashSales)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-rose-600 font-semibold">
                  <span>− Petty Cash Outflows</span>
                  <span>{currencySymbol} {fmt(summary.pettyCashOut)}</span>
                </div>
                <div className="flex justify-between text-sm font-black text-amber-800 pt-1.5 border-t border-amber-200">
                  <span>Expected in Drawer</span>
                  <span>{currencySymbol} {fmt(summary.expectedCash)}</span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Incoming Cashier PIN */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider">
              Incoming Cashier — Enter PIN
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => { setPin(e.target.value); setPinError(""); setIncomingProfile(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleVerifyPin(); } }}
                  placeholder="Staff PIN"
                  className={`w-full pl-4 pr-10 py-2.5 rounded-xl border text-sm font-bold outline-none transition-all ${
                    pinError
                      ? "border-rose-300 bg-rose-50 text-rose-700 focus:ring-2 focus:ring-rose-200"
                      : incomingProfile
                        ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-slate-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPin((v) => !v)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleVerifyPin}
                disabled={!pin.trim() || verifyingPin}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-black disabled:opacity-40 transition-all active:scale-95 cursor-pointer shrink-0 flex items-center gap-1.5"
              >
                {verifyingPin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Verify"}
              </button>
            </div>

            {/* PIN Error */}
            {pinError && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-600 animate-in fade-in duration-150">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {pinError}
              </div>
            )}

            {/* Incoming Cashier Resolved */}
            {incomingProfile && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 animate-in fade-in duration-150">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Incoming Cashier</p>
                  <p className="text-sm font-black text-emerald-800">
                    {incomingProfile.name}
                    <span className="ml-1.5 text-[10px] font-semibold capitalize text-emerald-600">{incomingProfile.role}</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Verification Checkbox */}
          {incomingProfile && (
            <label className="flex items-start gap-3 cursor-pointer select-none animate-in fade-in duration-150">
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
                className="mt-0.5 w-5 h-5 cursor-pointer accent-orange-500 rounded shrink-0"
              />
              <span className="text-[12px] font-semibold text-slate-600 leading-snug">
                I, <span className="font-black text-slate-800">{incomingProfile.name}</span>, have physically counted and verified the cash in the drawer.
              </span>
            </label>
          )}

          {/* Handover Error */}
          {handoverError && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-600 animate-in fade-in duration-150">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {handoverError}
            </div>
          )}

          {/* Confirm & Switch */}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black text-sm transition-all active:scale-[0.98] disabled:opacity-40 cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25"
          >
            {confirming
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Switching…</>
              : <><ArrowRight className="w-4 h-4" /> Confirm &amp; Switch Cashier</>
            }
          </button>

          {/* Quick Switch fallback */}
          <div className="text-center">
            <button
              type="button"
              onClick={onQuickSwitch}
              className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer border-none bg-transparent underline underline-offset-2"
            >
              Skip verification / Quick Switch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
