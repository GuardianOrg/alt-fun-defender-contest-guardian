import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import styles from "./Toast.module.css";
import { cn, shortenAddress } from "../../utils/format";

export interface ToastAction {
  label: string;
  href: string;
}

export interface Toast {
  id: number;
  variant: "success" | "error";
  title: string;
  subtitle?: string;
  action?: ToastAction;
  /** Auto-dismiss timeout in ms. Defaults to 6000. Set to `0` to disable. */
  duration?: number;
}

interface ToastContextValue {
  pushToast: (toast: Omit<Toast, "id">) => number;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...toast, id }]);
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast, dismissToast }}>
      {children}
      <div className={styles.viewport} role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const duration = toast.duration ?? DEFAULT_DURATION;

  useEffect(() => {
    if (duration <= 0) return;
    const t = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(t);
  }, [duration, onDismiss, toast.id]);

  return (
    <div
      className={cn(
        styles.toast,
        toast.variant === "success" && styles.toastSuccess,
        toast.variant === "error" && styles.toastError,
      )}
      role="status"
      aria-live="polite"
    >
      <div className={styles.iconWrap}>
        {toast.variant === "success" ? <SuccessIcon /> : <ErrorIcon />}
      </div>
      <div className={styles.body}>
        <div className={styles.title}>{toast.title}</div>
        {toast.subtitle && (
          <div className={styles.subtitle}>{toast.subtitle}</div>
        )}
        {toast.action && (
          <a
            className={styles.action}
            href={toast.action.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {toast.action.label}
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
      </div>
      <button
        type="button"
        className={styles.close}
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function SuccessIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12.5 11 15.5 16.5 9.5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12" y2="16.01" />
    </svg>
  );
}

/**
 * Build the standard "View tx" action that links to the HyperEVM explorer.
 * Centralised so all trade toasts use a consistent label + url shape; the
 * caller passes the raw hash and the helper handles formatting.
 */
export function buildTxAction(txHash: string): ToastAction {
  return {
    label: `View tx ${shortenAddress(txHash)}`,
    href: `https://hyperevmscan.io/tx/${txHash}`,
  };
}
