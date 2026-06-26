import React, { createContext, useContext, useState, useCallback, useRef } from "react";

export interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info" | "warning";
}

interface ToastContextType {
  toast: (message: string, type?: Toast["type"]) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const MAX_TOASTS = 5;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idCounter = useRef(0);

  const toast = useCallback((message: string, type: Toast["type"] = "info") => {
    idCounter.current += 1;
    const id = idCounter.current;
    setToasts((prev) => {
      const next = [...prev, { id, message, type }];
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-md w-full">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center justify-between rounded-xl px-4 py-3.5 shadow-xl text-white border transition-all duration-300 transform translate-y-0 animate-bounce-short ${
              t.type === "success"
                ? "bg-emerald-600 border-emerald-500/30 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
                : t.type === "error"
                ? "bg-red-600 border-red-500/30 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
                : t.type === "warning"
                ? "bg-amber-500 border-amber-400/30 text-zinc-950 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
                : "bg-zinc-900 border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:border-zinc-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {t.type === "success" && (
                <svg className="h-5 w-5 text-emerald-100 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {t.type === "error" && (
                <svg className="h-5 w-5 text-red-100 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
              {t.type === "warning" && (
                <svg className="h-5 w-5 text-amber-950 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
              {t.type === "info" && (
                <svg className="h-5 w-5 text-zinc-100 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <span className="text-sm font-semibold">{t.message}</span>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="ml-4 rounded-lg hover:bg-white/10 dark:hover:bg-zinc-800 p-1 text-inherit transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
};
