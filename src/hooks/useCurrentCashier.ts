import { useAuth } from "@/context/AuthContext";
import type { CashierProfile } from "@/context/AuthContext";

/**
 * Returns the currently active cashier's profile.
 * Falls back to a profile derived from `currentUser` for sessions that
 * were created before CashierProfile was introduced.
 */
export function useCurrentCashier(): CashierProfile {
  const { cashierProfile, currentUser } = useAuth();

  if (cashierProfile) return cashierProfile;

  // Backward-compat fallback for existing sessions
  const fallbackName = currentUser || "Cashier";
  return { name: fallbackName, username: fallbackName, role: "Staff" };
}
