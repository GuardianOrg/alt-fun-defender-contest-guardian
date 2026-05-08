import { createContext, useContext } from "react";

import { shortenAddress } from "../../utils/format";

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

export interface ToastContextValue {
  pushToast: (toast: Omit<Toast, "id">) => number;
  dismissToast: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
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
