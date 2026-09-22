"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useSettings } from "@/context/SettingsContext";

import { TrendingUp, CreditCard, CheckCircle, Receipt, ArrowUpRight, Clock, Coffee, PieChart, ShoppingBag, X, Search, Eye, Printer, Flame, Utensils, Moon, Lock, ShieldAlert, AlertTriangle } from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { verifyManagerPinAndVoid } from "@/app/actions/manager";

type OrderItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

type OrderType = "dine-in" | "takeaway" | "delivery";

interface PettyCashLog {
  id: string;
  amount: number;
  reason: string;
  staff_name?: string;
  authorized_by?: string;
  created_at: string;
  is_voided?: boolean;
  voided_by?: string;
  void_reason?: string;
  voided_at?: string;
  returned_change?: number;
}

interface DrawerReconciliation {
  id: string;
  shift_date: string;
  opening_float: number;
  cash_revenue: number;
  petty_cash_total: number;
  expected_cash: number;
  actual_cash_counted: number;
  cash_variance: number;
  card_revenue: number;
  total_revenue: number;
  denominations?: Record<string, number>;
}

interface CashierHandover {
  id: string;
  handover_at: string;
  outgoing_cashier: string;
  incoming_cashier: string;
  expected_cash: number;
}

type Order = {
  id: string;
  created_at: string;
  table_no: string;
  items: OrderItem[];
  total_amount: number;
  status: string;
  order_type?: OrderType;
  customer_name?: string;
  payment_method?: string;
};

function isSameLocalDate(dateA: Date, dateB: Date): boolean {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function parseLocalISODate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getTodayLocalDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const AnimatedGauge = ({ percentage, label, icon, revenue, colorClass, bgClass, shadowColor, currency }: { percentage: number, label: string, icon: string, revenue: number, colorClass: string, bgClass: string, shadowColor: string, currency: string }) => {
  const [fill, setFill] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFill(percentage);
    }, 150);

    if (percentage > 0) {
      const duration = 1400;
      const steps = 60;
      const stepTime = Math.abs(Math.floor(duration / steps));
      let currentStep = 0;
      const interval = setInterval(() => {
        currentStep++;
        if (currentStep <= steps) {
          setCount(Math.round((percentage / steps) * currentStep));
        } else {
          setCount(percentage);
          clearInterval(interval);
        }
      }, stepTime);
      return () => {
        clearTimeout(timer);
        clearInterval(interval);
      };
    } else {
      setCount(0);
      return () => clearTimeout(timer);
    }
  }, [percentage]);

  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (fill / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="36" fill="transparent" strokeWidth="8" className={bgClass} />
          <circle cx="48" cy="48" r="36" fill="transparent" strokeWidth="8" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className={colorClass} style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.4, 0, 0.2, 1)', filter: `drop-shadow(0 2px 6px ${shadowColor})` }} />
        </svg>
        <span className="absolute text-sm sm:text-base font-extrabold text-slate-800">{count}%</span>
      </div>
      <div className="mt-3 text-center">
        <p className="text-xs font-semibold text-slate-600">{icon} {label}</p>
        <p className="text-xs font-bold text-slate-900 mt-0.5">{currency}{revenue.toLocaleString()}</p>
      </div>
    </div>
  );
};

