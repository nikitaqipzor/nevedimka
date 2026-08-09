"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { FullScreenMessage } from "./FullScreenMessage";

interface AuthState {
  status: "loading" | "ready" | "error";
  error?: string;
}

const AuthContext = createContext<AuthState>({ status: "loading" });

export function useAuthStatus(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const tg = window.Telegram?.WebApp;
        tg?.ready();
        tg?.expand();
        // Best-effort — older Telegram clients may not support these calls.
        try {
          tg?.setBackgroundColor?.("#111316");
          tg?.setHeaderColor?.("#111316");
        } catch {
          /* non-fatal */
        }

        const res = await fetch("/api/auth/miniapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: tg?.initData ?? "" }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}) as { message?: string });
          throw new Error(data.message ?? "Не удалось подключиться");
        }
        if (!cancelled) setState({ status: "ready" });
      } catch (err) {
        if (!cancelled) setState({ status: "error", error: (err as Error).message });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <FullScreenMessage eyebrow="Невидимка" title="Подключение…" />;
  }
  if (state.status === "error") {
    return (
      <FullScreenMessage
        eyebrow="Невидимка"
        title="Не удалось подключиться"
        subtitle={state.error}
      />
    );
  }
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
