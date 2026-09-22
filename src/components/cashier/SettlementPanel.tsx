"use client";

import React, { useEffect, useState } from "react";
import { Receipt, Printer, User, TrendingUp, Banknote, CreditCard as CardIcon } from "lucide-react";
import { Order, OrderItem } from "./types";
import { useSettings } from "@/context/SettingsContext";

export interface CashierDaySummary {
    cashierName: string;
    cash: number;
    card: number;
    split: number;
    total: number;
}

interface SettlementPanelProps {
    activeSettlementOrder: Order | null;
    currencySymbol: string;
    taxPct: number;
    serviceChargePct: number;
    discountType: "percent" | "fixed";
    discountValue: number;
    subtotal: number;
    calculatedDiscount: number;
    serviceCharge: number;
    tax: number;
    grandTotal: number;
    setDiscountType: (type: "percent" | "fixed") => void;
    setDiscountValue: (val: number) => void;
    onOpenCustomDiscountModal: () => void;
    onPrintGuestBill: (order: Order) => void;
    onSelectPaymentMethod: (method: string) => void;
    onInstantCardPay: () => void;
    daySummary?: CashierDaySummary[];
    activeCashierName?: string;
}

export const SettlementPanel: React.FC<SettlementPanelProps> = ({
    activeSettlementOrder,
    currencySymbol,
    taxPct,
    serviceChargePct,
    discountType,
    discountValue,
    subtotal,
    calculatedDiscount,
    serviceCharge,
    tax,
    grandTotal,
    setDiscountType,
    setDiscountValue,
    onOpenCustomDiscountModal,
    onPrintGuestBill,
    onSelectPaymentMethod,
    onInstantCardPay,
    daySummary = [],
    activeCashierName,
}) => {
    const { settings } = useSettings();
    const [logoError, setLogoError] = useState(false);

    const isDineIn =
        Boolean(activeSettlementOrder) &&
        (!activeSettlementOrder?.order_type ||
            activeSettlementOrder?.order_type === "dine-in");

    // F1 - F4 Shortcuts Listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "F1") {
                e.preventDefault();
                if (activeSettlementOrder && isDineIn) {
                    onPrintGuestBill({
                        ...activeSettlementOrder,
                        discount: calculatedDiscount,
                        total_amount: grandTotal,
                    });
                }
            }
            if (e.key === "F2") {
                e.preventDefault();
                if (activeSettlementOrder) onSelectPaymentMethod("Cash");
            }
            if (e.key === "F3") {
                e.preventDefault();
                if (activeSettlementOrder) onInstantCardPay();
            }
            if (e.key === "F4") {
                e.preventDefault();
                if (activeSettlementOrder) onSelectPaymentMethod("Split");
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
        activeSettlementOrder,
        isDineIn,
        calculatedDiscount,
        grandTotal,
        onPrintGuestBill,
        onSelectPaymentMethod,
        onInstantCardPay,
    ]);

    // Consolidate identical items
    const consolidateItems = (items: OrderItem[]) => {
        const map = new Map<string, OrderItem>();
        items.forEach((item) => {
            const key = `${item.id}-${(item.notes || "").trim()}`;
            if (map.has(key)) {
                const existing = map.get(key)!;
                existing.quantity += item.quantity;
            } else {
                map.set(key, { ...item });
            }
        });
        return Array.from(map.values());
    };

    const s = settings as any;
    const restaurantName = s?.restaurant_name || s?.name || "Restaurant POS";
    const restaurantPhone = s?.phone || s?.contact_number || "";
    const logoSrc = s?.receipt_logo || s?.logo_url || s?.logo || "/logo.png";

    const orderDate = activeSettlementOrder?.created_at
        ? new Date(activeSettlementOrder.created_at)
        : new Date();

    const formattedDate = `${orderDate.getMonth() + 1}/${orderDate.getDate()}/${orderDate.getFullYear()}`;
    const formattedTime = orderDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return (
        <div className="col-span-12 lg:col-span-3 xl:col-span-3 bg-white border border-purple-200/80 rounded-3xl flex flex-col justify-between shadow-[0_0_25px_rgba(139,92,246,0.08)] overflow-hidden h-full">
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header - Modern Soft Violet Theme with Order & Customer Badges */}
                <div className="px-4 py-2.5 bg-gradient-to-r from-[#8b5cf6] to-[#7c3aed] flex justify-between items-center shrink-0 shadow-xs">
                    <div className="flex items-center gap-2">
                        <h2 className="font-black text-white text-xs sm:text-sm uppercase tracking-wider drop-shadow-xs">
                            SETTLEMENT
                        </h2>
                        {activeSettlementOrder?.id === "DIRECT-STAGED" && (
                            <span className="text-[9px] font-black uppercase text-amber-900 bg-amber-200 px-2 py-0.5 rounded-full shadow-2xs">
                                Direct
                            </span>
                        )}
                    </div>
                    {activeSettlementOrder && (
                        <div className="flex items-center gap-1.5">
                            {activeSettlementOrder.customer_name && (
                                <span className="text-[10px] font-black text-white bg-white/20 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/30 truncate max-w-[90px] sm:max-w-[110px] flex items-center gap-1">
                                    <User className="w-2.5 h-2.5 inline shrink-0" />
                                    <span className="truncate">{activeSettlementOrder.customer_name}</span>
                                </span>
                            )}
                            <span className="text-[11px] font-black text-[#6d28d9] bg-white px-2.5 py-0.5 rounded-full shadow-xs">
                                {activeSettlementOrder.order_type === "takeaway"
                                    ? "Takeaway"
                                    : activeSettlementOrder.order_type === "delivery"
                                        ? "Delivery"
                                        : `T${activeSettlementOrder.table_no}`}
                            </span>
                        </div>
                    )}
                </div>

                {activeSettlementOrder ? (
                    <div className="flex-1 flex flex-col justify-between overflow-hidden p-3 pb-0">
                        {/* REALISTIC THERMAL BILL PREVIEW CARD */}
                        <div className="flex-1 overflow-y-auto no-scrollbar bg-[#fcfcfc] border border-slate-200 rounded-xl p-3 shadow-inner flex flex-col justify-between font-mono text-[11px] leading-tight text-slate-900 mb-2">
                            <div>
                                {/* Logo & Header */}
                                <div className="text-center pb-2 border-b border-dashed border-slate-400 mb-2">
                                    {!logoError && (
                                        <div className="flex justify-center mb-1">
                                            <img
                                                src={logoSrc}
                                                alt="Restaurant Logo"
                                                className="h-12 max-w-[130px] object-contain mx-auto"
                                                onError={() => setLogoError(true)}
                                            />
                                        </div>
                                    )}
                                    <h3 className="font-black text-sm tracking-wider uppercase font-sans text-slate-950">
                                        {restaurantName}
                                    </h3>
                                    <p className="text-[10px] font-bold text-slate-600">SMART POS</p>
                                    <p className="text-[10px] text-slate-700">Tel: {restaurantPhone}</p>
                                </div>

                                {/* Order & Table & Customer Info */}
                                <div className="space-y-1 pb-1.5 border-b border-dashed border-slate-400 mb-2 text-[10px]">
                                    <div className="flex justify-between font-bold">
                                        <span>
                                            {activeSettlementOrder.order_type === "takeaway"
                                                ? "TYPE: TAKEAWAY"
                                                : activeSettlementOrder.order_type === "delivery"
                                                    ? "TYPE: DELIVERY"
                                                    : `TABLE: ${activeSettlementOrder.table_no}`}
                                        </span>
                                        <span className="font-black">
                                            #{activeSettlementOrder.id.slice(0, 6).toUpperCase()}
                                        </span>
                                    </div>

                                    {/* Customer Name Display in Preview */}
                                    {activeSettlementOrder.customer_name && (
                                        <div className="flex justify-between font-black text-slate-900 bg-slate-100/80 px-1 py-0.5 rounded">
                                            <span className="text-slate-600">CUSTOMER:</span>
                                            <span className="uppercase">{activeSettlementOrder.customer_name}</span>
                                        </div>
                                    )}

                                    <div className="flex justify-between text-slate-700">
                                        <span>CASHIER: {activeCashierName || "—"}</span>
                                        <span>{formattedTime}</span>
                                    </div>
                                    <div className="text-slate-700">
                                        Date: {formattedDate}
                                    </div>
                                </div>

                                {/* Items Header */}
                                <div className="flex justify-between font-black border-b border-slate-900 pb-1 mb-1.5 text-[10px] uppercase">
                                    <span className="flex-1">Item</span>
                                    <span className="w-10 text-center">Qty</span>
                                    <span className="w-14 text-right">Amt</span>
                                </div>

                                {/* Items Rows */}
                                <div className="divide-y divide-dashed divide-slate-200">
                                    {consolidateItems(activeSettlementOrder.items || []).map((item, idx) => (
                                        <div key={idx} className="py-1 flex justify-between items-start text-[10px]">
                                            <div className="flex-1 pr-1">
                                                <span className="font-bold text-slate-900 block break-words">
                                                    {item.name}
                                                </span>
                                                {item.notes && (
                                                    <span className="text-[9px] text-slate-500 italic block">
                                                        ↳ {item.notes}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="w-10 text-center font-bold text-slate-800">
                                                {item.quantity}
                                            </span>
                                            <span className="w-14 text-right font-black text-slate-900">
                                                {(item.price * item.quantity).toLocaleString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Totals Breakdown Inside Bill */}
                            <div className="pt-2 border-t border-dashed border-slate-400 mt-2 space-y-1 text-[10px]">
                                <div className="flex justify-between text-slate-700">
                                    <span className="font-bold">Subtotal:</span>
                                    <span className="font-bold">
                                        {currencySymbol} {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </div>

                                {serviceChargePct > 0 && isDineIn && (
                                    <div className="flex justify-between text-slate-700">
                                        <span>Service Charge ({serviceChargePct}%):</span>
                                        <span>
                                            {currencySymbol} {serviceCharge.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                )}

                                {taxPct > 0 && (
                                    <div className="flex justify-between text-slate-700">
                                        <span>Tax ({taxPct}%):</span>
                                        <span>
                                            {currencySymbol} {tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                )}

                                {calculatedDiscount > 0 && (
                                    <div className="flex justify-between text-rose-600 font-bold">
                                        <span>Discount:</span>
                                        <span>
                                            -{currencySymbol} {calculatedDiscount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                )}

                                <div className="flex justify-between items-baseline font-black text-xs pt-1.5 border-t-2 border-slate-900 text-slate-950">
                                    <span className="text-xs uppercase">TOTAL:</span>
                                    <span className="text-sm">
                                        {currencySymbol} {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </div>

                                <div className="flex justify-between text-[10px] text-slate-600 pt-1 border-t border-dashed border-slate-300">
                                    <span>Payment:</span>
                                    <span className="font-bold uppercase">Pending</span>
                                </div>

                                {/* Bill Footer */}
                                <div className="text-center pt-2 text-[9px] text-slate-600 space-y-0.5">
                                    <p className="font-black">*** THANK YOU COME AGAIN ***</p>
                                    <p className="text-[8px] text-slate-400">Powered by Gravity House</p>
                                </div>
                            </div>
                        </div>

                        {/* Bottom Actions Section */}
                        <div className="space-y-1.5 pt-1 shrink-0 bg-white">
                            {/* Discount Bar */}
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                                    DISCOUNT
                                </span>
                                <button
                                    type="button"
                                    onClick={onOpenCustomDiscountModal}
                                    className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer"
                                >
                                    Custom %
                                </button>
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                                {[0, 5, 10].map((pct) => (
                                    <button
                                        key={pct}
                                        type="button"
                                        onClick={() => {
                                            setDiscountType("percent");
                                            setDiscountValue(pct);
                                        }}
                                        className={`py-1 rounded-xl text-xs font-bold border cursor-pointer transition-all ${discountType === "percent" && discountValue === pct
                                            ? "bg-orange-500 border-orange-500 text-white shadow-xs"
                                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                            }`}
                                    >
                                        {pct}%
                                    </button>
                                ))}
                            </div>

                            {/* Print Guest Bill Button with F1 Badge */}
                            {isDineIn && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        onPrintGuestBill({
                                            ...activeSettlementOrder,
                                            discount: calculatedDiscount,
                                            total_amount: grandTotal,
                                        })
                                    }
                                    className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                    title="Shortcut: Press F1"
                                >
                                    <Printer className="w-3.5 h-3.5 text-slate-500" />
                                    <span>Print Bill (Guest Check)</span>
                                    <span className="text-[10px] bg-slate-200 text-slate-700 font-black px-1.5 py-0.5 rounded ml-1">
                                        F1
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center py-10 p-3.5">
                        <Receipt className="w-10 h-10 opacity-20 mb-2" />
                        <p className="font-bold text-xs">No order selected for settlement</p>
                    </div>
                )}
            </div>

            {/* Payment Action Buttons */}
            <div className="p-3.5 pt-2 border-t border-slate-100 shrink-0 mt-1 bg-white">
                <span className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                    INSTANT SETTLE VIA
                </span>
                <div className="grid grid-cols-3 gap-2">
                    {/* Cash */}
                    <button
                        type="button"
                        onClick={() => onSelectPaymentMethod("Cash")}
                        disabled={!activeSettlementOrder}
                        className="py-2.5 rounded-2xl bg-[#10b981]/90 hover:bg-[#10b981] text-white font-black text-xs transition-all active:scale-95 disabled:opacity-40 cursor-pointer shadow-sm hover:shadow-md hover:shadow-emerald-400/20 flex flex-col items-center justify-center gap-0.5"
                    >
                        <span className="text-[13px] tracking-wide font-extrabold drop-shadow-xs">Cash</span>
                        <span className="text-[10px] text-emerald-100 font-bold">F2</span>
                    </button>

                    {/* Card */}
                    <button
                        type="button"
                        onClick={onInstantCardPay}
                        disabled={!activeSettlementOrder}
                        className="py-2.5 rounded-2xl bg-[#3b82f6]/90 hover:bg-[#3b82f6] text-white font-black text-xs transition-all active:scale-95 disabled:opacity-40 cursor-pointer shadow-sm hover:shadow-md hover:shadow-blue-400/20 flex flex-col items-center justify-center gap-0.5"
                    >
                        <span className="text-[13px] tracking-wide font-extrabold drop-shadow-xs">Card</span>
                        <span className="text-[10px] text-blue-100 font-bold">F3</span>
                    </button>

                    {/* Split */}
                    <button
                        type="button"
                        onClick={() => onSelectPaymentMethod("Split")}
                        disabled={!activeSettlementOrder}
                        className="py-2.5 rounded-2xl bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-black text-xs transition-all active:scale-95 disabled:opacity-40 cursor-pointer shadow-sm hover:shadow-md hover:shadow-purple-400/20 flex flex-col items-center justify-center gap-0.5"
                    >
                        <span className="text-[13px] tracking-wide font-extrabold drop-shadow-xs">Split</span>
                        <span className="text-[10px] text-purple-100 font-bold">F4</span>
                    </button>
                </div>
            </div>

            {/* Today's Cashier Day-End Summary */}
            {daySummary.length > 0 && (() => {
                const grandCash = daySummary.reduce((s, r) => s + r.cash, 0);
                const grandCard = daySummary.reduce((s, r) => s + r.card, 0);
                const grandTotal = daySummary.reduce((s, r) => s + r.total, 0);
                return (
                    <div className="px-3.5 pb-3.5 shrink-0 bg-white border-t border-slate-100">
                        <div className="flex items-center gap-1.5 py-2">
                            <TrendingUp className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Today's Cashier Summary</span>
                        </div>
                        <div className="rounded-2xl border border-slate-100 overflow-hidden text-[10px] font-bold">
                            {/* Header row */}
                            <div className="grid grid-cols-4 bg-slate-50 px-2 py-1.5 border-b border-slate-100 text-[9px] uppercase tracking-wider text-slate-400 font-black">
                                <span>Cashier</span>
                                <span className="text-right flex items-center justify-end gap-0.5"><Banknote className="w-2.5 h-2.5" />Cash</span>
                                <span className="text-right flex items-center justify-end gap-0.5"><CardIcon className="w-2.5 h-2.5" />Card</span>
                                <span className="text-right">Total</span>
                            </div>
                            {/* Per-cashier rows */}
                            {daySummary.map((row, i) => (
                                <div key={i} className="grid grid-cols-4 px-2 py-1.5 border-b border-dashed border-slate-100 last:border-b-0 text-slate-700 hover:bg-slate-50 transition-colors">
                                    <span className="truncate font-black text-slate-800 pr-1" title={row.cashierName}>{row.cashierName}</span>
                                    <span className="text-right text-emerald-700">{row.cash > 0 ? row.cash.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</span>
                                    <span className="text-right text-blue-700">{row.card > 0 ? row.card.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</span>
                                    <span className="text-right font-black text-slate-900">{row.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>
                            ))}
                            {/* Grand Total row */}
                            <div className="grid grid-cols-4 px-2 py-1.5 bg-violet-50 border-t-2 border-violet-200 text-[10px] font-black text-violet-900">
                                <span>GRAND</span>
                                <span className="text-right">{grandCash > 0 ? grandCash.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</span>
                                <span className="text-right">{grandCard > 0 ? grandCard.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</span>
                                <span className="text-right">{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            </div>
                        </div>
                        <p className="text-[9px] text-slate-400 text-center mt-1.5 font-medium">{currencySymbol} amounts · today only</p>
                    </div>
                );
            })()}
        </div>
    );
};