export default function AnalyticsPage() {
  const { settings } = useSettings();
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [timeFilter, setTimeFilter] = useState<"Today" | "Week" | "Month" | "Year" | "Custom">("Today");
  const [customDate, setCustomDate] = useState<string>(getTodayLocalDateString());
  const [isLoading, setIsLoading] = useState(true);

  // Manager Access Security for Date Range
  const [isManagerUnlocked, setIsManagerUnlocked] = useState(false);
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [pendingRange, setPendingRange] = useState<"Week" | "Month" | "Year" | "Custom" | null>(null);
  const [managerPinInput, setManagerPinInput] = useState("");
  const [managerPinError, setManagerPinError] = useState("");
  const [isCheckingPin, setIsCheckingPin] = useState(false);
  const [failedPinAttempts, setFailedPinAttempts] = useState(0);
  const [lockoutSecs, setLockoutSecs] = useState(0);

  // Lockout check
  useEffect(() => {
    const checkLock = () => {
      const lockedUntil = localStorage.getItem("analytics_manager_locked_until");
      if (lockedUntil) {
        const remaining = Math.ceil((parseInt(lockedUntil, 10) - Date.now()) / 1000);
        if (remaining > 0) {
          setLockoutSecs(remaining);
        } else {
          localStorage.removeItem("analytics_manager_locked_until");
          setLockoutSecs(0);
          setFailedPinAttempts(0);
        }
      }
    };
    checkLock();
    const t = setInterval(checkLock, 1000);
    return () => clearInterval(t);
  }, []);

  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionDateFilter, setTransactionDateFilter] = useState<"Today" | "Yesterday" | "Last 7 Days" | "Custom Date">("Today");
  const [customDateRange, setCustomDateRange] = useState({ start: "", end: "" });
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [openingFloat, setOpeningFloat] = useState<number>(0);
  const [pettyCashLogs, setPettyCashLogs] = useState<PettyCashLog[]>([]);
  const [denom, setDenom] = useState<{
    d5000: number;
    d1000: number;
    d500: number;
    d100: number;
    d50: number;
    d20: number;
    coins: number;
  }>({
    d5000: 0,
    d1000: 0,
    d500: 0,
    d100: 0,
    d50: 0,
    d20: 0,
    coins: 0,
  });

  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidTargetId, setVoidTargetId] = useState<string | null>(null);
  const [voidForm, setVoidForm] = useState({ managerPin: "", reason: "" });
  const [voidError, setVoidError] = useState("");
  const [shakePin, setShakePin] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnTargetId, setReturnTargetId] = useState<string | null>(null);
  const [returnForm, setReturnForm] = useState({ returnedChange: "", reason: "" });
  const [returnError, setReturnError] = useState("");
  const [shakeReturn, setShakeReturn] = useState(false);

  const [toastMessage, setToastMessage] = useState({ text: "", type: "success" });
  const [isMounted, setIsMounted] = useState(false);
  const [isSubmittingShift, setIsSubmittingShift] = useState(false);
  const [pastReconciliations, setPastReconciliations] = useState<DrawerReconciliation[]>([]);
  const [handovers, setHandovers] = useState<CashierHandover[]>([]);
  const [showShiftSuccess, setShowShiftSuccess] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isAnyModalOpen = Boolean(viewingOrder || voidModalOpen || returnModalOpen || showShiftSuccess || showManagerPinModal);
  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isAnyModalOpen]);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage({ text: "", type: "success" }), 3000);
  };

  const channelRefs = useRef<ReturnType<typeof supabase.channel>[]>([]);

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);

    const { data } = await supabase
      .from("orders")
      .select("*")
      .in("status", ["completed", "Completed"])
      .order("created_at", { ascending: false })
      .limit(1500);

    if (data) {
      setAllOrders(data as Order[]);
    }

    const { data: pettyData } = await supabase
      .from("petty_cash_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (pettyData) setPettyCashLogs(pettyData);

    setIsLoading(false);
  }, []);

  const fetchReconciliations = useCallback(async () => {
    const { data } = await supabase
      .from("drawer_reconciliations")
      .select("*")
      .order("shift_date", { ascending: false })
      .limit(200);
    if (data) setPastReconciliations(data as DrawerReconciliation[]);
  }, []);

  const fetchHandovers = useCallback(async () => {
    const { data } = await supabase
      .from("cashier_handovers")
      .select("*")
      .order("handover_at", { ascending: false })
      .limit(200);
    if (data) setHandovers(data as CashierHandover[]);
  }, []);

  useEffect(() => {
    fetchReconciliations();
    fetchHandovers();
  }, [fetchReconciliations, fetchHandovers]);

  useEffect(() => {
    fetchAnalytics();

    channelRefs.current.forEach((ch) => supabase.removeChannel(ch));
    channelRefs.current = [];

    const ordersChannel = supabase
      .channel(`rt_orders_${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        fetchAnalytics();
      })
      .subscribe();

    const pettyChannel = supabase
      .channel(`rt_petty_${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "petty_cash_logs" }, () => {
        fetchAnalytics();
      })
      .subscribe();

    const drawerChannel = supabase
      .channel(`rt_drawer_${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawer_reconciliations" }, () => {
        fetchReconciliations();
      })
      .subscribe();

    const handoverChannel = supabase
      .channel(`rt_handover_${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cashier_handovers" }, () => {
        fetchHandovers();
      })
      .subscribe();

    channelRefs.current = [ordersChannel, pettyChannel, drawerChannel, handoverChannel];

    return () => {
      channelRefs.current.forEach((ch) => supabase.removeChannel(ch));
      channelRefs.current = [];
    };
  }, [fetchAnalytics, fetchReconciliations, fetchHandovers]);

  useEffect(() => {
    if (printOrder) {
      const handleAfterPrint = () => {
        setPrintOrder(null);
      };
      window.addEventListener("afterprint", handleAfterPrint);
      const timer = setTimeout(() => {
        window.print();
      }, 300);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("afterprint", handleAfterPrint);
      };
    }
  }, [printOrder]);

  // Handle Date Filter Selection with Manager Access Check
  const handleRangeTabClick = (range: "Today" | "Week" | "Month" | "Year" | "Custom") => {
    if (range === "Today") {
      setTimeFilter("Today");
      return;
    }

    if (isManagerUnlocked) {
      setTimeFilter(range);
      return;
    }

    setPendingRange(range);
    setManagerPinInput("");
    setManagerPinError("");
    setShowManagerPinModal(true);
  };

  // Strictly verify against restaurant_settings.admin_pin with ZERO hardcoding
  const handleVerifyManagerPin = async () => {
    if (!managerPinInput || !pendingRange || lockoutSecs > 0) return;
    setIsCheckingPin(true);
    setManagerPinError("");

    try {
      const { data, error } = await supabase
        .from("restaurant_settings")
        .select("admin_pin")
        .single();

      if (error || !data) {
        setManagerPinError("Database verification failed. Please try again.");
        setIsCheckingPin(false);
        return;
      }

      const dbAdminPin = data.admin_pin ? String(data.admin_pin).trim() : null;
      const enteredPin = managerPinInput.trim();

      if (!dbAdminPin || enteredPin !== dbAdminPin) {
        const nextAttempts = failedPinAttempts + 1;
        setFailedPinAttempts(nextAttempts);

        if (nextAttempts >= 3) {
          const lockTime = Date.now() + 120000;
          localStorage.setItem("analytics_manager_locked_until", lockTime.toString());
          setLockoutSecs(120);
          setManagerPinError("Too many incorrect attempts! Locked for 2 minutes.");
        } else {
          setManagerPinError(`Incorrect Manager PIN! Attempt ${nextAttempts} of 3.`);
        }

        setManagerPinInput("");
        setIsCheckingPin(false);
        return;
      }

      // Success
      setFailedPinAttempts(0);
      localStorage.removeItem("analytics_manager_locked_until");
      setIsManagerUnlocked(true);
      setTimeFilter(pendingRange);
      setShowManagerPinModal(false);
      setManagerPinInput("");
      setPendingRange(null);
      showToast("Manager access granted.", "success");
    } catch (err: any) {
      setManagerPinError("Verification error: " + (err.message || "Unknown error"));
    } finally {
      setIsCheckingPin(false);
    }
  };

  const orders = useMemo(() => {
    const now = new Date();
    return allOrders.filter(order => {
      const orderDate = new Date(order.created_at);
      if (timeFilter === "Today") {
        return isSameLocalDate(orderDate, now);
      }
      if (timeFilter === "Week") {
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        return orderDate >= weekAgo;
      }
      if (timeFilter === "Month") {
        return orderDate.getMonth() === now.getMonth() && orderDate.getFullYear() === now.getFullYear();
      }
      if (timeFilter === "Year") {
        return orderDate.getFullYear() === now.getFullYear();
      }
      if (timeFilter === "Custom" && customDate) {
        const targetDate = parseLocalISODate(customDate);
        return isSameLocalDate(orderDate, targetDate);
      }
      return true;
    });
  }, [allOrders, timeFilter, customDate]);

  const filteredReconciliations = useMemo(() => {
    const now = new Date();
    return pastReconciliations.filter((rec) => {
      const recDate = new Date(rec.shift_date);
      if (timeFilter === "Today") return isSameLocalDate(recDate, now);
      if (timeFilter === "Week") {
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        return recDate >= weekAgo;
      }
      if (timeFilter === "Month") {
        return recDate.getMonth() === now.getMonth() && recDate.getFullYear() === now.getFullYear();
      }
      if (timeFilter === "Year") return recDate.getFullYear() === now.getFullYear();
      if (timeFilter === "Custom" && customDate) {
        const targetDate = parseLocalISODate(customDate);
        return isSameLocalDate(recDate, targetDate);
      }
      return true;
    });
  }, [pastReconciliations, timeFilter, customDate]);

  const filteredHandovers = useMemo(() => {
    const now = new Date();
    return handovers.filter((ho) => {
      const hoDate = new Date(ho.handover_at);
      if (timeFilter === "Today") return isSameLocalDate(hoDate, now);
      if (timeFilter === "Week") {
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        return hoDate >= weekAgo;
      }
      if (timeFilter === "Month") {
        return hoDate.getMonth() === now.getMonth() && hoDate.getFullYear() === now.getFullYear();
      }
      if (timeFilter === "Year") return hoDate.getFullYear() === now.getFullYear();
      if (timeFilter === "Custom" && customDate) {
        const targetDate = parseLocalISODate(customDate);
        return isSameLocalDate(hoDate, targetDate);
      }
      return true;
    });
  }, [handovers, timeFilter, customDate]);

  const allFilteredPettyCash = useMemo(() => {
    const now = new Date();
    return pettyCashLogs.filter(log => {
      const logDate = new Date(log.created_at);
      if (timeFilter === "Today") return isSameLocalDate(logDate, now);
      if (timeFilter === "Week") {
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        return logDate >= weekAgo;
      }
      if (timeFilter === "Month") return logDate.getMonth() === now.getMonth() && logDate.getFullYear() === now.getFullYear();
      if (timeFilter === "Year") return logDate.getFullYear() === now.getFullYear();
      if (timeFilter === "Custom" && customDate) {
        const targetDate = parseLocalISODate(customDate);
        return isSameLocalDate(logDate, targetDate);
      }
      return true;
    });
  }, [pettyCashLogs, timeFilter, customDate]);

  const activePettyCash = allFilteredPettyCash.filter(log => !log.is_voided);
  const voidedPettyCash = allFilteredPettyCash.filter(log => log.is_voided);

  const { periodCashRevenue, periodCardRevenue, calculatedDiscounts } = useMemo(() => {
    let cRev = 0;
    let cdRev = 0;
    let disc = 0;

    orders.forEach(o => {
      if (o.payment_method === 'Cash') {
        cRev += Number(o.total_amount || 0);
      } else if (o.payment_method === 'Card') {
        cdRev += Number(o.total_amount || 0);
      } else if (o.payment_method?.startsWith('Split')) {
        const match = o.payment_method.match(/Cash:\s*([\d.]+),\s*Card:\s*([\d.]+)/);
        if (match) {
          cRev += Number(match[1]);
          cdRev += Number(match[2]);
        } else {
          cRev += Number(o.total_amount || 0);
        }
      } else {
        cRev += Number(o.total_amount || 0);
      }

      const subtotal = o.items?.reduce((s, item) => s + (item.price * item.quantity), 0) || 0;
      const serviceCharge = (o.order_type === 'takeaway' || o.order_type === 'delivery') ? 0 : subtotal * (settings.service_charge_pct / 100);
      const expectedTotal = subtotal + serviceCharge;
      const diff = expectedTotal - Number(o.total_amount || 0);
      if (diff > 1) disc += diff;
    });

    return { periodCashRevenue: cRev, periodCardRevenue: cdRev, calculatedDiscounts: disc };
  }, [orders, settings.service_charge_pct]);

  const autoPettyCashTotal = useMemo(() => {
    return activePettyCash.reduce(
      (sum, log) => sum + (Number(log.amount || 0) - Number(log.returned_change || 0)),
      0
    );
  }, [activePettyCash]);

  const cashRevenue = periodCashRevenue;
  const cardRevenue = periodCardRevenue;
  const discountsGiven = calculatedDiscounts;
  const totalRevenue = orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const settledCount = orders.length;
  const aov = settledCount > 0 ? totalRevenue / settledCount : 0;

  const expectedCashInDrawer = openingFloat + cashRevenue - autoPettyCashTotal;
  const actualCashCounted =
    (denom.d5000 * 5000) +
    (denom.d1000 * 1000) +
    (denom.d500 * 500) +
    (denom.d100 * 100) +
    (denom.d50 * 50) +
    (denom.d20 * 20) +
    denom.coins;
  const cashVariance = actualCashCounted - expectedCashInDrawer;

  const handleSubmitShift = async () => {
    if (isSubmittingShift) return;

    if (actualCashCounted <= 0) {
      showToast("⚠️ Please enter denomination counts before closing the shift.", "error");
      return;
    }
    if (totalRevenue <= 0 && actualCashCounted <= 0) {
      showToast("⚠️ No revenue or cash data found. Cannot close an empty shift.", "error");
      return;
    }

    setIsSubmittingShift(true);
    try {
      const payload = {
        opening_float: openingFloat,
        cash_revenue: cashRevenue,
        petty_cash_total: autoPettyCashTotal,
        expected_cash: expectedCashInDrawer,
        actual_cash_counted: actualCashCounted,
        cash_variance: cashVariance,
        card_revenue: cardRevenue,
        total_revenue: totalRevenue,
        denominations: denom,
        shift_date: new Date().toISOString(),
      };
      const { error } = await supabase.from("drawer_reconciliations").insert([payload]);
      if (error) throw error;

      setShowShiftSuccess(true);
      setTimeout(() => setShowShiftSuccess(false), 2500);

      fetchReconciliations();
    } catch (err: any) {
      showToast(`❌ Failed to save: ${err.message || "Unknown error"}`, "error");
    } finally {
      setIsSubmittingShift(false);
    }
  };

  const transactionOrders = useMemo(() => {
    let filtered = allOrders;
    const now = new Date();

    filtered = filtered.filter(order => {
      const orderDate = new Date(order.created_at);

      if (transactionDateFilter === "Today") {
        return isSameLocalDate(orderDate, now);
      }
      if (transactionDateFilter === "Yesterday") {
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        return isSameLocalDate(orderDate, yesterday);
      }
      if (transactionDateFilter === "Last 7 Days") {
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        return orderDate >= weekAgo;
      }
      if (transactionDateFilter === "Custom Date" && customDateRange.start && customDateRange.end) {
        const start = parseLocalISODate(customDateRange.start);
        const end = parseLocalISODate(customDateRange.end);
        end.setHours(23, 59, 59, 999);
        return orderDate >= start && orderDate <= end;
      }
      return true;
    });

    if (transactionSearch) {
      const q = transactionSearch.toLowerCase();
      filtered = filtered.filter(order =>
        order.id.toLowerCase().includes(q) ||
        (order.table_no && order.table_no.toLowerCase().includes(q)) ||
        (order.order_type && order.order_type.toLowerCase().includes(q)) ||
        (order.payment_method && order.payment_method.toLowerCase().includes(q)) ||
        (order.customer_name && order.customer_name.toLowerCase().includes(q))
      );
    }

    return filtered;
  }, [allOrders, transactionDateFilter, customDateRange, transactionSearch]);

  const dineInOrders = orders.filter(o => !o.order_type || o.order_type === 'dine-in');
  const takeawayOrders = orders.filter(o => o.order_type === 'takeaway');
  const deliveryOrders = orders.filter(o => o.order_type === 'delivery');

  const dineInRevenue = dineInOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const takeawayRevenue = takeawayOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const deliveryRevenue = deliveryOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

  const cashPercent = totalRevenue > 0 ? Math.round((periodCashRevenue / totalRevenue) * 100) : 0;
  const cardPercent = totalRevenue > 0 ? Math.round((periodCardRevenue / totalRevenue) * 100) : 0;

  const itemMap: Record<string, { name: string; qty: number; rev: number }> = {};
  orders.forEach(order => {
    order.items?.forEach(item => {
      if (!itemMap[item.id]) {
        itemMap[item.id] = { name: item.name, qty: 0, rev: 0 };
      }
      itemMap[item.id].qty += item.quantity;
      itemMap[item.id].rev += (item.quantity * item.price);
    });
  });
  const topItems = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 5);

  const hourlyData = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: i === 0 ? "12 AM" : i < 12 ? `${i} AM` : i === 12 ? "12 PM" : `${i - 12} PM`,
      timeRange: i === 0 ? "12:00 AM - 01:00 AM" : i < 11 ? `0${i}:00 AM - ${i + 1 < 10 ? `0${i + 1}` : i + 1}:00 AM` : i === 11 ? "11:00 AM - 12:00 PM" : i === 12 ? "12:00 PM - 01:00 PM" : i < 23 ? `0${i - 12}:00 PM - ${i - 11 < 10 ? `0${i - 11}` : i - 11}:00 PM` : "11:00 PM - 12:00 AM",
      totalRevenue: 0,
      orderCount: 0,
      averageOrderValue: 0
    }));

    let minHourWithSale = 24;
    let maxHourWithSale = -1;

    orders.forEach(order => {
      const orderHour = new Date(order.created_at).getHours();
      buckets[orderHour].totalRevenue += Number(order.total_amount || 0);
      buckets[orderHour].orderCount += 1;

      if (orderHour < minHourWithSale) minHourWithSale = orderHour;
      if (orderHour > maxHourWithSale) maxHourWithSale = orderHour;
    });

    buckets.forEach(b => {
      if (b.orderCount > 0) {
        b.averageOrderValue = b.totalRevenue / b.orderCount;
      }
    });

    if (maxHourWithSale === -1) {
      return buckets.slice(10, 22);
    }

    return buckets.slice(minHourWithSale, maxHourWithSale + 1);
  }, [orders]);

  const peakHour = useMemo(() => {
    if (hourlyData.length === 0) return null;
    return hourlyData.reduce((max, current) => current.totalRevenue > max.totalRevenue ? current : max, hourlyData[0]);
  }, [hourlyData]);

  const lunchRushTotal = useMemo(() => {
    return orders.reduce((sum, order) => {
      const h = new Date(order.created_at).getHours();
      return (h >= 12 && h < 15) ? sum + Number(order.total_amount || 0) : sum;
    }, 0);
  }, [orders]);

  const dinnerRushTotal = useMemo(() => {
    return orders.reduce((sum, order) => {
      const h = new Date(order.created_at).getHours();
      return (h >= 19 && h < 22) ? sum + Number(order.total_amount || 0) : sum;
    }, 0);
  }, [orders]);

  if (isLoading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center font-bold">Loading Analytics...</div>;

  return (
    <ProtectedRoute>
      <style>{`
        @keyframes custom-shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .animate-shake-custom {
          animation: custom-shake 0.4s ease-in-out;
        }
      `}</style>

      <div className="flex-1 flex flex-col font-sans bg-slate-50 text-slate-900 pt-[72px] no-print">
        <Navbar />

        {toastMessage.text && (
          <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[110] animate-in fade-in slide-in-from-top-4 flex items-center gap-2 px-6 py-3 rounded-full shadow-2xl font-bold text-sm bg-slate-900 text-white pointer-events-none">
            {toastMessage.type === "success" ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <X className="w-4 h-4 text-rose-400" />}
            {toastMessage.text}
          </div>
        )}

        {/* Manager PIN Authorization Modal for Historical Analytics */}
        {showManagerPinModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 max-w-xs w-full animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-900 font-black text-sm">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center border ${lockoutSecs > 0
                      ? "bg-rose-500 text-white border-rose-600 animate-pulse"
                      : "bg-orange-50 text-orange-600 border-orange-100"
                    }`}>
                    {lockoutSecs > 0 ? <ShieldAlert className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  </div>
                  <span>Manager Access</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowManagerPinModal(false);
                    setPendingRange(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-500 mb-3">
                Manager PIN required to access historical data ({pendingRange === "Year" ? "This Year" : pendingRange}).
              </p>

              {lockoutSecs > 0 ? (
                <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 text-center my-2 animate-in fade-in">
                  <AlertTriangle className="w-6 h-6 text-rose-500 mx-auto mb-1.5" />
                  <p className="text-xs font-black text-rose-800 uppercase tracking-wider">Access Locked</p>
                  <p className="text-xl font-black font-mono text-rose-600 mt-1">
                    0{Math.floor(lockoutSecs / 60)}:{(lockoutSecs % 60).toString().padStart(2, "0")}
                  </p>
                  <p className="text-[11px] font-bold text-rose-600 mt-1">Please wait for cooldown.</p>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleVerifyManagerPin();
                  }}
                >
                  <input
                    type="password"
                    autoFocus
                    maxLength={6}
                    placeholder="••••"
                    value={managerPinInput}
                    onChange={(e) => setManagerPinInput(e.target.value)}
                    className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl py-3 px-4 text-center tracking-[0.4em] text-2xl font-black text-slate-900 outline-none focus:border-orange-500 focus:bg-white transition-all mb-2"
                  />

                  {managerPinError && (
                    <p className="text-rose-500 text-xs font-bold text-center mb-3">
                      {managerPinError}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowManagerPinModal(false);
                        setPendingRange(null);
                      }}
                      className="py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isCheckingPin || !managerPinInput}
                      className="py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs transition-all shadow-md shadow-orange-500/20 disabled:opacity-50 cursor-pointer"
                    >
                      {isCheckingPin ? "Verifying..." : "Unlock"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {showShiftSuccess && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="flex flex-col items-center justify-center bg-white rounded-[2.5rem] shadow-2xl px-8 sm:px-12 py-10 gap-5 animate-in zoom-in-90 duration-300 overflow-hidden mx-4">
              <div className="relative flex items-center justify-center w-32 h-32 overflow-hidden">
                <div className="absolute w-28 h-28 rounded-full bg-emerald-100 animate-ping opacity-40" />
                <div className="w-24 h-24 rounded-full bg-emerald-500 flex items-center justify-center shadow-xl shadow-emerald-500/40 relative">
                  <svg className="w-12 h-12 text-white" viewBox="0 52 52" fill="none">
                    <style>{`
                      @keyframes draw-check {
                        to { stroke-dashoffset: 0; }
                      }
                      .check-path {
                        stroke-dasharray: 60;
                        stroke-dashoffset: 60;
                        animation: draw-check 0.5s ease-out 0.1s forwards;
                      }
                    `}</style>
                    <path
                      className="check-path"
                      d="M14 27l9 9 16-18"
                      stroke="white"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Shift Successfully Closed!</h2>
                <p className="text-sm text-slate-500 font-medium mt-1">Reconciliation saved &amp; recorded securely.</p>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-emerald-400" style={{ animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-6 overflow-x-hidden pb-20">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-6">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight">Analytics Dashboard</h1>
              <p className="text-slate-500 text-sm mt-1.5 tracking-wide font-medium">Live overview of your restaurant&apos;s performance</p>
            </div>

            {/* Filter Pills with Manager Lock indicators */}
            <div className="flex bg-white rounded-2xl p-1.5 shadow-sm border border-slate-200 overflow-x-auto no-scrollbar w-full sm:w-auto items-center">
              {(["Today", "Week", "Month", "Year", "Custom"] as const).map((tf) => {
                const isLocked = tf !== "Today" && !isManagerUnlocked;
                return (
                  <button
                    key={tf}
                    onClick={() => handleRangeTabClick(tf)}
                    className={`flex-1 sm:flex-none text-center px-3 sm:px-5 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all whitespace-nowrap tracking-wide flex items-center justify-center gap-1.5 cursor-pointer ${timeFilter === tf
                        ? "bg-slate-900 text-white shadow-md"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                      }`}
                  >
                    <span>{tf === "Year" ? "This Year" : tf}</span>
                    {isLocked && <Lock className="w-3 h-3 opacity-40" />}
                  </button>
                );
              })}
              {timeFilter === "Custom" && (
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="ml-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-700 outline-none"
                />
              )}
            </div>
          </div>

          <div className="space-y-8">
            {/* Cash Drawer Summary */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 no-print">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <span className="text-2xl">💵</span> Cash Drawer Summary
                </h2>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
                  <div className="flex items-center justify-between sm:justify-start gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 flex-1 sm:flex-initial">
                    <span className="text-sm font-bold text-slate-500 whitespace-nowrap">Opening Float:</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={openingFloat === 0 ? '' : openingFloat}
                        onChange={(e) => setOpeningFloat(Number(e.target.value) || 0)}
                        placeholder="e.g. 5000"
                        className="w-24 bg-transparent font-bold text-slate-900 focus:outline-none text-right"
                      />
                      <span className="text-sm font-bold text-slate-900">{settings.currency}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setPrintOrder(null);
                      setTimeout(() => window.print(), 50);
                    }}
                    className="bg-indigo-500 hover:bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md shadow-indigo-500/20 transition-all active:scale-95 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Receipt className="w-5 h-5" /> Print Z-Report
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex flex-col justify-center">
                  <p className="text-emerald-700 text-xs font-bold uppercase tracking-widest mb-1">Expected Cash</p>
                  <p className="text-2xl font-bold text-emerald-900">{settings.currency}{expectedCashInDrawer.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col justify-center">
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Cash Sales</p>
                  <p className="text-2xl font-bold text-slate-900">{settings.currency}{cashRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl flex flex-col justify-center">
                  <p className="text-indigo-700 text-xs font-bold uppercase tracking-widest mb-1">Card Settlements</p>
                  <p className="text-2xl font-bold text-indigo-900">{settings.currency}{cardRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-orange-50 border border-orange-100 p-4 rounded-2xl flex flex-col justify-center">
                  <p className="text-orange-700 text-xs font-bold uppercase tracking-widest mb-1">Discounts Given</p>
                  <p className="text-2xl font-bold text-orange-900">{settings.currency}{Math.round(discountsGiven).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
              </div>

              {/* Denominations & Reconciliation */}
              <div className="mt-8 border-t border-slate-100 pt-8 flex flex-col lg:flex-row gap-6">
                <div className="flex-1">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><CreditCard className="w-4 h-4" /> Counted Cash Denominations</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: `${settings.currency} 5000`, key: 'd5000' },
                      { label: `${settings.currency} 1000`, key: 'd1000' },
                      { label: `${settings.currency} 500`, key: 'd500' },
                      { label: `${settings.currency} 100`, key: 'd100' },
                      { label: `${settings.currency} 50`, key: 'd50' },
                      { label: `${settings.currency} 20`, key: 'd20' }
                    ].map(d => (
                      <div key={d.key} className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200">
                        <span className="font-bold text-xs sm:text-sm text-slate-600">{d.label}</span>
                        <input
                          type="number" min="0"
                          value={denom[d.key as keyof typeof denom] || ''}
                          onChange={(e) => setDenom(prev => ({ ...prev, [d.key]: Number(e.target.value) || 0 }))}
                          className="w-14 sm:w-16 bg-white border border-slate-200 rounded-lg p-1 text-center font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    ))}
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200 col-span-2 sm:col-span-1">
                      <span className="font-bold text-xs sm:text-sm text-slate-600">Coins / Change</span>
                      <input
                        type="number" min="0"
                        value={denom.coins || ''}
                        onChange={(e) => setDenom(prev => ({ ...prev, coins: Number(e.target.value) || 0 }))}
                        className="w-20 sm:w-16 bg-white border border-slate-200 rounded-lg p-1 text-right sm:text-center font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Shift Reconciliation</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-red-50 text-red-900 rounded-xl border border-red-100">
                        <span className="font-bold text-sm">Petty Cash / Expenses</span>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-bold text-red-700">{settings.currency} {autoPettyCashTotal.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <span className="font-bold text-sm text-slate-600">Expected in Drawer</span>
                        <span className="font-bold text-slate-900 text-lg">{settings.currency} {expectedCashInDrawer.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-xl border border-indigo-200 shadow-inner">
                        <span className="font-bold text-sm text-indigo-700">Actual Cash Counted</span>
                        <span className="font-bold text-indigo-900 text-lg">{settings.currency} {actualCashCounted.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-200">
                    {cashVariance === 0 ? (
                      <div className="bg-emerald-100 text-emerald-800 p-4 rounded-xl flex items-center justify-center gap-2 font-bold text-base sm:text-lg shadow-sm border border-emerald-200">
                        ✅ Drawer Balanced
                      </div>
                    ) : cashVariance < 0 ? (
                      <div className="bg-rose-100 text-rose-800 p-4 rounded-xl flex items-center justify-center gap-2 font-bold text-base sm:text-lg shadow-sm border border-rose-200">
                        ⚠️ Shortage of {settings.currency} {Math.abs(cashVariance).toLocaleString()}
                      </div>
                    ) : (
                      <div className="bg-amber-100 text-amber-800 p-4 rounded-xl flex items-center justify-center gap-2 font-bold text-base sm:text-lg shadow-sm border border-amber-200">
                        ➕ Excess Cash of {settings.currency} {cashVariance.toLocaleString()}
                      </div>
                    )}

                    <button
                      onClick={handleSubmitShift}
                      disabled={isSubmittingShift}
                      className="mt-4 w-full py-3.5 bg-slate-900 hover:bg-slate-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 tracking-wide text-sm sm:text-base cursor-pointer"
                    >
                      {isSubmittingShift ? (
                        <>
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                          Saving...
                        </>
                      ) : (
                        <>🔒 Submit &amp; Close Shift</>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Petty Cash Outflows Table */}
              <div className="mt-8 border-t border-slate-100 pt-8">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-red-500" /> Cash Outflows</h3>
                <div className="w-full overflow-x-auto no-scrollbar">
                  <div className="min-w-[600px] rounded-xl border border-slate-100 bg-white">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-400 font-bold tracking-widest text-[10px] uppercase border-b border-slate-100">
                        <tr>
                          <th className="px-4 py-3">Time</th>
                          <th className="px-4 py-3">Reason</th>
                          <th className="px-4 py-3">Taken By</th>
                          <th className="px-4 py-3 text-right">Amount (Net)</th>
                          <th className="px-4 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activePettyCash.length > 0 ? (
                          activePettyCash.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 whitespace-nowrap text-slate-500">{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                              <td className="px-4 py-3 font-bold text-slate-700">{log.reason}</td>
                              <td className="px-4 py-3 text-slate-600">{log.staff_name || log.authorized_by || "Staff"}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex flex-col items-end">
                                  <span className="font-bold text-red-600">{settings.currency}{(log.amount - (log.returned_change || 0)).toLocaleString()}</span>
                                  {(log.returned_change || 0) > 0 && (
                                    <span className="text-[10px] font-medium text-slate-500">
                                      Init: {log.amount.toLocaleString()} | Ret: {(log.returned_change || 0).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 flex items-center justify-center gap-2">
                                <button
                                  onClick={() => {
                                    setReturnTargetId(log.id);
                                    setReturnForm({ returnedChange: "", reason: "" });
                                    setReturnError("");
                                    setReturnModalOpen(true);
                                  }}
                                  className="text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  🔄 Return
                                </button>
                                <button
                                  onClick={() => {
                                    setVoidTargetId(log.id);
                                    setVoidModalOpen(true);
                                  }}
                                  className="text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg font-bold text-xs transition-colors cursor-pointer"
                                >
                                  Void
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-slate-400 tracking-widest uppercase text-xs font-bold">
                              No cash outflows recorded
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Voided Expenses Audit Log */}
              {voidedPettyCash.length > 0 && (
                <div className="mt-8 border-t border-slate-100 pt-8">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-slate-400">🛡️ Audit Logs: Voided Expenses</h3>
                  <div className="w-full overflow-x-auto no-scrollbar opacity-80">
                    <div className="min-w-[600px] rounded-xl border border-slate-100 bg-white">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-400 font-bold tracking-widest text-[10px] uppercase border-b border-slate-100">
                          <tr>
                            <th className="px-4 py-3">Time Voided</th>
                            <th className="px-4 py-3">Original Reason</th>
                            <th className="px-4 py-3">Void Reason</th>
                            <th className="px-4 py-3 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {voidedPettyCash.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50 line-through text-slate-400">
                              <td className="px-4 py-3 whitespace-nowrap">{new Date(log.voided_at || log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                              <td className="px-4 py-3">{log.reason}</td>
                              <td className="px-4 py-3 text-rose-500 no-underline font-medium">{log.void_reason} (by {log.voided_by || 'Manager'})</td>
                              <td className="px-4 py-3 text-right font-bold">{settings.currency}{log.amount.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Past Shift Closing History */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-4 sm:p-8 mt-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-bold text-slate-800 text-base sm:text-lg flex items-center gap-2">
                  🕒 Past Shift Closing History
                </h2>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  {timeFilter === "Custom" && customDate
                    ? parseLocalISODate(customDate).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })
                    : timeFilter === "Year" ? "This Year" : timeFilter}
                </span>
              </div>
              {filteredReconciliations.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm font-bold uppercase tracking-widest">
                  No shift records found for this period.
                </div>
              ) : (
                <div className="w-full overflow-x-auto no-scrollbar">
                  <div className="min-w-[700px] rounded-xl border border-slate-100">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-400 font-bold tracking-widest text-[10px] uppercase border-b border-slate-100">
                        <tr>
                          <th className="px-4 py-3">Shift Date &amp; Time</th>
                          <th className="px-4 py-3 text-right">Total Revenue</th>
                          <th className="px-4 py-3 text-right">Expected Cash</th>
                          <th className="px-4 py-3 text-right">Actual Counted</th>
                          <th className="px-4 py-3 text-right">Card</th>
                          <th className="px-4 py-3 text-center">Variance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredReconciliations.map((rec) => (
                          <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap font-bold text-slate-700">
                              {new Date(rec.shift_date).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}
                              <span className="ml-2 text-slate-400 font-medium text-xs">
                                {new Date(rec.shift_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900">{settings.currency}{rec.total_revenue.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right text-slate-600 font-medium">{settings.currency}{rec.expected_cash.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right text-indigo-700 font-bold">{settings.currency}{rec.actual_cash_counted.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right text-slate-600 font-medium">{settings.currency}{rec.card_revenue.toLocaleString()}</td>
                            <td className="px-4 py-3 text-center">
                              {rec.cash_variance === 0 ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 font-bold text-xs">✅ Balanced</span>
                              ) : rec.cash_variance < 0 ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-rose-100 text-rose-700 font-bold text-xs">⚠️ -{settings.currency}{Math.abs(rec.cash_variance).toLocaleString()}</span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 font-bold text-xs">➕ +{settings.currency}{rec.cash_variance.toLocaleString()}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Cashier Handover History */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-4 sm:p-8 mt-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-bold text-slate-800 text-base sm:text-lg flex items-center gap-2">
                  🔄 Cashier Handover History
                </h2>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  {timeFilter === "Custom" && customDate
                    ? parseLocalISODate(customDate).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })
                    : timeFilter === "Year" ? "This Year" : timeFilter}
                </span>
              </div>
              {filteredHandovers.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm font-bold uppercase tracking-widest">
                  No handovers found for this period.
                </div>
              ) : (
                <div className="w-full overflow-x-auto no-scrollbar">
                  <div className="min-w-[600px] rounded-xl border border-slate-100">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-400 font-bold tracking-widest text-[10px] uppercase border-b border-slate-100">
                        <tr>
                          <th className="px-4 py-3">Time</th>
                          <th className="px-4 py-3">Outgoing Cashier</th>
                          <th className="px-4 py-3">Incoming Cashier</th>
                          <th className="px-4 py-3 text-right">Expected Cash Verified</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredHandovers.map((ho) => (
                          <tr key={ho.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap font-bold text-slate-700">
                              {new Date(ho.handover_at).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}
                              <span className="ml-2 text-slate-400 font-medium text-xs">
                                {new Date(ho.handover_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-600 font-medium">{ho.outgoing_cashier}</td>
                            <td className="px-4 py-3 font-bold text-slate-900">{ho.incoming_cashier}</td>
                            <td className="px-4 py-3 text-right font-bold text-indigo-700">{settings.currency}{Number(ho.expected_cash || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* 4 Metric Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between group hover:shadow-lg transition-shadow">
                <div className="flex justify-between items-start mb-6">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30">
                    <TrendingUp className="w-6 h-6 sm:w-7 sm:h-7" />
                  </div>
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-100 tracking-wider">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    {totalRevenue > 0 ? '+100%' : '0%'}
                  </span>
                </div>
                <div>
                  <p className="text-slate-500 text-xs sm:text-sm font-bold mb-1 tracking-wide">Total Revenue</p>
                  <h3 className="text-2xl sm:text-4xl font-bold text-slate-900 tracking-tight">{settings.currency}{totalRevenue.toLocaleString()}</h3>
                </div>
              </div>

              <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between group hover:shadow-lg transition-shadow">
                <div className="flex justify-between items-start mb-6">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
                    <CheckCircle className="w-6 h-6 sm:w-7 sm:h-7" />
                  </div>
                </div>
                <div>
                  <p className="text-slate-500 text-xs sm:text-sm font-bold mb-1 tracking-wide">Settled Orders</p>
                  <h3 className="text-2xl sm:text-4xl font-bold text-slate-900 tracking-tight">{settledCount}</h3>
                </div>
              </div>

              <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between group hover:shadow-lg transition-shadow">
                <div className="flex justify-between items-start mb-6">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/30">
                    <Receipt className="w-6 h-6 sm:w-7 sm:h-7" />
                  </div>
                </div>
                <div>
                  <p className="text-slate-500 text-xs sm:text-sm font-bold mb-1 tracking-wide">Average Order Value</p>
                  <h3 className="text-2xl sm:text-4xl font-bold text-slate-900 tracking-tight">{settings.currency}{Math.round(aov).toLocaleString()}</h3>
                </div>
              </div>

              <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between group hover:shadow-lg transition-shadow">
                <div className="flex justify-between items-start mb-6">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white shadow-lg shadow-orange-500/30">
                    <CreditCard className="w-6 h-6 sm:w-7 sm:h-7" />
                  </div>
                </div>
                <div>
                  <p className="text-slate-500 text-xs sm:text-sm font-bold mb-1 tracking-wide">Sales Split (Cash / Card)</p>
                  <div className="flex items-end gap-2">
                    <h3 className="text-2xl sm:text-4xl font-bold text-slate-900 tracking-tight">{cashPercent}<span className="text-base sm:text-xl text-slate-400 font-bold">%</span></h3>
                    <span className="text-xs sm:text-sm font-bold text-slate-400 mb-1 sm:mb-1.5">/ {cardPercent}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Charts & Breakdown Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Order Type Breakdown */}
              <div className="lg:col-span-2 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2 tracking-wide text-lg sm:text-xl">
                    <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" /> Revenue by Order Type
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 items-center justify-items-center mt-2 flex-1">
                  {[
                    { label: 'Dine-in', icon: '🍽️', revenue: dineInRevenue, colorClass: 'stroke-orange-500', bgClass: 'stroke-slate-100', shadowColor: 'rgba(249, 115, 22, 0.35)' },
                    { label: 'Takeaway', icon: '🛍️', revenue: takeawayRevenue, colorClass: 'stroke-indigo-500', bgClass: 'stroke-slate-100', shadowColor: 'rgba(99, 102, 241, 0.35)' },
                    { label: 'Delivery', icon: '🛵', revenue: deliveryRevenue, colorClass: 'stroke-rose-500', bgClass: 'stroke-slate-100', shadowColor: 'rgba(244, 63, 94, 0.35)' }
                  ].map((type) => {
                    const percentage = totalRevenue === 0 ? 0 : Math.round((type.revenue / totalRevenue) * 100);
                    return <AnimatedGauge key={type.label} {...type} percentage={percentage} currency={settings.currency} />;
                  })}
                </div>

                <div className="mt-2 border-t border-slate-100 pt-6">
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-600 mb-4 px-2">
                    <div className="flex flex-col items-center gap-1">
                      <span>🍽️ {dineInOrders.length} Orders</span>
                      <span className="font-bold text-slate-900">{settings.currency} {dineInOrders.length > 0 ? Math.round(dineInRevenue / dineInOrders.length).toLocaleString() : 0} avg</span>
                    </div>
                    <div className="w-px h-8 bg-slate-200"></div>
                    <div className="flex flex-col items-center gap-1">
                      <span>🛍️ {takeawayOrders.length} Orders</span>
                      <span className="font-bold text-slate-900">{settings.currency} {takeawayOrders.length > 0 ? Math.round(takeawayRevenue / takeawayOrders.length).toLocaleString() : 0} avg</span>
                    </div>
                    <div className="w-px h-8 bg-slate-200"></div>
                    <div className="flex flex-col items-center gap-1">
                      <span>🛵 {deliveryOrders.length} Orders</span>
                      <span className="font-bold text-slate-900">{settings.currency} {deliveryOrders.length > 0 ? Math.round(deliveryRevenue / deliveryOrders.length).toLocaleString() : 0} avg</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Selling Items */}
              <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
                <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-6 sm:mb-8 tracking-wide text-lg sm:text-xl">
                  <PieChart className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500" /> Top Selling Items
                </h3>

                <div className="flex-1 overflow-y-auto pr-2 space-y-4 sm:space-y-5 no-scrollbar min-h-[250px]">
                  {topItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                      <Coffee className="w-16 h-16 mb-4 opacity-20" />
                      <p className="text-sm tracking-wide font-bold">No sales data yet</p>
                    </div>
                  ) : (
                    topItems.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-4 p-3 group hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-2xl bg-white flex items-center justify-center text-slate-800 font-bold text-sm sm:text-base border border-slate-200 shadow-sm">
                            #{idx + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs sm:text-sm font-bold text-slate-800 truncate tracking-wide">{item.name}</p>
                            <p className="text-[10px] sm:text-xs text-slate-400 font-medium mt-0.5">{item.qty} sold</p>
                          </div>
                        </div>
                        <span className="text-right shrink-0 font-bold text-xs sm:text-sm text-slate-900 whitespace-nowrap tracking-wide">
                          {settings.currency}{item.rev.toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Hourly Sales Chart - Dynamic Sales Time Window */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 sm:gap-6 mb-6 sm:mb-8">
                <h3 className="font-bold text-slate-900 flex items-center gap-2 tracking-wide text-lg sm:text-xl">
                  <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" /> Hourly Sales Breakdown &amp; Peak Rush Analysis
                </h3>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {peakHour && peakHour.totalRevenue > 0 && (
                    <div className="flex items-center gap-1.5 sm:gap-2 bg-orange-50 text-orange-700 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl border border-orange-100 shadow-sm">
                      <Flame className="w-4 h-4 text-orange-500" />
                      <span className="text-xs sm:text-sm font-bold">Peak: {peakHour.timeRange}</span>
                      <span className="text-[10px] sm:text-xs font-semibold bg-orange-200/50 px-1.5 py-0.5 rounded-lg ml-1 text-orange-800">
                        {settings.currency}{peakHour.totalRevenue.toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-50 text-slate-700 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl border border-slate-200 shadow-sm">
                    <Utensils className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs sm:text-sm font-bold">Lunch (12-3): {settings.currency}{lunchRushTotal.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-50 text-slate-700 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl border border-slate-200 shadow-sm">
                    <Moon className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs sm:text-sm font-bold">Dinner (7-10): {settings.currency}{dinnerRushTotal.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="w-full h-[260px] sm:h-[360px] mt-4">
                {isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyData} margin={{ top: 20, right: 10, left: -10, bottom: 15 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}
                        dy={8}
                        interval="preserveStartEnd"
                        minTickGap={16}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}
                        width={58}
                        domain={[0, 'auto']}
                        tickFormatter={(val) => {
                          if (val === 0) return `0`;
                          if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
                          if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
                          return String(val);
                        }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                        itemStyle={{ color: '#fff7ed', fontWeight: 'bold' }}
                        cursor={{ fill: 'rgba(241, 245, 249, 0.6)' }}
                        formatter={(value: any) => [`${settings.currency}${Number(value).toLocaleString()}`, 'Sales']}
                      />
                      <Bar
                        dataKey="totalRevenue"
                        fill="#f97316"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={32}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full bg-slate-50 animate-pulse rounded-xl border border-slate-100 flex items-center justify-center">
                    <span className="text-slate-400 font-medium">Loading Chart...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Order History Table */}
            <div className="bg-white rounded-[2rem] shadow-md shadow-slate-200/50 border border-slate-100 overflow-hidden">
              <div className="p-4 sm:p-8 border-b border-slate-100 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-slate-50">
                <h3 className="font-bold text-slate-900 flex items-center gap-2 tracking-wide text-lg sm:text-xl shrink-0">
                  <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-500" /> Order History
                </h3>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full xl:w-auto">
                  <div className="relative w-full sm:w-64 shrink-0">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      type="text"
                      placeholder="Search orders..."
                      value={transactionSearch}
                      onChange={(e) => setTransactionSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm text-slate-700"
                    />
                  </div>

                  <div className="flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm w-full sm:w-auto overflow-x-auto no-scrollbar shrink-0">
                    {["Today", "Yesterday", "Last 7 Days", "Custom Date"].map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setTransactionDateFilter(opt as any)}
                        className={`flex-1 sm:flex-none text-center px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${transactionDateFilter === opt ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                          }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>

                  {transactionDateFilter === "Custom Date" && (
                    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-1 shadow-sm shrink-0 w-full sm:w-auto justify-center">
                      <input
                        type="date"
                        value={customDateRange.start}
                        onChange={(e) => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))}
                        className="text-xs px-2 py-1 outline-none text-slate-700 font-bold bg-transparent"
                      />
                      <span className="text-slate-400 text-xs font-bold">to</span>
                      <input
                        type="date"
                        value={customDateRange.end}
                        onChange={(e) => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))}
                        className="text-xs px-2 py-1 outline-none text-slate-700 font-bold bg-transparent"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="w-full overflow-x-auto no-scrollbar">
                <div className="min-w-[800px]">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-white text-slate-400 font-bold tracking-widest text-[11px] uppercase border-b-2 border-slate-100">
                      <tr>
                        <th className="px-4 sm:px-8 py-5">Date &amp; Time</th>
                        <th className="px-4 sm:px-8 py-5">Type / Customer</th>
                        <th className="px-4 sm:px-8 py-5 hidden sm:table-cell">Items Summary</th>
                        <th className="px-4 sm:px-8 py-5 text-right">Total</th>
                        <th className="px-4 sm:px-8 py-5 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactionOrders.slice(0, 50).map((order) => (
                        <tr key={order.id} className="hover:bg-slate-50 transition-colors group">
                          <td className="px-4 sm:px-8 py-5 whitespace-nowrap text-slate-500 font-bold">
                            {new Date(order.created_at).toLocaleDateString()} <span className="ml-2 hidden sm:inline">{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </td>
                          <td className="px-4 sm:px-8 py-5 whitespace-nowrap flex flex-col gap-1">
                            <span className={`font-bold text-[10px] uppercase px-2 py-1 rounded-lg w-max tracking-widest shadow-sm ${order.order_type === 'delivery' ? 'bg-indigo-500 text-white' :
                              order.order_type === 'takeaway' ? 'bg-slate-800 text-white' :
                                'bg-orange-500 text-white'
                              }`}>
                              {order.order_type || 'DINE-IN'} {order.table_no && order.table_no !== "0" && `T${order.table_no.padStart(2, '0')}`}
                            </span>
                            {order.customer_name && (
                              <span className="text-xs font-bold text-slate-600 truncate max-w-[120px] sm:max-w-none">{order.customer_name}</span>
                            )}
                          </td>
                          <td className="px-4 sm:px-8 py-5 text-slate-600 truncate max-w-[150px] sm:max-w-sm font-bold hidden sm:table-cell">
                            {order.items?.map(i => `${i.quantity}x ${i.name}`).join(", ")}
                          </td>
                          <td className="px-4 sm:px-8 py-5 whitespace-nowrap text-right font-bold text-slate-900 tracking-tight text-base sm:text-lg">
                            {settings.currency}{Number(order.total_amount || 0).toLocaleString()}
                          </td>
                          <td className="px-4 sm:px-8 py-5 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => setViewingOrder(order)}
                                className="w-8 h-8 rounded-xl bg-white border border-slate-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 flex items-center justify-center transition-all shadow-sm cursor-pointer"
                                title="View Bill"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setPrintOrder(order)}
                                className="w-8 h-8 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300 flex items-center justify-center transition-all shadow-sm cursor-pointer"
                                title="Re-Print Slip"
                              >
                                <Printer className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {transactionOrders.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-8 py-16 text-center text-slate-400 tracking-widest uppercase text-sm font-bold">
                            No transactions found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Viewing Order Modal */}
        {viewingOrder && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 no-print">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">Order #{viewingOrder.id.slice(0, 8).toUpperCase()}</h2>
                  <p className="text-sm font-semibold text-slate-500 mt-0.5 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    {new Date(viewingOrder.created_at).toLocaleDateString()} {new Date(viewingOrder.created_at).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  onClick={() => setViewingOrder(null)}
                  className="w-10 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shadow-sm cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 max-h-[60vh] overflow-y-auto no-scrollbar">
                <div className="flex gap-2 mb-6">
                  <span className={`font-bold text-xs uppercase px-3 py-1.5 rounded-xl tracking-widest shadow-sm ${viewingOrder.order_type === 'delivery' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' :
                    viewingOrder.order_type === 'takeaway' ? 'bg-slate-100 text-slate-700 border border-slate-200' :
                      'bg-orange-50 text-orange-600 border border-orange-100'
                    }`}>
                    {viewingOrder.order_type || 'DINE-IN'} {viewingOrder.table_no && viewingOrder.table_no !== "0" && `T${viewingOrder.table_no.padStart(2, '0')}`}
                  </span>
                  {viewingOrder.customer_name && (
                    <span className="font-bold text-xs px-3 py-1.5 rounded-xl bg-slate-50 text-slate-600 border border-slate-200 shadow-sm">
                      {viewingOrder.customer_name}
                    </span>
                  )}
                  {viewingOrder.payment_method && (
                    <span className="font-bold text-xs px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-sm">
                      {viewingOrder.payment_method}
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Itemized List</h3>
                  {viewingOrder.items?.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-slate-700">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center font-bold text-sm text-slate-600">{item.quantity}x</span>
                        <span className="font-bold">{item.name}</span>
                      </div>
                      <span className="font-bold">{settings.currency}{(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 space-y-2">
                  <div className="flex justify-between text-sm font-semibold text-slate-500">
                    <span>Subtotal</span>
                    <span>{settings.currency}{Number(viewingOrder.total_amount || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xl font-bold text-slate-900 pt-2">
                    <span>Grand Total</span>
                    <span>{settings.currency}{Number(viewingOrder.total_amount || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="px-6 py-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setPrintOrder(viewingOrder);
                    setViewingOrder(null);
                  }}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg active:scale-95 cursor-pointer"
                >
                  <Printer className="w-5 h-5" /> Print Duplicate Receipt
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Void Modal */}
        {voidModalOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 no-print"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setVoidModalOpen(false); setVoidTargetId(null); setVoidForm({ managerPin: "", reason: "" }); setVoidError(""); setShakePin(false);
              }
            }}
          >
            <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">⚠️ Manager Authorization Required</h2>
                <button
                  type="button"
                  onClick={() => { setVoidModalOpen(false); setVoidTargetId(null); setVoidForm({ managerPin: "", reason: "" }); setVoidError(""); setShakePin(false); }}
                  className="p-2 bg-slate-200 hover:bg-slate-300 rounded-full text-slate-600 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form
                className="p-6 space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!voidForm.reason || !voidForm.managerPin || isLoading) return;
                  if (!voidTargetId) return;

                  const reasonTrim = voidForm.reason.trim();
                  if (reasonTrim.length < 4 || /^\d+$/.test(reasonTrim)) {
                    setVoidError("Reason must be at least 4 characters and cannot be purely numbers.");
                    setShakePin(true);
                    setTimeout(() => setShakePin(false), 500);
                    return;
                  }

                  setIsLoading(true);
                  setVoidError("");

                  const result = await verifyManagerPinAndVoid(voidTargetId, voidForm.managerPin, reasonTrim);

                  if (!result.success) {
                    setVoidError(result.error || "Failed to authorize.");
                    setShakePin(true);
                    setTimeout(() => setShakePin(false), 500);
                    setVoidForm(prev => ({ ...prev, managerPin: "" }));
                    setTimeout(() => pinInputRef.current?.focus(), 50);
                    setIsLoading(false);
                    return;
                  }

                  setPettyCashLogs(prev => prev.map(log => log.id === voidTargetId ? {
                    ...log, is_voided: true, void_reason: reasonTrim, voided_by: 'Manager', voided_at: new Date().toISOString()
                  } : log));
                  showToast("Entry voided successfully.", "success");
                  setVoidModalOpen(false);
                  setVoidTargetId(null);
                  setVoidForm({ managerPin: "", reason: "" });
                  setVoidError("");
                  setIsLoading(false);
                }}
              >
                {(() => {
                  const targetLog = pettyCashLogs.find(l => l.id === voidTargetId);
                  if (!targetLog) return null;
                  return (
                    <div className="bg-rose-50 p-4 rounded-xl border border-rose-100 text-sm">
                      <p className="font-bold text-rose-900 mb-2">You are about to void the following entry:</p>
                      <ul className="space-y-1 text-rose-800">
                        <li><strong className="text-rose-900">Amount:</strong> {settings.currency}{targetLog.amount.toLocaleString()}</li>
                        <li><strong className="text-rose-900">Reason:</strong> {targetLog.reason}</li>
                        <li><strong className="text-rose-900">Authorized By:</strong> {targetLog.staff_name || targetLog.authorized_by || "Staff"}</li>
                      </ul>
                    </div>
                  );
                })()}
                {voidError && (
                  <div className="text-rose-600 font-bold text-sm text-center bg-rose-50 p-2 rounded-lg border border-rose-100">
                    {voidError}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Reason for Voiding *</label>
                  <input
                    type="text"
                    value={voidForm.reason}
                    onChange={(e) => {
                      setVoidForm(prev => ({ ...prev, reason: e.target.value }));
                      setVoidError("");
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                    placeholder="e.g., Mistyped bill entry"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Manager PIN *</label>
                  <input
                    type="password"
                    ref={pinInputRef}
                    value={voidForm.managerPin}
                    onChange={(e) => {
                      setVoidForm(prev => ({ ...prev, managerPin: e.target.value }));
                      setVoidError("");
                    }}
                    className={`w-full bg-slate-50 border rounded-xl px-4 py-3 font-bold text-slate-900 focus:outline-none focus:ring-2 text-center tracking-widest text-lg ${shakePin ? 'border-rose-500 ring-rose-500 animate-shake-custom' : 'border-slate-200 focus:ring-rose-500'} ${voidError ? 'border-rose-500' : ''}`}
                    placeholder="••••"
                    maxLength={4}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!voidForm.reason || !voidForm.managerPin || isLoading}
                  className="w-full py-4 mt-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-[0_8px_20px_rgba(225,29,72,0.3)] cursor-pointer"
                >
                  {isLoading ? "Processing..." : "Confirm Void Entry"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Return Change Modal */}
        {returnModalOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 no-print"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setReturnModalOpen(false);
                setReturnTargetId(null);
                setReturnForm({ returnedChange: "", reason: "" });
                setReturnError("");
                setShakeReturn(false);
              }
            }}
          >
            <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">🔄 Return Change</h2>
                <button
                  type="button"
                  onClick={() => {
                    setReturnModalOpen(false);
                    setReturnTargetId(null);
                    setReturnForm({ returnedChange: "", reason: "" });
                    setReturnError("");
                    setShakeReturn(false);
                  }}
                  className="p-2 bg-slate-200 hover:bg-slate-300 rounded-full text-slate-600 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form
                className="p-6 space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!returnForm.returnedChange || Boolean(returnError) || isLoading) return;

                  const returnedVal = Number(returnForm.returnedChange);
                  const targetLog = pettyCashLogs.find(l => l.id === returnTargetId);

                  if (isNaN(returnedVal) || returnedVal <= 0) {
                    setReturnError("Please enter a valid positive return amount.");
                    setShakeReturn(true);
                    setTimeout(() => setShakeReturn(false), 500);
                    return;
                  }

                  if (targetLog && returnedVal > targetLog.amount) {
                    setReturnError(`Returned amount cannot exceed ${settings.currency} ${targetLog.amount.toLocaleString()}`);
                    setShakeReturn(true);
                    setTimeout(() => setShakeReturn(false), 500);
                    return;
                  }

                  setIsLoading(true);
                  const { error } = await supabase.from('petty_cash_logs').update({
                    returned_change: returnedVal
                  }).eq('id', returnTargetId);

                  if (error) {
                    setReturnError("Failed to return change: " + error.message);
                    setShakeReturn(true);
                    setTimeout(() => setShakeReturn(false), 500);
                  } else {
                    setPettyCashLogs(prev => prev.map(log => log.id === returnTargetId ? {
                      ...log, returned_change: returnedVal
                    } : log));
                    showToast("Change returned successfully.", "success");
                    setReturnModalOpen(false);
                    setReturnTargetId(null);
                    setReturnForm({ returnedChange: "", reason: "" });
                    setReturnError("");
                  }
                  setIsLoading(false);
                }}
              >
                {(() => {
                  const targetLog = pettyCashLogs.find(l => l.id === returnTargetId);
                  if (!targetLog) return null;
                  return (
                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 text-sm">
                      <p className="font-bold text-emerald-900 mb-2">Original Outflow Record:</p>
                      <ul className="space-y-1 text-emerald-800">
                        <li><strong className="text-emerald-900">Amount Given:</strong> {settings.currency}{targetLog.amount.toLocaleString()}</li>
                        <li><strong className="text-emerald-900">Reason:</strong> {targetLog.reason}</li>
                        <li><strong className="text-emerald-900">Authorized By:</strong> {targetLog.staff_name || targetLog.authorized_by || "Staff"}</li>
                      </ul>
                    </div>
                  );
                })()}

                {returnError && (
                  <div className="text-rose-600 font-bold text-xs sm:text-sm text-center bg-rose-50 p-2.5 rounded-xl border border-rose-100 animate-in fade-in">
                    {returnError}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Returned Change Amount ({settings.currency}) *</label>
                  <input
                    type="number"
                    value={returnForm.returnedChange}
                    onChange={(e) => {
                      const val = e.target.value;
                      setReturnForm(prev => ({ ...prev, returnedChange: val }));

                      const targetLog = pettyCashLogs.find(l => l.id === returnTargetId);
                      const numVal = Number(val);
                      if (targetLog && numVal > targetLog.amount) {
                        setReturnError(`Cannot exceed original amount of ${settings.currency} ${targetLog.amount.toLocaleString()}`);
                      } else {
                        setReturnError("");
                      }
                    }}
                    className={`w-full bg-slate-50 border rounded-xl px-4 py-3 font-bold text-slate-900 focus:outline-none focus:ring-2 text-center tracking-widest text-lg transition-all ${shakeReturn ? 'border-rose-500 ring-rose-500 animate-shake-custom' : returnError ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-200 focus:ring-emerald-500'
                      }`}
                    placeholder="e.g. 500"
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={!returnForm.returnedChange || Boolean(returnError) || isLoading}
                  className="w-full py-4 mt-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-[0_8px_20px_rgba(5,150,105,0.3)] cursor-pointer disabled:cursor-not-allowed"
                >
                  {isLoading ? "Processing..." : "Confirm Return"}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Standalone 80mm Z-Report & Receipt Print Container */}
      <div
        id="print-receipt"
        data-printable="true"
        className="hidden print:block fixed inset-0 top-0 left-0 w-[80mm] min-h-screen bg-white text-black p-3 font-mono text-xs z-[99999]"
      >
        {printOrder ? (
          <div className="w-[72mm] font-mono text-black">
            <div className="text-center mb-3 pb-2 border-b-2 border-dashed border-black">
              <h1 className="text-lg font-black tracking-tight">{settings?.name || 'Restaurant POS'}</h1>
              <p className="text-[10px] uppercase font-bold tracking-widest">{settings?.tagline || 'Smart POS'}</p>
              <p className="text-[10px]">Tel: {settings?.phone || ''}</p>
              <p className="text-[10px] font-bold mt-1 uppercase">[ REPRINT BILL ]</p>
            </div>

            <div className="text-[11px] mb-2 pb-2 border-b border-dashed border-black space-y-0.5">
              <div className="flex justify-between font-bold">
                <span>{printOrder.order_type === 'takeaway' ? 'ORDER: TAKEAWAY' : printOrder.order_type === 'delivery' ? 'ORDER: DELIVERY' : `TABLE: ${printOrder.table_no}`}</span>
                <span>#{printOrder.id?.slice(0, 5).toUpperCase()}</span>
              </div>
              {printOrder.customer_name && <p>Customer: {printOrder.customer_name}</p>}
              <p>Date: {new Date(printOrder.created_at || Date.now()).toLocaleString()}</p>
            </div>

            <table className="w-full text-[11px] mb-2 border-b border-dashed border-black">
              <thead>
                <tr className="border-b border-black text-left font-bold">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-center">Qty</th>
                  <th className="py-1 text-right">Amt</th>
                </tr>
              </thead>
              <tbody>
                {(printOrder.items || []).map((item: any, idx: number) => (
                  <tr key={idx} className="border-b border-dotted border-gray-300">
                    <td className="py-1 pr-1 font-bold">{item.name}</td>
                    <td className="py-1 text-center font-bold">{item.quantity}</td>
                    <td className="py-1 text-right font-bold">{(item.price * item.quantity).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="text-[11px] space-y-1 mb-3 font-bold">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{settings?.currency || 'LKR'} {printOrder.total_amount?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-black border-t-2 border-black pt-1">
                <span>TOTAL:</span>
                <span>{settings?.currency || 'LKR'} {printOrder.total_amount?.toLocaleString()}</span>
              </div>
              {printOrder.payment_method && (
                <div className="flex justify-between text-[10px] font-normal pt-1">
                  <span>Payment:</span>
                  <span>{printOrder.payment_method}</span>
                </div>
              )}
            </div>

            <div className="text-center text-[10px] border-t border-dashed border-black pt-2">
              <p className="font-bold">*** THANK YOU COME AGAIN ***</p>
            </div>
          </div>
        ) : (
          <div className="w-[72mm] font-mono text-black">
            <div className="text-center mb-3 pb-2 border-b-2 border-dashed border-black">
              <h1 className="text-base font-black tracking-tight">{settings?.name || 'Restaurant POS'}</h1>
              <p className="text-[11px] font-black uppercase tracking-widest border-y border-black py-0.5 my-1">END OF DAY Z-REPORT</p>
              <p className="text-[10px]">Generated: {new Date().toLocaleString()}</p>
            </div>

            <div className="text-[11px] space-y-1 mb-3 border-b border-dashed border-black pb-2 font-bold">
              <div className="flex justify-between">
                <span>Total Orders:</span>
                <span>{orders?.length || 0}</span>
              </div>
              <div className="flex justify-between text-sm font-black border-t border-black pt-1">
                <span>GROSS SALES:</span>
                <span>{settings?.currency || 'LKR'} {(totalRevenue || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>Cash Sales:</span>
                <span>{settings?.currency || 'LKR'} {(cashRevenue || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs text-indigo-700">
                <span>Card Settlements:</span>
                <span>{settings?.currency || 'LKR'} {(cardRevenue || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs text-red-600">
                <span>Petty Cash Outflow:</span>
                <span>- {settings?.currency || 'LKR'} {(autoPettyCashTotal || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs font-black border-t border-dotted border-black pt-1">
                <span>NET CASH IN DRAWER:</span>
                <span>{settings?.currency || 'LKR'} {(openingFloat + (cashRevenue || 0) - (autoPettyCashTotal || 0)).toLocaleString()}</span>
              </div>
            </div>

            <div className="text-center text-[9px] border-t border-dashed border-black pt-2">
              <p>*** END OF FINANCIAL REPORT ***</p>
              <p className="mt-2">Manager Signature: ________________</p>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}