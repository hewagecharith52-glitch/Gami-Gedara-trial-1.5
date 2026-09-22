"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { clearStaffLogin } from "@/app/actions/manager";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CashierProfile {
  name: string;
  username: string;
  role: string;
}

interface AuthState {
  isAuthenticated: boolean;
  currentUser: string | null;
  loginTimestamp: number | null;
  cashierProfile: CashierProfile | null;
}

interface AuthContextType extends AuthState {
  login: (username: string, rememberMe: boolean, profile?: CashierProfile) => void;
  logout: () => void;
  isLoading: boolean;
  isAdminUnlocked: boolean;
  unlockAdmin: () => void;
  lockAdmin: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = "pos_auth_session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    currentUser: null,
    loginTimestamp: null,
    cashierProfile: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);

  // Sync state from storage (also used for cross-tab sync)
  const syncSessionFromStorage = useCallback(() => {
    if (typeof window === "undefined") return;

    const storedSession =
      localStorage.getItem(AUTH_STORAGE_KEY) ||
      sessionStorage.getItem(AUTH_STORAGE_KEY);

    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        if (parsed && parsed.isAuthenticated === true) {
          setAuthState({
            isAuthenticated: true,
            currentUser: parsed.currentUser,
            loginTimestamp: parsed.loginTimestamp,
            cashierProfile: parsed.cashierProfile ?? null,
          });
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.error("Failed to parse auth session", err);
      }
    }

    setAuthState({
      isAuthenticated: false,
      currentUser: null,
      loginTimestamp: null,
      cashierProfile: null,
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    syncSessionFromStorage();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === AUTH_STORAGE_KEY) {
        syncSessionFromStorage();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [syncSessionFromStorage]);

  // -----------------------------------------------------------------------
  // login — accepts optional CashierProfile so name/role are persisted
  // -----------------------------------------------------------------------
  const login = (username: string, rememberMe: boolean, profile?: CashierProfile) => {
    const newSession = {
      isAuthenticated: true,
      currentUser: username,
      loginTimestamp: Date.now(),
      cashierProfile: profile ?? { name: username, username, role: "Staff" },
    };

    setAuthState(newSession);

    if (rememberMe) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newSession));
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      // Persistent cookie for 7 days
      document.cookie = "auth_token=authenticated; path=/; max-age=604800; samesite=lax";
    } else {
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newSession));
      localStorage.removeItem(AUTH_STORAGE_KEY);
      // Transient session cookie (cleared when browser closes)
      document.cookie = "auth_token=authenticated; path=/; samesite=lax";
    }
  };

  const unlockAdmin = useCallback(() => {
    setIsAdminUnlocked(true);
  }, []);

  const lockAdmin = useCallback(() => {
    setIsAdminUnlocked(false);
  }, []);

  const logout = async () => {
    setAuthState({
      isAuthenticated: false,
      currentUser: null,
      loginTimestamp: null,
      cashierProfile: null,
    });
    setIsAdminUnlocked(false);

    localStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem("smart_pos_user");

    // Clear the auth cookie explicitly
    document.cookie = "auth_token=; path=/; max-age=0; samesite=lax";

    try {
      await clearStaffLogin();
    } catch (e) {
      console.error("Error clearing staff login server state", e);
    }

    router.push("/login");
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        logout,
        isLoading,
        isAdminUnlocked,
        unlockAdmin,
        lockAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}