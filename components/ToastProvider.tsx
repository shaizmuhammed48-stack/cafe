"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss. Errors default to a longer dwell time. */
  durationMs?: number;
}

interface ToastRecord extends Required<Pick<ToastInput, "tone" | "title">> {
  id: number;
  description?: string;
}

interface ToastContextValue {
  showToast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_META: Record<ToastTone, { icon: string; accent: string; border: string }> = {
  success: { icon: "check_circle", accent: "text-primary", border: "border-primary/30" },
  info: { icon: "info", accent: "text-secondary", border: "border-secondary/30" },
  error: { icon: "error", accent: "text-error", border: "border-error/40" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const counter = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    ({ tone = "info", title, description, durationMs }: ToastInput) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current.slice(-2), { id, tone, title, description }]);

      const timeout = durationMs ?? (tone === "error" ? 6500 : 3200);
      const timer = setTimeout(() => dismiss(id), timeout);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-4 top-20 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6"
      >
        {toasts.map((toast) => {
          const meta = TONE_META[toast.tone];
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-full border ${meta.border} bg-surface-container-high/95 px-5 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.8)] backdrop-blur-xl animate-toast-in`}
            >
              <span className={`material-symbols-outlined text-[20px] ${meta.accent}`}>
                {meta.icon}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="font-label-md text-label-md font-semibold text-on-surface">
                  {toast.title}
                </span>
                {toast.description ? (
                  <span className="font-body-sm text-body-sm text-secondary">
                    {toast.description}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
                className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a <ToastProvider>.");
  }
  return context;
}
