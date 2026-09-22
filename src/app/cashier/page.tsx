"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { supabase } from "@/lib/supabase";
import { Clock, Receipt, X } from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import PaymentModal from "@/components/PaymentModal";
import { useSettings } from "@/context/SettingsContext";
import PrintReceipt from "@/components/PrintReceipt";
import { useCurrentCashier } from "@/hooks/useCurrentCashier";

// Modular Components & Shared Types
import { Order, OrderItem, OrderStatus, OrderType } from "@/components/cashier/types";
import { TablesGrid } from "@/components/cashier/TablesGrid";
import { IncomingQrQueue } from "@/components/cashier/IncomingQrQueue";
import { LiveOrdersWorkspace } from "@/components/cashier/LiveOrdersWorkspace";
import { SettlementPanel, CashierDaySummary } from "@/components/cashier/SettlementPanel";
import { ManualOrderModal } from "@/components/cashier/ManualOrderModal";
import { PettyCashModal } from "@/components/cashier/PettyCashModal";
import { VoidPinModal } from "@/components/cashier/VoidPinModal";
import { PaymentSuccessModal } from "@/components/cashier/PaymentSuccessModal";

const playChime = (type: 'new_order' | 'order_ready') => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'new_order') {
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'order_ready') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    }
  } catch (e) {
    console.log('Audio playback prevented by browser policy', e);
  }
};

