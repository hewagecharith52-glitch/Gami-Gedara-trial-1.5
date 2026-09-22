"use server";

import { supabaseAdmin } from "@/lib/supabase-admin";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import crypto from "crypto";

export type LoginResponse = {
  success: boolean;
  username?: string;
  name?: string;
  role?: string;
  error?: string;
};

export async function verifyStaffLogin(
  username: string,
  pin: string
): Promise<LoginResponse> {
  try {
    const cleanUsername = String(username || "").trim();
    const cleanPin = String(pin || "").trim();

    if (!cleanUsername) {
      return { success: false, error: "Username is required." };
    }
    if (!cleanPin) {
      return { success: false, error: "Password is required." };
    }

    if (!supabaseAdmin) {
      return { success: false, error: "Database configuration missing on server." };
    }

    // Direct database query without complex external calls
    const { data: staffMember, error: dbError } = await supabaseAdmin
      .from("staff")
      .select("username, pin, name, role, is_active")
      .ilike("username", cleanUsername)
      .eq("is_active", true)
      .maybeSingle();

    if (dbError) {
      console.error("Supabase Database Error:", dbError);
      return { success: false, error: "Database connection failed. Please try again." };
    }

    if (!staffMember) {
      return { success: false, error: "Invalid username or password." };
    }

    // Direct string match for PIN
    const isPinCorrect = String(staffMember.pin || "").trim() === cleanPin;

    if (!isPinCorrect) {
      return { success: false, error: "Invalid username or password." };
    }

    // Safe cookie assignment for session
    try {
      const sessionToken = crypto.randomBytes(24).toString("hex");
      const cookieStore = await cookies();
      cookieStore.set({
        name: "auth_token",
        value: sessionToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    } catch (cookieErr) {
      console.warn("Cookie set warning:", cookieErr);
    }

    return {
      success: true,
      username: String(staffMember.username),
      name: String(staffMember.name || staffMember.username),
      role: String(staffMember.role || "Staff"),
    };
  } catch (err: any) {
    console.error("verifyStaffLogin Catch Block:", err);
    return {
      success: false,
      error: "Authentication service error. Please contact administrator.",
    };
  }
}

/**
 * Verify a staff member by PIN only (no username required).
 * Uses supabaseAdmin to bypass RLS. Intended for cashier handover flows.
 */
export async function verifyStaffByPin(pin: string): Promise<LoginResponse> {
  try {
    const cleanPin = String(pin || "").trim();
    console.log("[verifyStaffByPin] Entered PIN:", cleanPin);

    if (!cleanPin) {
      return { success: false, error: "PIN is required." };
    }

    if (!supabaseAdmin) {
      return { success: false, error: "Database configuration missing on server." };
    }

    const { data: staffList, error: dbError } = await supabaseAdmin
      .from("staff")
      .select("username, pin, name, role, is_active")
      .eq("is_active", true);

    console.log("[verifyStaffByPin] Staff query result:", staffList, "Error:", dbError);

    if (dbError) {
      console.error("[verifyStaffByPin] DB error:", dbError);
      return { success: false, error: "Database connection failed. Please try again." };
    }

    const match = (staffList ?? []).find(
      (s: any) => String(s.pin ?? "").trim() === cleanPin
    );

    if (!match) {
      console.log("[verifyStaffByPin] No match found for PIN:", cleanPin);
      return { success: false, error: "No active staff member found with that PIN." };
    }

    return {
      success: true,
      username: String(match.username),
      name: String(match.name || match.username),
      role: String(match.role || "Staff"),
    };
  } catch (err: any) {
    console.error("[verifyStaffByPin] Catch block:", err);
    return { success: false, error: "Verification failed. Please try again." };
  }
}


export type VoidResponse = {
  success: boolean;
  error?: string;
};

export async function verifyManagerPinAndVoid(
  targetId: string,
  pin: string,
  rawReason: string
): Promise<VoidResponse> {
  try {
    if (!targetId || !pin || !rawReason) {
      return { success: false, error: "Missing required fields." };
    }

    const cleanPin = String(pin).trim();
    const cleanReason = String(rawReason).replace(/[<>]/g, "").trim();

    if (!supabaseAdmin) {
      return { success: false, error: "Database configuration missing on server." };
    }

    const { data: setting, error: settingErr } = await supabaseAdmin
      .from("restaurant_settings")
      .select("void_pin")
      .limit(1)
      .maybeSingle();

    if (settingErr || !setting || !setting.void_pin) {
      return { success: false, error: "Void PIN configuration not found." };
    }

    if (String(setting.void_pin).trim() !== cleanPin) {
      return { success: false, error: "Invalid manager PIN." };
    }

    const { error: dbError } = await supabaseAdmin
      .from("petty_cash_logs")
      .update({
        is_voided: true,
        void_reason: cleanReason,
        voided_by: "Manager",
        voided_at: new Date().toISOString(),
      })
      .eq("id", targetId);

    if (dbError) {
      return { success: false, error: "Failed to void entry in database." };
    }

    revalidatePath("/analytics");
    revalidatePath("/cashier");

    return { success: true };
  } catch (err: any) {
    return { success: false, error: "Failed to process void operation." };
  }
}

export async function clearStaffLogin(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete("auth_token");
  } catch { }
}