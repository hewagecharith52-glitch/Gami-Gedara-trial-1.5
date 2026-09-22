"use client";

import React from "react";
import type { Order, OrderItem } from "@/components/cashier/types";


interface PrintReceiptProps {
    kotPrintData: Order | null;
    voucherData: any | null;
    receiptOrder: Order | null;
    settings: any;
    currencySymbol: string;
    serviceChargePct: number;
    taxPct: number;
    calculatedDiscount: number;
    settledBy?: string;
}

export default function PrintReceipt({
    kotPrintData,
    voucherData,
    receiptOrder,
    settings,
    currencySymbol,
    serviceChargePct,
    taxPct,
    calculatedDiscount,
    settledBy,
}: PrintReceiptProps) {
    if (!kotPrintData && !voucherData && !receiptOrder) return null;

    const printSubtotal = (receiptOrder?.items || []).reduce(
        (sum: number, item: any) => sum + (Number(item.price || 0) * Number(item.quantity || 1)),
        0
    );
    const printIsDineIn = !receiptOrder?.order_type || receiptOrder?.order_type === "dine-in";
    const printServiceCharge = printIsDineIn ? (printSubtotal * serviceChargePct) / 100 : 0;
    const printTax = (printSubtotal * taxPct) / 100;
    const printDiscount = Number(receiptOrder?.discount !== undefined ? receiptOrder.discount : calculatedDiscount);
    const printTotal = Math.max(0, printSubtotal + printServiceCharge + printTax - printDiscount);

    const logoSrc = (settings as any)?.logo_url || "/logo.png";

    const isCompleted = receiptOrder?.status?.toLowerCase() === "completed";
    const notesStr = receiptOrder?.notes || "";
    const paymentMethodStr = receiptOrder?.payment_method || "Cash";
    const isSplitPayment = paymentMethodStr.toLowerCase().includes("split") || notesStr.toLowerCase().includes("split");

    // Parse Cash and Change
    const cashMatch = notesStr.match(/Paid Cash:\s*([0-9.,]+)/i);
    const changeMatch = notesStr.match(/Change:\s*([0-9.,]+)/i);

    const tenderedAmt = cashMatch ? cashMatch[1] : null;
    const changeAmt = changeMatch ? changeMatch[1] : null;

    // Parse Split Payment Details (e.g. Split: Cash 1500 / Card 2000)
    const splitCashMatch = notesStr.match(/Cash[:\s]*([0-9.,]+)/i);
    const splitCardMatch = notesStr.match(/Card[:\s]*([0-9.,]+)/i);

    const splitCashAmt = splitCashMatch ? splitCashMatch[1] : null;
    const splitCardAmt = splitCardMatch ? splitCardMatch[1] : null;

    return (
        <div
            id="print-receipt"
            data-printable="true"
            className="hidden print:block fixed inset-0 top-0 left-0 w-[78mm] min-h-screen bg-white text-black p-2 font-mono text-[13px] leading-tight z-[99999]"
            style={{ fontFamily: "'Courier New', Courier, monospace" }}
        >
            {kotPrintData ? (
                <div className="w-[72mm] font-mono text-black font-bold">
                    <div className="text-center font-black text-base border-b-2 border-dashed border-black pb-2 mb-2">
                        {kotPrintData.notes?.includes("[RUNNING KOT (ADD-ON)]") || kotPrintData.notes?.includes("[RE-ORDER]")
                            ? "*** RUNNING KOT (ADD-ON) ***"
                            : "*** KITCHEN ORDER (KOT) ***"}
                    </div>
                    <div className="flex justify-between font-black text-sm mb-1">
                        <span>
                            {kotPrintData.order_type === "dine-in"
                                ? `TABLE ${kotPrintData.table_no}`
                                : (kotPrintData.order_type || "TAKEAWAY").toUpperCase()}
                        </span>
                        <span>#{kotPrintData.id?.slice(0, 5).toUpperCase()}</span>
                    </div>
                    <div className="text-xs font-bold space-y-0.5 mb-1">
                        {kotPrintData.customer_name && <p>Customer: {kotPrintData.customer_name}</p>}
                        <p>Time: {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                    </div>
                    <div className="border-b-2 border-black my-1"></div>

                    <table className="w-full text-xs font-bold my-2">
                        <thead>
                            <tr className="border-b border-black text-left font-black">
                                <th className="py-1">Item</th>
                                <th className="py-1 text-right">Qty</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(kotPrintData.items || []).map((item: any, i: number) => (
                                <tr key={i} className="border-b border-dotted border-gray-400">
                                    <td className="py-1.5 pr-2 font-black text-sm leading-tight">
                                        {item.name}
                                        {item.notes && (
                                            <span className="block text-[11px] font-normal text-gray-700 italic">
                                                ↳ Note: {item.notes}
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-1.5 text-right font-black text-base">{item.quantity}x</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {kotPrintData.notes && (
                        <div className="border-t border-dashed border-black pt-2 mt-2 text-xs font-bold">
                            * Note: {kotPrintData.notes}
                        </div>
                    )}
                    <div className="border-b-2 border-dashed border-black mt-3 pt-2 text-center text-[11px] font-bold">
                        --- END OF KOT ---
                    </div>
                </div>
            ) : voucherData ? (
                <div className="w-[72mm] font-mono text-black text-center font-bold">
                    <h2 className="text-lg font-black tracking-tight">{settings?.name || "Restaurant POS"}</h2>
                    <p className="text-xs uppercase font-bold border-b border-dashed border-black pb-1 mb-2">Petty Cash Voucher</p>
                    <div className="text-left space-y-1.5 mb-3 text-xs font-bold">
                        <p><strong>Reason:</strong> {voucherData.reason}</p>
                        <p><strong>Received By:</strong> {voucherData.staff_name || voucherData.received_by || "Staff"}</p>
                        <p><strong>Amount:</strong> {currencySymbol} {Number(voucherData.amount).toLocaleString()}</p>
                        <p className="text-[11px] text-gray-700">Date: {new Date(voucherData.created_at || Date.now()).toLocaleString()}</p>
                    </div>
                    <p className="text-[10px] border-t border-dashed border-black pt-4 mt-6">Signature: ______________________</p>
                </div>
            ) : receiptOrder ? (
                <div className="w-[72mm] font-mono text-black font-bold">
                    <div className="text-center mb-2 pb-2 border-b-2 border-dashed border-black">
                        <div className="flex justify-center mb-2">
                            <img
                                src={logoSrc}
                                alt="Logo"
                                className="w-20 h-auto max-h-16 object-contain filter grayscale contrast-200"
                                style={{ imageRendering: "pixelated" }}
                            />
                        </div>
                        <h1 className="text-lg font-black tracking-tight leading-none uppercase">{settings?.name || "Restaurant POS"}</h1>
                        {settings?.tagline && <p className="text-[11px] uppercase tracking-wider mt-0.5">{settings.tagline}</p>}
                        <p className="text-xs mt-0.5">Tel: {settings?.phone || ""}</p>
                    </div>

                    <div className="text-xs mb-2 pb-2 border-b border-dashed border-black space-y-1">
                        <div className="flex justify-between font-black text-[13px]">
                            <span>
                                {receiptOrder.order_type === "takeaway"
                                    ? "ORDER: TAKEAWAY"
                                    : receiptOrder.order_type === "delivery"
                                        ? "ORDER: DELIVERY"
                                        : `TABLE: ${receiptOrder.table_no}`}
                            </span>
                            <span>#{receiptOrder.id.slice(0, 6).toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>CASHIER: {settledBy || receiptOrder.settled_by || "—"}</span>
                            <span>{new Date(receiptOrder.created_at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        {receiptOrder.customer_name && <p>Customer: {receiptOrder.customer_name}</p>}
                        <p className="text-[11px] text-gray-700">Date: {new Date(receiptOrder.created_at || Date.now()).toLocaleDateString()}</p>
                    </div>

                    <table className="w-full text-xs mb-2 border-b border-dashed border-black">
                        <thead>
                            <tr className="border-b border-black text-left font-black">
                                <th className="py-1">Item</th>
                                <th className="py-1 text-center w-8">Qty</th>
                                <th className="py-1 text-right w-16">Amt</th>
                            </tr>
                        </thead>
                        <tbody className="text-xs">
                            {(receiptOrder.items || []).map((item: any, idx: number) => (
                                <tr key={idx} className="border-b border-dotted border-gray-300">
                                    <td className="py-1.5 pr-1 font-bold leading-tight">
                                        {item.name}
                                        {item.notes && (
                                            <span className="block text-[10px] font-normal text-gray-600 italic">
                                                ↳ {item.notes}
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-1.5 text-center font-black">{item.quantity}</td>
                                    <td className="py-1.5 text-right font-black">{(item.price * item.quantity).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="text-xs space-y-1 mb-2 font-bold">
                        <div className="flex justify-between">
                            <span>Subtotal:</span>
                            <span>{currencySymbol} {printSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>

                        {printIsDineIn && (
                            <div className="flex justify-between">
                                <span>Service Charge ({serviceChargePct}%):</span>
                                <span>{currencySymbol} {printServiceCharge.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        )}

                        {taxPct > 0 && (
                            <div className="flex justify-between">
                                <span>Tax ({taxPct}%):</span>
                                <span>{currencySymbol} {printTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        )}

                        {printDiscount > 0 && (
                            <div className="flex justify-between text-rose-600">
                                <span>Discount:</span>
                                <span>-{currencySymbol} {printDiscount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        )}

                        <div className="flex justify-between text-base font-black border-t-2 border-black pt-1 mt-1">
                            <span>TOTAL:</span>
                            <span>{currencySymbol} {printTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>

                        {/* Payment Method Status & Breakdown */}
                        <div className="border-t border-dashed border-black pt-1.5 mt-1.5 space-y-1">
                            <div className="flex justify-between text-xs font-bold">
                                <span>Payment:</span>
                                <span className="uppercase">
                                    {isCompleted ? (isSplitPayment ? "SPLIT (CASH + CARD)" : paymentMethodStr) : "Pending"}
                                </span>
                            </div>

                            {isCompleted && isSplitPayment && (
                                <div className="border-l-2 border-black pl-2 py-0.5 space-y-0.5 text-[11px] font-bold">
                                    {splitCashAmt && (
                                        <div className="flex justify-between">
                                            <span>Paid by Cash:</span>
                                            <span>{currencySymbol} {Number(splitCashAmt.replace(/,/g, "")).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                    )}
                                    {splitCardAmt && (
                                        <div className="flex justify-between">
                                            <span>Paid by Card:</span>
                                            <span>{currencySymbol} {Number(splitCardAmt.replace(/,/g, "")).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {isCompleted && !isSplitPayment && (
                                <>
                                    {tenderedAmt && (
                                        <div className="flex justify-between text-[12px] font-normal">
                                            <span>Cash Tendered:</span>
                                            <span>{currencySymbol} {Number(tenderedAmt.replace(/,/g, "")).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                    )}

                                    {changeAmt !== null && (
                                        <div className="flex justify-between text-[12px] font-black">
                                            <span>Change / Balance:</span>
                                            <span>{currencySymbol} {Number(changeAmt.replace(/,/g, "")).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    <div className="text-center text-xs border-t border-dashed border-black pt-2 mt-2 space-y-1">
                        <p className="font-black tracking-wide">*** THANK YOU COME AGAIN ***</p>
                        <p className="text-[10px] font-bold text-gray-600 tracking-wider">Powered by Gravity House</p>
                    </div>
                </div>
            ) : null}
        </div>
    );
}