export default function CashierPage() {
  const { settings, refreshSettings } = useSettings();
  const cashier = useCurrentCashier();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Persist day summary in localStorage so the panel renders without a pop-in on revisit
  const [daySummary, setDaySummary] = useState<CashierDaySummary[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = localStorage.getItem("pos_cashier_day_summary_v1");
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });

  // Mobile App View Active Tab
  const [mobileTab, setMobileTab] = useState<"tables" | "live" | "settle">("tables");

  // Toast Notification State
  const [errorToast, setErrorToast] = useState<{ show: boolean; message: string; type: "error" | "info" }>({ show: false, message: "", type: "error" });
  const errorToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((message: string, type: "error" | "info" = "error") => {
    if (errorToastTimer.current) clearTimeout(errorToastTimer.current);
    setErrorToast({ show: true, message, type });
    errorToastTimer.current = setTimeout(() => setErrorToast({ show: false, message: "", type: "error" }), 4000);
  }, []);

  const [activeViewTab, setActiveViewTab] = useState<"tables" | "takeaways">("tables");
  const [activeAddOnOrderId, setActiveAddOnOrderId] = useState<string | null>(null);
  const [incomingQrOrders, setIncomingQrOrders] = useState<Order[]>([]);
  const [waitingPaymentTableNos, setWaitingPaymentTableNos] = useState<Set<string>>(new Set());

  // Void Target State (Modal Logic & UI Handled by VoidPinModal component)
  const [voidItemTarget, setVoidItemTarget] = useState<{ orderId: string; itemId: string; delta: number } | null>(null);

  // Payment & Settlement State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentModalMethod, setPaymentModalMethod] = useState<string>("Cash");
  const [stagedDirectOrder, setStagedDirectOrder] = useState<any>(null);

  // Persist table list in localStorage so count never jumps on revisit
  const [dbTables, setDbTables] = useState<any[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = localStorage.getItem("pos_restaurant_tables_v1");
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [manualModalType, setManualModalType] = useState("takeaway");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [showRecentBills, setShowRecentBills] = useState(false);
  const [recentBills, setRecentBills] = useState<Order[]>([]);
  const [showCustomDiscountModal, setShowCustomDiscountModal] = useState(false);
  const [customDiscountInput, setCustomDiscountInput] = useState("");

  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [lastSettledDetails, setLastSettledDetails] = useState<any>(null);

  const [isPettyCashModalOpen, setIsPettyCashModalOpen] = useState(false);
  const [voucherData, setVoucherData] = useState<any>(null);
  const [printOrderData, setPrintOrderData] = useState<Order | null>(null);
  const [kotPrintData, setKotPrintData] = useState<Order | null>(null);

  const channelRef = useRef<any>(null);
  const isPrintingRef = useRef(false);
  const lastPrintTimeRef = useRef<number>(0);
  const localHandledOrderIds = useRef<Set<string>>(new Set());
  const ordersRef = useRef<Order[]>([]);
  // True only on the very first fetch — prevents skeleton flash on background revalidation
  const isInitialLoad = useRef(true);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);

  useEffect(() => { ordersRef.current = orders; }, [orders]);

  // Fetch today's completed orders grouped by settled_by for the day summary
  const fetchDaySummary = useCallback(async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from("orders")
      .select("total_amount, payment_method, settled_by")
      .in("status", ["completed", "Completed"])
      .gte("created_at", todayStart.toISOString());

    if (!data) return;

    const map = new Map<string, CashierDaySummary>();
    for (const row of data as any[]) {
      const name: string = row.settled_by || "Unknown";
      const amount = Number(row.total_amount || 0);
      const method: string = (row.payment_method || "Cash").toLowerCase();
      const existing = map.get(name) ?? { cashierName: name, cash: 0, card: 0, split: 0, total: 0 };

      if (method.includes("split")) {
        existing.split += amount;
        // Attribute split evenly to cash & card for reporting
        existing.cash += amount / 2;
        existing.card += amount / 2;
      } else if (method.includes("card")) {
        existing.card += amount;
      } else {
        existing.cash += amount;
      }
      existing.total += amount;
      map.set(name, existing);
    }

    const next = Array.from(map.values()).sort((a, b) => b.total - a.total);
    setDaySummary(next);
    // Persist so the panel renders immediately on the next visit
    try { localStorage.setItem("pos_cashier_day_summary_v1", JSON.stringify(next)); } catch {}
  }, []);

  const triggerSafePrint = useCallback((order: Order, isKot: boolean = false, onClose?: () => void) => {
    if (typeof window === "undefined" || (isKot && (!order.items || order.items.length === 0))) return;
    const now = Date.now();
    if (isPrintingRef.current || now - lastPrintTimeRef.current < 800) return;
    isPrintingRef.current = true;
    lastPrintTimeRef.current = now;

    if (isKot) {
      setKotPrintData(order);
      setPrintOrderData(null);
      setVoucherData(null);
    } else {
      setPrintOrderData(order);
      setKotPrintData(null);
      setVoucherData(null);
    }

    const releaseLock = () => {
      isPrintingRef.current = false;
      if (onClose) onClose();
      window.removeEventListener('afterprint', releaseLock);
    };

    window.addEventListener('afterprint', releaseLock, { once: true });
    setTimeout(() => { isPrintingRef.current = false; }, 3500);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { window.print(); } catch (e) { isPrintingRef.current = false; }
      });
    });
  }, []);

  useEffect(() => { if (refreshSettings) refreshSettings(); }, [refreshSettings]);
  useEffect(() => { fetchDaySummary(); }, [fetchDaySummary]);

  useEffect(() => {
    const fetchRestaurantTables = async () => {
      const { data } = await supabase.from("restaurant_tables").select("*").order("created_at", { ascending: true });
      if (data && data.length > 0) {
        const mapped = data.map((t: any) => ({ id: String(t.table_no), name: `T${t.table_no}` }));
        setDbTables(mapped);
        // Persist so the correct table count is available on next visit without waiting for fetch
        try { localStorage.setItem("pos_restaurant_tables_v1", JSON.stringify(mapped)); } catch {}
      }
    };
    fetchRestaurantTables();
  }, []);

  const tables = useMemo(() => dbTables, [dbTables]);

  const updateIncomingQrList = useCallback((currentOrders: Order[]) => {
    const pendingList: Order[] = [];
    currentOrders.forEach((o) => {
      const s = String(o.status || "").toLowerCase();
      const hasUnprintedItems = (o.items || []).some(i => i.kot_printed === false || i.kot_printed === undefined);
      if (s !== "completed" && (s === "pending" || s === "reviewing" || hasUnprintedItems)) {
        pendingList.push(o);
      }
    });
    setIncomingQrOrders(pendingList);
  }, []);

  const fetchOrders = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .not("status", "in", '("completed","Completed")')
      .order("created_at", { ascending: false });

    if (data) {
      const fetched = data as Order[];
      setOrders(fetched);
      updateIncomingQrList(fetched);

      const waitingSet = new Set<string>();
      fetched.forEach((ord: any) => {
        const isDineIn = !ord.order_type || ord.order_type === "dine-in";
        if (isDineIn && ord.table_no && ord.table_no !== "0") {
          if (ord.is_bill_printed === true || String(ord.status || "").toLowerCase() === "waiting_payment") {
            waitingSet.add(String(ord.table_no));
          }
        }
      });
      setWaitingPaymentTableNos(waitingSet);
    }
    // Mark that the initial load is complete so subsequent fetches don't flash skeleton
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      setIsLoadingOrders(false);
    }
  }, [updateIncomingQrList]);

  // Auto-select the first order on first load only
  useEffect(() => {
    if (orders.length > 0 && !selectedOrderId) {
      setSelectedOrderId(orders[0].id);
    }
  }, [orders, selectedOrderId]);

  useEffect(() => {
    fetchOrders();
    const channel = supabase
      .channel("cashier_modular_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async (payload) => {
        if (payload.eventType === "INSERT") {
          const newOrder = payload.new as any;
          if (newOrder.status?.toLowerCase() === "completed") return;

          const isDineIn = !newOrder.order_type || newOrder.order_type === "dine-in";
          if (isDineIn && newOrder.table_no && newOrder.table_no !== "0") {
            const existingActive = ordersRef.current.find(
              (o) => o.table_no === newOrder.table_no && o.id !== newOrder.id && (!o.order_type || o.order_type === "dine-in") && o.status?.toLowerCase() !== "completed"
            );
            if (existingActive) {
              const currentItems = existingActive.items || [];
              const incomingItems = (newOrder.items || []).map((i: any) => ({
                ...i,
                is_new: true,
                prepared: false,
                kot_printed: false,
                added_at: new Date().toISOString()
              }));

              const combinedItems = [...incomingItems, ...currentItems];
              const combinedTotal = Number(existingActive.total_amount || 0) + Number(newOrder.total_amount || 0);

              await supabase.from("orders").delete().eq("id", newOrder.id);

              await supabase.from("orders").update({
                items: combinedItems,
                total_amount: combinedTotal,
                status: "Preparing"
              }).eq("id", existingActive.id);

              setOrders(prev => {
                const next = prev.map(o => o.id === existingActive.id ? { ...o, items: combinedItems, total_amount: combinedTotal, status: "Preparing" } : o);
                updateIncomingQrList(next);
                return next;
              });

              playChime('new_order');
              return;
            }
          }
          setOrders((prev) => {
            const next = [newOrder as Order, ...prev.filter(o => o.id !== newOrder.id)];
            updateIncomingQrList(next);
            return next;
          });
          setSelectedOrderId(newOrder.id);
          playChime('new_order');
        } else if (payload.eventType === "UPDATE") {
          const updated = payload.new as any;
          if (updated.status?.toLowerCase() === "completed") {
            setOrders((prev) => {
              const next = prev.filter((o) => o.id !== updated.id);
              updateIncomingQrList(next);
              return next;
            });
            setWaitingPaymentTableNos((prev) => { const next = new Set(prev); next.delete(String(updated.table_no)); return next; });
            setSelectedOrderId((prev) => prev === updated.id ? null : prev);
          } else {
            setOrders((prev) => {
              const next = prev.map((o) => (o.id === updated.id ? (updated as Order) : o));
              updateIncomingQrList(next);
              return next;
            });

            if (updated.table_no) {
              if (updated.is_bill_printed === true || updated.status === "waiting_payment") {
                setWaitingPaymentTableNos((prev) => new Set(prev).add(String(updated.table_no)));
              }
            }

            const hasUnprinted = (updated.items || []).some((i: any) => i.kot_printed === false || i.kot_printed === undefined);
            if (hasUnprinted) {
              playChime('new_order');
            }
          }
        } else if (payload.eventType === "DELETE") {
          setOrders((prev) => {
            const next = prev.filter((o) => o.id !== payload.old.id);
            updateIncomingQrList(next);
            return next;
          });
          setSelectedOrderId((prev) => prev === payload.old.id ? null : prev);
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [fetchOrders, updateIncomingQrList]);

  const selectedOrder: Order | null = orders.find(o => o.id === selectedOrderId) || null;
  const serviceChargePct = Number(settings?.service_charge_pct ?? 10);
  const taxPct = Number(settings?.tax_pct ?? 0);
  const currencySymbol = settings?.currency || "LKR";

  const activeSettlementOrder: Order | null = useMemo(() => {
    if (stagedDirectOrder) {
      return {
        id: "DIRECT-STAGED",
        created_at: new Date().toISOString(),
        table_no: stagedDirectOrder.table_no || "0",
        order_type: stagedDirectOrder.order_type,
        customer_name: stagedDirectOrder.customer_name,
        items: stagedDirectOrder.items || [],
        status: "pending" as OrderStatus,
        total_amount: stagedDirectOrder.total_amount || 0,
      };
    }
    return selectedOrder;
  }, [stagedDirectOrder, selectedOrder]);

  const selectedOrderSubtotal = useMemo(() => {
    if (!activeSettlementOrder) return 0;
    return (activeSettlementOrder.items || []).reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
  }, [activeSettlementOrder]);

  const calculatedDiscount = useMemo(() => {
    if (!activeSettlementOrder) return 0;
    if (discountType === "percent") return (selectedOrderSubtotal * Number(discountValue || 0)) / 100;
    return Number(discountValue || 0);
  }, [activeSettlementOrder, selectedOrderSubtotal, discountType, discountValue]);

  const selectedOrderServiceCharge = useMemo(() => {
    if (!activeSettlementOrder) return 0;
    const isDineIn = !activeSettlementOrder.order_type || activeSettlementOrder.order_type === 'dine-in';
    return isDineIn ? (selectedOrderSubtotal * serviceChargePct) / 100 : 0;
  }, [activeSettlementOrder, selectedOrderSubtotal, serviceChargePct]);

  const selectedOrderTax = useMemo(() => {
    if (!activeSettlementOrder) return 0;
    return (selectedOrderSubtotal * taxPct) / 100;
  }, [activeSettlementOrder, selectedOrderSubtotal, taxPct]);

  const finalGrandTotal = useMemo(() => {
    return Math.max(0, selectedOrderSubtotal + selectedOrderServiceCharge + selectedOrderTax - calculatedDiscount);
  }, [selectedOrderSubtotal, selectedOrderServiceCharge, selectedOrderTax, calculatedDiscount]);

  const handlePrintGuestBill = useCallback(async (order: Order) => {
    const billPayload: Order = {
      ...order,
      discount: calculatedDiscount,
      total_amount: finalGrandTotal,
    };
    triggerSafePrint(billPayload, false);

    if (order.table_no && order.table_no !== "0") {
      setWaitingPaymentTableNos((prev) => new Set(prev).add(String(order.table_no)));

      if (order.id && order.id !== "DIRECT-STAGED") {
        try {
          await supabase
            .from("orders")
            .update({ is_bill_printed: true })
            .eq("id", order.id);
        } catch (e) {
          console.error("Failed to persist bill printed state in DB", e);
        }
      }
    }
  }, [calculatedDiscount, finalGrandTotal, triggerSafePrint]);

  const handlePrintKOT = async (order: Order) => {
    localHandledOrderIds.current.add(order.id);
    const totalItems = order.items || [];
    const unprintedItems = totalItems.filter(i => i.kot_printed === false || i.kot_printed === undefined);
    const itemsToPrintInKOT = unprintedItems.length > 0 ? unprintedItems : totalItems;
    const isAddOn = totalItems.some(i => i.kot_printed === true) && unprintedItems.length > 0;

    triggerSafePrint({
      ...order,
      items: itemsToPrintInKOT,
      notes: isAddOn ? `[RUNNING KOT (ADD-ON)] ${order.notes || ''}`.trim() : order.notes
    }, true);

    const newlyPrinted = unprintedItems.map(i => ({ ...i, prepared: false, is_new: false, kot_printed: true }));
    const alreadyPrinted = totalItems.filter(i => i.kot_printed === true).map(i => ({ ...i, is_new: false }));
    const reorderedItems = [...newlyPrinted, ...alreadyPrinted];

    // Explicitly preserve order_type so Takeaway/Delivery labels are never lost.
    await supabase.from("orders").update({
      status: "Preparing",
      payment_method: "Cashier",
      items: reorderedItems,
      order_type: order.order_type || "dine-in"
    }).eq("id", order.id);
    setOrders(prev => {
      const next = prev.map(o => o.id === order.id ? {
        ...o,
        status: "Preparing",
        payment_method: "Cashier",
        items: reorderedItems,
        order_type: order.order_type || "dine-in"
      } : o);
      updateIncomingQrList(next);
      return next;
    });
  };

  const handleSettlePayment = async (method: string, passedTendered?: string, passedChange?: number) => {
    setIsSubmitting(true);
    const tenderedAmt = passedTendered || String(finalGrandTotal);
    const changeAmt = passedChange !== undefined ? passedChange : 0;

    try {
      if (stagedDirectOrder) {
        const payload = {
          table_no: stagedDirectOrder.order_type === 'dine-in' ? String(stagedDirectOrder.table_no || '1') : '0',
          order_type: stagedDirectOrder.order_type || 'takeaway',
          customer_name: stagedDirectOrder.customer_name?.trim() || null,
          items: stagedDirectOrder.items.map((item: any) => ({ ...item, status: 'ready', kot_printed: true })),
          total_amount: Number(finalGrandTotal),
          payment_method: method || 'Cash',
          status: 'completed',
          discount: Number(calculatedDiscount),
          settled_by: cashier.name,
          notes: (method === "Cash" || passedTendered) ? `[Paid Cash: ${tenderedAmt} | Change: ${changeAmt}] ${stagedDirectOrder.special_notes || ''}`.trim() : stagedDirectOrder.special_notes,
          created_at: new Date().toISOString()
        };

        const { data, error } = await supabase.from("orders").insert([payload]).select();
        if (error) throw error;

        if (data && data[0]) {
          const inserted = data[0] as Order;
          localHandledOrderIds.current.add(inserted.id);

          triggerSafePrint({
            ...inserted,
            discount: calculatedDiscount,
            total_amount: finalGrandTotal,
            settled_by: cashier.name,
          }, false);

          setLastSettledDetails({
            orderId: inserted.id,
            tableNo: inserted.table_no,
            orderType: inserted.order_type,
            totalAmount: finalGrandTotal,
            paymentMethod: method,
            change: changeAmt
          });
          setShowPaymentSuccess(true);
        }
        setStagedDirectOrder(null);
        setMobileTab("tables");
        fetchDaySummary();
      } else if (selectedOrder) {
        const isDineIn = !selectedOrder.order_type || selectedOrder.order_type === 'dine-in';

        const updateData: any = {
          status: "completed",
          payment_method: method,
          total_amount: Number(finalGrandTotal),
          discount: Number(calculatedDiscount),
          settled_by: cashier.name,
          is_bill_printed: false,
          notes: (method === "Cash" || passedTendered) ? `[Paid Cash: ${tenderedAmt} | Change: ${changeAmt}] ${selectedOrder.notes || ''}`.trim() : selectedOrder.notes
        };

        await supabase.from("orders").update(updateData).eq("id", selectedOrder.id);
        setOrders(prev => {
          const next = prev.filter(o => o.id !== selectedOrder.id);
          updateIncomingQrList(next);
          return next;
        });
        setWaitingPaymentTableNos((prev) => { const n = new Set(prev); n.delete(String(selectedOrder.table_no)); return n; });

        if (!isDineIn) {
          triggerSafePrint({
            ...selectedOrder,
            ...updateData,
            discount: calculatedDiscount,
            total_amount: finalGrandTotal,
            settled_by: cashier.name,
          }, false);
        }

        setLastSettledDetails({
          orderId: selectedOrder.id,
          tableNo: selectedOrder.table_no,
          orderType: selectedOrder.order_type,
          totalAmount: finalGrandTotal,
          paymentMethod: method,
          change: changeAmt
        });
        setShowPaymentSuccess(true);
        setSelectedOrderId(null);
        setMobileTab("tables");
        fetchDaySummary();
      }
      setIsPaymentModalOpen(false);
      setDiscountValue(0);
    } catch (err: any) {
      showError(err.message || "Failed to settle.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Void execution callback after successful verification from VoidPinModal
  const handleExecuteVoid = async () => {
    if (!voidItemTarget) return;
    const order = orders.find((o) => o.id === voidItemTarget.orderId);
    if (order) {
      let newItems = [...(order.items || [])];
      if (voidItemTarget.delta === 0) {
        newItems = newItems.filter((i) => String(i.id) !== String(voidItemTarget.itemId));
      } else {
        const idx = newItems.findIndex((i) => String(i.id) === String(voidItemTarget.itemId));
        if (idx !== -1) {
          if (newItems[idx].quantity + voidItemTarget.delta <= 0) {
            newItems.splice(idx, 1);
          } else {
            newItems[idx].quantity += voidItemTarget.delta;
          }
        }
      }

      if (newItems.length === 0) {
        await supabase.from("orders").delete().eq("id", order.id);
        setOrders((prev) => {
          const next = prev.filter((o) => o.id !== order.id);
          updateIncomingQrList(next);
          return next;
        });
        setSelectedOrderId(null);
      } else {
        const sub = newItems.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0);
        await supabase.from("orders").update({ items: newItems, total_amount: sub }).eq("id", order.id);
        setOrders((prev) => {
          const next = prev.map((o) => (o.id === order.id ? { ...o, items: newItems, total_amount: sub } : o));
          updateIncomingQrList(next);
          return next;
        });
      }
    }
    setVoidItemTarget(null);
  };

  const receiptOrder: Order | null = useMemo(() => {
    const base = printOrderData || activeSettlementOrder;
    if (!base) return null;
    return {
      ...base,
      discount: printOrderData?.discount !== undefined ? printOrderData.discount : calculatedDiscount,
      total_amount: printOrderData?.total_amount !== undefined ? printOrderData.total_amount : finalGrandTotal
    };
  }, [printOrderData, activeSettlementOrder, calculatedDiscount, finalGrandTotal]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isPaymentModalOpen) { setIsPaymentModalOpen(false); return; }
        if (isModalOpen) { setIsModalOpen(false); return; }
        if (showRecentBills) { setShowRecentBills(false); return; }
        if (isPettyCashModalOpen) { setIsPettyCashModalOpen(false); return; }
        if (showCustomDiscountModal) { setShowCustomDiscountModal(false); return; }
        if (voidItemTarget) { setVoidItemTarget(null); return; }
        if (stagedDirectOrder) { setStagedDirectOrder(null); return; }
      }

      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (e.key === "F1") {
        e.preventDefault();
        if (activeSettlementOrder) {
          const isDineIn = !activeSettlementOrder.order_type || activeSettlementOrder.order_type === "dine-in";
          if (isDineIn) {
            handlePrintGuestBill(activeSettlementOrder);
          }
        }
      } else if (e.key === "F2") {
        e.preventDefault();
        if (activeSettlementOrder) {
          setPaymentModalMethod("Cash");
          setIsPaymentModalOpen(true);
        }
      } else if (e.key === "F3") {
        e.preventDefault();
        if (activeSettlementOrder) {
          handleSettlePayment("Card", String(finalGrandTotal), 0);
        }
      } else if (e.key === "F4") {
        e.preventDefault();
        if (activeSettlementOrder) {
          setPaymentModalMethod("Split");
          setIsPaymentModalOpen(true);
        }
      } else if (e.key === "F9") {
        e.preventDefault();
        setActiveAddOnOrderId(null);
        setManualModalType("takeaway");
        setIsModalOpen(true);
      } else if (e.key === "F10") {
        e.preventDefault();
        setActiveAddOnOrderId(null);
        setManualModalType("delivery");
        setIsModalOpen(true);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [activeSettlementOrder, finalGrandTotal, handlePrintGuestBill, isPaymentModalOpen, isModalOpen, showRecentBills, isPettyCashModalOpen, showCustomDiscountModal, voidItemTarget, stagedDirectOrder]);

  return (
    <ProtectedRoute>
      <div className="flex-1 flex flex-col font-sans overflow-hidden bg-slate-100 text-slate-900 pt-[64px] print:hidden">

        {/* Global Navbar */}
        <Navbar
          rightActions={
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  const { data } = await supabase
                    .from("orders")
                    .select("*")
                    .in("status", ["completed", "Completed"])
                    .order("created_at", { ascending: false })
                    .limit(6);
                  if (data) {
                    setRecentBills(data as Order[]);
                    setShowRecentBills(true);
                  }
                }}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-orange-50/80 hover:bg-orange-100 text-orange-600 border border-orange-200/90 text-[11px] font-black uppercase tracking-wider transition-all shadow-2xs active:scale-95 cursor-pointer"
                title="Recent Bills"
              >
                <Clock className="w-3.5 h-3.5 text-orange-500 shrink-0 stroke-[2.5]" />
                <span className="hidden sm:inline whitespace-nowrap">Recent Bills</span>
              </button>

              <button
                onClick={() => setIsPettyCashModalOpen(true)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-rose-50/80 hover:bg-rose-100 text-rose-600 border border-rose-200/90 text-[11px] font-black uppercase tracking-wider transition-all shadow-2xs active:scale-95 cursor-pointer"
                title="Log Outflow"
              >
                <Receipt className="w-3.5 h-3.5 text-rose-500 shrink-0 stroke-[2.5]" />
                <span className="hidden sm:inline whitespace-nowrap">Log Outflow</span>
              </button>
            </div>
          }
        />

        {/* Error Toast */}
        {errorToast.show && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[99999] flex items-center gap-2 px-5 py-3 rounded-full shadow-xl font-bold text-sm whitespace-nowrap animate-in fade-in slide-in-from-top-4 no-print bg-rose-600 text-white">
            <X className="w-4 h-4 opacity-80" />
            {errorToast.message}
          </div>
        )}

        {/* Modular Modern Void PIN Modal */}
        <VoidPinModal
          isOpen={!!voidItemTarget}
          onClose={() => setVoidItemTarget(null)}
          onSuccess={handleExecuteVoid}
        />

        {/* Modular Modern Animated Payment Success Modal */}
        <PaymentSuccessModal
          isOpen={showPaymentSuccess}
          onClose={() => setShowPaymentSuccess(false)}
          details={lastSettledDetails}
          currencySymbol={currencySymbol}
        />

        {/* DESKTOP VIEW */}
        <div className="hidden min-[1024px]:grid grid-cols-12 gap-3 h-[calc(100vh-70px)] px-3 sm:px-4 py-2 overflow-hidden">
          <TablesGrid
            tables={tables}
            orders={orders}
            selectedOrderId={selectedOrderId}
            waitingPaymentTableNos={waitingPaymentTableNos}
            currencySymbol={currencySymbol}
            activeViewTab={activeViewTab}
            setActiveViewTab={setActiveViewTab}
            onSelectOrder={(id) => { setStagedDirectOrder(null); setSelectedOrderId(id); }}
            onOpenManualModal={(typeStr) => { setManualModalType(typeStr); setActiveAddOnOrderId(null); setIsModalOpen(true); }}
          />

          {/* Middle Column */}
          <div className="col-span-12 lg:col-span-5 xl:col-span-5 flex flex-col gap-2.5 overflow-hidden h-full">

            {/* Top Card: Incoming QR */}
            <div className="bg-white border border-orange-300/70 rounded-3xl flex flex-col shadow-[0_0_25px_rgba(249,115,22,0.12)] overflow-hidden shrink-0 h-[43%] transition-all">
              <div className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 flex justify-between items-center shrink-0 shadow-xs">
                <h2 className="font-black text-white text-xs sm:text-sm uppercase tracking-wider drop-shadow-xs">
                  LIVE ORDERS
                </h2>
                {incomingQrOrders.length > 0 && (
                  <span className="bg-white text-orange-600 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-sm animate-pulse">
                    {incomingQrOrders.length} QR Pending
                  </span>
                )}
              </div>

              <div className="p-2 flex-1 min-h-0 overflow-y-auto no-scrollbar">
                <IncomingQrQueue
                  incomingQrOrders={incomingQrOrders}
                  selectedOrderId={selectedOrderId}
                  onReviewOrder={async (qrOrd) => {
                    setSelectedOrderId(qrOrd.id);
                    if (qrOrd.status !== 'reviewing') {
                      await supabase.from("orders").update({ status: "reviewing" }).eq("id", qrOrd.id);
                      setOrders(prev => {
                        const next = prev.map(o => o.id === qrOrd.id ? { ...o, status: "reviewing" } : o);
                        updateIncomingQrList(next);
                        return next;
                      });
                    }
                  }}
                  onAcceptKot={(qrOrd) => { handlePrintKOT(qrOrd); setSelectedOrderId(qrOrd.id); }}
                />
              </div>
            </div>

            {/* Bottom Card: Current Selected Order Workspace */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <LiveOrdersWorkspace
                selectedOrder={selectedOrder}
                incomingQrOrders={incomingQrOrders}
                onOpenVoidModal={(orderId, itemId, delta) => setVoidItemTarget({ orderId, itemId, delta })}
                onOpenAddItemModal={() => {
                  if (!selectedOrder) return;
                  setActiveAddOnOrderId(selectedOrder.id);
                  setManualModalType(selectedOrder.order_type === 'dine-in' ? `dine-in-${selectedOrder.table_no}` : (selectedOrder.order_type || 'takeaway'));
                  setIsModalOpen(true);
                }}
                onPrintKot={handlePrintKOT}
              />
            </div>

          </div>

          <SettlementPanel
            activeSettlementOrder={activeSettlementOrder}
            currencySymbol={currencySymbol}
            taxPct={taxPct}
            serviceChargePct={serviceChargePct}
            discountType={discountType}
            discountValue={discountValue}
            subtotal={selectedOrderSubtotal}
            calculatedDiscount={calculatedDiscount}
            serviceCharge={selectedOrderServiceCharge}
            tax={selectedOrderTax}
            grandTotal={finalGrandTotal}
            setDiscountType={setDiscountType}
            setDiscountValue={setDiscountValue}
            onOpenCustomDiscountModal={() => { setCustomDiscountInput(discountValue > 0 ? String(discountValue) : ""); setShowCustomDiscountModal(true); }}
            onPrintGuestBill={handlePrintGuestBill}
            onSelectPaymentMethod={(method) => { setPaymentModalMethod(method); setIsPaymentModalOpen(true); }}
            onInstantCardPay={() => handleSettlePayment("Card", String(finalGrandTotal), 0)}
            daySummary={daySummary}
            activeCashierName={cashier.name}
          />
        </div>

        {/* MOBILE VIEW (<1024px) */}
        <div className="min-[1024px]:hidden flex-1 flex flex-col overflow-hidden pb-16">

          <div className={`flex-1 h-full overflow-hidden p-2.5 ${mobileTab === "tables" ? "block" : "hidden"}`}>
            <TablesGrid
              tables={tables}
              orders={orders}
              selectedOrderId={selectedOrderId}
              waitingPaymentTableNos={waitingPaymentTableNos}
              currencySymbol={currencySymbol}
              activeViewTab={activeViewTab}
              setActiveViewTab={setActiveViewTab}
              onSelectOrder={(id) => {
                setStagedDirectOrder(null);
                setSelectedOrderId(id);
                setMobileTab("live");
              }}
              onOpenManualModal={(typeStr) => { setManualModalType(typeStr); setActiveAddOnOrderId(null); setIsModalOpen(true); }}
            />
          </div>

          <div className={`flex-1 h-full overflow-hidden p-2.5 flex flex-col gap-2.5 ${mobileTab === "live" ? "flex" : "hidden"}`}>
            <div className="bg-white border border-orange-300/70 rounded-3xl flex flex-col shadow-[0_0_25px_rgba(249,115,22,0.12)] overflow-hidden shrink-0 h-[43%]">
              <div className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 flex justify-between items-center shrink-0 shadow-xs">
                <h2 className="font-black text-white text-xs uppercase tracking-wider drop-shadow-xs">
                  LIVE ORDERS
                </h2>
                {incomingQrOrders.length > 0 && (
                  <span className="bg-white text-orange-600 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-sm animate-pulse">
                    {incomingQrOrders.length} QR Pending
                  </span>
                )}
              </div>

              <div className="p-2 flex-1 min-h-0 overflow-y-auto no-scrollbar">
                <IncomingQrQueue
                  incomingQrOrders={incomingQrOrders}
                  selectedOrderId={selectedOrderId}
                  onReviewOrder={async (qrOrd) => {
                    setSelectedOrderId(qrOrd.id);
                    if (qrOrd.status !== 'reviewing') {
                      await supabase.from("orders").update({ status: "reviewing" }).eq("id", qrOrd.id);
                      setOrders(prev => {
                        const next = prev.map(o => o.id === qrOrd.id ? { ...o, status: "reviewing" } : o);
                        updateIncomingQrList(next);
                        return next;
                      });
                    }
                  }}
                  onAcceptKot={(qrOrd) => { handlePrintKOT(qrOrd); setSelectedOrderId(qrOrd.id); }}
                />
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <LiveOrdersWorkspace
                selectedOrder={selectedOrder}
                incomingQrOrders={incomingQrOrders}
                onOpenVoidModal={(orderId, itemId, delta) => setVoidItemTarget({ orderId, itemId, delta })}
                onOpenAddItemModal={() => {
                  if (!selectedOrder) return;
                  setActiveAddOnOrderId(selectedOrder.id);
                  setManualModalType(selectedOrder.order_type === 'dine-in' ? `dine-in-${selectedOrder.table_no}` : (selectedOrder.order_type || 'takeaway'));
                  setIsModalOpen(true);
                }}
                onPrintKot={handlePrintKOT}
              />
            </div>
          </div>

          <div className={`flex-1 h-full overflow-hidden p-2.5 ${mobileTab === "settle" ? "block" : "hidden"}`}>
            <SettlementPanel
              activeSettlementOrder={activeSettlementOrder}
              currencySymbol={currencySymbol}
              taxPct={taxPct}
              serviceChargePct={serviceChargePct}
              discountType={discountType}
              discountValue={discountValue}
              subtotal={selectedOrderSubtotal}
              calculatedDiscount={calculatedDiscount}
              serviceCharge={selectedOrderServiceCharge}
              tax={selectedOrderTax}
              grandTotal={finalGrandTotal}
              setDiscountType={setDiscountType}
              setDiscountValue={setDiscountValue}
              onOpenCustomDiscountModal={() => { setCustomDiscountInput(discountValue > 0 ? String(discountValue) : ""); setShowCustomDiscountModal(true); }}
              onPrintGuestBill={handlePrintGuestBill}
              onSelectPaymentMethod={(method) => { setPaymentModalMethod(method); setIsPaymentModalOpen(true); }}
              onInstantCardPay={() => handleSettlePayment("Card", String(finalGrandTotal), 0)}
              daySummary={daySummary}
              activeCashierName={cashier.name}
            />
          </div>

        </div>

        {/* Mobile Navigation Bar */}
        <nav className="min-[1024px]:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200 px-6 flex items-center justify-around z-40 shadow-xl">
          <button
            type="button"
            onClick={() => setMobileTab("tables")}
            className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${mobileTab === "tables" ? "text-orange-600 font-black scale-105" : "text-slate-400 font-bold"}`}
          >
            <span className="text-lg leading-none">🪑</span>
            <span className="text-[10px] tracking-wider uppercase">Tables</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileTab("live")}
            className={`relative flex flex-col items-center gap-1 transition-all cursor-pointer ${mobileTab === "live" ? "text-orange-600 font-black scale-105" : "text-slate-400 font-bold"}`}
          >
            <span className="text-lg leading-none">🔥</span>
            <span className="text-[10px] tracking-wider uppercase">Live</span>
            {incomingQrOrders.length > 0 && (
              <span className="absolute -top-1 -right-2 w-4 h-4 bg-orange-500 text-white rounded-full text-[9px] font-black flex items-center justify-center animate-pulse">
                {incomingQrOrders.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMobileTab("settle")}
            className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${mobileTab === "settle" ? "text-orange-600 font-black scale-105" : "text-slate-400 font-bold"}`}
          >
            <span className="text-lg leading-none">💳</span>
            <span className="text-[10px] tracking-wider uppercase">Settle</span>
          </button>
        </nav>

        {/* Manual Order Modal (Auto KOT & Direct Sync to Kitchen) */}
        <ManualOrderModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          tables={tables}
          currencySymbol={currencySymbol}
          serviceChargePct={serviceChargePct}
          taxPct={taxPct}
          initialOrderType={manualModalType}
          initialCustomerName={activeAddOnOrderId ? (selectedOrder?.customer_name || "") : ""}
          onSubmitOrder={async (isDirectSettle, payload) => {
            setIsSubmitting(true);
            try {
              if (isDirectSettle) {
                setStagedDirectOrder({
                  table_no: payload.tableNumber,
                  items: payload.items,
                  total_amount: payload.cartTotal,
                  order_type: payload.type,
                  customer_name: payload.customerName,
                  special_notes: payload.specialNotes
                });
                setSelectedOrderId(null);
                setIsModalOpen(false);
                setMobileTab("settle");
              } else {
                let existingActiveOrder: Order | null = null;
                if (activeAddOnOrderId) {
                  const f = orders.find(o => o.id === activeAddOnOrderId && o.status?.toLowerCase() !== 'completed');
                  if (f) existingActiveOrder = f;
                }
                if (!existingActiveOrder && payload.type === "dine-in") {
                  const { data } = await supabase.from("orders").select("*").eq("table_no", payload.tableNumber).in("status", ["pending", "reviewing", "Preparing", "Ready"]).limit(1);
                  if (data && data.length > 0) existingActiveOrder = data[0] as Order;
                }

                if (existingActiveOrder) {
                  const newItemsForKot = payload.items.map(i => ({
                    ...i,
                    is_new: true,
                    prepared: false,
                    kot_printed: true,
                    added_at: new Date().toISOString()
                  }));

                  triggerSafePrint({
                    ...existingActiveOrder,
                    items: newItemsForKot,
                    notes: `[RUNNING KOT (CASHIER ADD-ON)] ${payload.specialNotes || ''}`.trim()
                  }, true);

                  const merged = [...newItemsForKot, ...(existingActiveOrder.items || []).map(i => ({ ...i, is_new: false }))];
                  const newTotal = Number(existingActiveOrder.total_amount || 0) + Number(payload.cartTotal || 0);

                  await supabase
                    .from("orders")
                    .update({
                      items: merged,
                      total_amount: newTotal,
                      status: "Preparing",
                      // Explicitly preserve order_type so Takeaway/Delivery labels are never lost.
                      order_type: existingActiveOrder.order_type || "dine-in"
                    })
                    .eq("id", existingActiveOrder.id);

                  setOrders(prev => {
                    const next = prev.map(o => o.id === existingActiveOrder!.id ? {
                      ...o,
                      items: merged,
                      total_amount: newTotal,
                      status: "Preparing",
                      order_type: existingActiveOrder!.order_type || "dine-in"
                    } : o);
                    updateIncomingQrList(next);
                    return next;
                  });

                  setSelectedOrderId(existingActiveOrder.id);
                  playChime('new_order');
                } else {
                  const { data } = await supabase.from("orders").insert([{
                    table_no: payload.tableNumber,
                    items: payload.items.map(i => ({ ...i, kot_printed: true })),
                    total_amount: payload.cartTotal,
                    status: "Preparing",
                    order_type: payload.type,
                    customer_name: payload.customerName || null,
                    payment_method: "Cashier",
                    notes: payload.specialNotes || ""
                  }]).select();

                  if (data && data[0]) {
                    triggerSafePrint(data[0] as Order, true);
                  }
                }
                setIsModalOpen(false);
              }
            } catch (err: any) { showError(err.message); }
            finally { setIsSubmitting(false); }
          }}
          isSubmitting={isSubmitting}
        />

        {/* Petty Cash Modal */}
        <PettyCashModal
          isOpen={isPettyCashModalOpen}
          onClose={() => setIsPettyCashModalOpen(false)}
          currencySymbol={currencySymbol}
          onLogOutflow={async (amount, reason, staffName) => {
            const { data, error } = await supabase.from('petty_cash_logs').insert([{ amount, reason, staff_name: staffName }]).select();
            if (!error && data) {
              setVoucherData(data[0]);
              setTimeout(() => window.print(), 100);
            }
          }}
          isSubmitting={isSubmitting}
        />

        {/* Custom Discount Modal */}
        {showCustomDiscountModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 no-print">
            <div className="bg-white border border-slate-200 w-full max-w-xs rounded-3xl shadow-2xl p-6">
              <h3 className="font-black text-slate-900 text-base mb-3">Custom Discount</h3>
              <div className="flex bg-slate-100 rounded-xl p-1 mb-4 border border-slate-200">
                <button
                  onClick={() => setDiscountType("percent")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${discountType === 'percent' ? 'bg-orange-500 text-white shadow-xs' : 'text-slate-500'}`}
                >
                  % Percent
                </button>
                <button
                  onClick={() => setDiscountType("fixed")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${discountType === 'fixed' ? 'bg-orange-500 text-white shadow-xs' : 'text-slate-500'}`}
                >
                  {currencySymbol} Fixed
                </button>
              </div>
              <input
                type="number"
                value={customDiscountInput}
                onChange={(e) => setCustomDiscountInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 font-bold text-slate-900 text-center text-xl outline-none focus:border-orange-500 mb-4"
                placeholder="0"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCustomDiscountModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    let v = Number(customDiscountInput);
                    if (!isNaN(v) && v >= 0) {
                      if (discountType === 'percent' && v > 100) v = 100;
                      setDiscountValue(v);

                      if (selectedOrder) {
                        const calcDiscount = discountType === 'percent' ? (selectedOrderSubtotal * v) / 100 : v;
                        const grandTotal = Math.max(0, selectedOrderSubtotal + selectedOrderServiceCharge + selectedOrderTax - calcDiscount);

                        setOrders(prev => {
                          const next = prev.map(o => o.id === selectedOrder.id ? { ...o, discount: calcDiscount, total_amount: grandTotal } : o);
                          updateIncomingQrList(next);
                          return next;
                        });

                        await supabase.from("orders").update({
                          discount: calcDiscount,
                          total_amount: grandTotal
                        }).eq("id", selectedOrder.id);
                      }
                    }
                    setShowCustomDiscountModal(false);
                  }}
                  className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Recent Bills Modal */}
        {showRecentBills && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 no-print animate-in fade-in duration-150">
            <div className="bg-white border border-slate-200/80 w-full max-w-md rounded-[2.2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-slate-900 leading-none">Recent Bills</h2>
                    <p className="text-[11px] font-semibold text-slate-400 mt-1">Last completed orders</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowRecentBills(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="divide-y divide-slate-100/80 max-h-[62vh] overflow-y-auto no-scrollbar p-2">
                {recentBills.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs font-bold">
                    No recent bills found
                  </div>
                ) : (
                  recentBills.map((bill) => (
                    <div
                      key={bill.id}
                      className="p-3.5 hover:bg-orange-50/40 rounded-2xl transition-all flex justify-between items-center group cursor-pointer"
                      onClick={() => {
                        setShowRecentBills(false);
                        triggerSafePrint(bill, false);
                      }}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-black text-sm text-slate-900">
                            {bill.order_type === "takeaway"
                              ? "🛍️ Takeaway"
                              : bill.order_type === "delivery"
                                ? "🛵 Delivery"
                                : `Table ${bill.table_no}`}
                          </span>
                          <span className="text-[10px] font-mono font-bold text-slate-400">
                            #{bill.id.slice(0, 5).toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-medium">
                          {bill.payment_method || "Cash"} · {new Date(bill.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="text-sm font-black text-slate-900">
                          {currencySymbol} {Number(bill.total_amount || 0).toLocaleString()}
                        </span>
                        <div className="w-9 h-9 rounded-xl border border-slate-200 bg-white group-hover:border-orange-500 group-hover:bg-orange-500 group-hover:text-white text-slate-500 flex items-center justify-center transition-all shadow-2xs">
                          <Receipt className="w-4 h-4" />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Payment Modal */}
        {isPaymentModalOpen && activeSettlementOrder && (
          <PaymentModal
            isOpen={isPaymentModalOpen}
            onClose={() => setIsPaymentModalOpen(false)}
            totalAmount={finalGrandTotal}
            currencySymbol={currencySymbol}
            orderType={activeSettlementOrder.order_type}
            onConfirmPayment={handleSettlePayment}
            isSubmitting={isSubmitting}
            initialMethod={paymentModalMethod}
          />
        )}
      </div>

      <PrintReceipt
        kotPrintData={kotPrintData}
        voucherData={voucherData}
        receiptOrder={receiptOrder}
        settings={settings}
        currencySymbol={currencySymbol}
        serviceChargePct={serviceChargePct}
        taxPct={taxPct}
        calculatedDiscount={calculatedDiscount}
        settledBy={cashier.name}
      />
    </ProtectedRoute>
  );
}