"use client";

import { useState, Suspense } from "react";
import { useAuth } from "@/context/AuthContext";
import { verifyStaffLogin } from "@/app/actions/manager";
import { MonitorDot, User, KeyRound, Check, Eye, EyeOff, AlertCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Safe internal redirection validation
  const rawRedirect = searchParams.get("redirect") || "/cashier";
  const redirectTarget = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/cashier";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setError(false);

    try {
      const result = await verifyStaffLogin(username, password);

      if (result.success && result.username) {
        login(result.username, rememberMe, {
          name: result.username,
          username: username,
          role: result.role || "Staff",
        });
        showToast(`Welcome back, ${result.username}!`, "success");

        setTimeout(() => {
          router.replace(redirectTarget);
        }, 800);
      } else {
        setError(true);
        setPassword("");
        showToast(result.error || "Invalid username or password. Please try again.", "error");
      }
    } catch (err: any) {
      console.error("Login client error:", err);
      setError(true);
      showToast("A network or server error occurred. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <style>{`
        @keyframes login-shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-login-shake {
          animation: login-shake 0.4s ease-in-out;
        }
      `}</style>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full shadow-xl shadow-slate-900/20 font-bold text-sm z-50 animate-in fade-in slide-in-from-top-4 flex items-center gap-2 whitespace-nowrap">
          {toastMessage.type === "success" ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400" />
          )}
          {toastMessage.text}
        </div>
      )}

      <div className={`max-w-sm w-full p-6 sm:p-8 rounded-3xl bg-white shadow-xl border border-slate-100 flex flex-col transition-all ${error ? "animate-login-shake border-rose-200" : ""}`}>
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/20 mb-4">
            <MonitorDot className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Smart POS</h1>
          <p className="text-slate-500 text-sm font-medium mt-1">Staff Authentication</p>
        </div>

        {/* Auth Form */}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Username / Staff Name</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                <User className="w-5 h-5" />
              </div>
              <input
                type="text"
                value={username}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(false);
                }}
                placeholder="e.g. admin or cashier"
                className={`w-full pl-11 pr-4 py-3.5 rounded-2xl border ${error
                  ? "border-rose-300 bg-rose-50 text-rose-700 focus:ring-rose-200"
                  : "border-slate-200 bg-slate-50 text-slate-900 focus:border-orange-500 focus:ring-orange-200"
                  } focus:outline-none focus:ring-4 font-semibold transition-all`}
                required
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                <KeyRound className="w-5 h-5" />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(false);
                }}
                placeholder="Enter password"
                className={`w-full pl-11 pr-12 py-3.5 rounded-2xl border ${error
                  ? "border-rose-300 bg-rose-50 text-rose-700 focus:ring-rose-200"
                  : "border-slate-200 bg-slate-50 text-slate-900 focus:border-orange-500 focus:ring-orange-200"
                  } focus:outline-none focus:ring-4 font-semibold transition-all`}
                required
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {error && (
              <p className="text-rose-600 text-xs font-semibold mt-2 text-center">
                ❌ Invalid username or password. Please try again.
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer group mt-2 ml-1 w-max">
            <div
              className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${rememberMe ? "bg-orange-500 border-orange-500 text-white" : "bg-white border-slate-300 group-hover:border-orange-500"
                }`}
            >
              {rememberMe && <Check className="w-3.5 h-3.5" />}
            </div>
            <span className="text-sm font-semibold text-slate-600 select-none">Remember this device</span>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="hidden"
            />
          </label>

          <button
            type="submit"
            disabled={isLoading || !username || !password}
            className="mt-4 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-50 text-white font-bold py-4 rounded-2xl transition-all shadow-md shadow-orange-500/20 text-lg flex items-center justify-center active:scale-[0.98]"
          >
            {isLoading ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              "Sign In to POS"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center font-bold">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}