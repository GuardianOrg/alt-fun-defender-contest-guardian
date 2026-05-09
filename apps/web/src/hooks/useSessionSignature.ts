import { useCallback, useEffect, useRef, useState } from "react";

import { buildSessionMessage, SESSION_DURATION_MS } from "@launchpad/shared";

import { usePrivyWalletClient } from "./usePrivyWalletClient";
import { useWallet } from "./useWallet";

const STORAGE_KEY_PREFIX = "altfun_session_";

interface StoredSession {
  address: string;
  signature: string;
  expiresAt: number;
}

function getStorageKey(address: string): string {
  return `${STORAGE_KEY_PREFIX}${address.toLowerCase()}`;
}

function loadSession(address: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(getStorageKey(address));
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    if (
      typeof session.address !== "string" ||
      typeof session.signature !== "string" ||
      typeof session.expiresAt !== "number"
    ) {
      return null;
    }
    if (session.address.toLowerCase() !== address.toLowerCase()) return null;
    if (Date.now() >= session.expiresAt) {
      localStorage.removeItem(getStorageKey(address));
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession): void {
  localStorage.setItem(getStorageKey(session.address), JSON.stringify(session));
}

function clearSession(address: string): void {
  localStorage.removeItem(getStorageKey(address));
}

interface SessionSignature {
  signature: string;
  expiresAt: number;
}

/**
 * Manages a persisted session signature so users only need to sign once
 * (per 24-hour window) for actions like profile updates.
 *
 * Returns `getSessionSignature()` which either returns the cached session
 * or prompts the wallet for a new signature and persists it.
 */
export function useSessionSignature() {
  const { address, isConnected } = useWallet();
  const walletClient = usePrivyWalletClient();
  const [session, setSession] = useState<StoredSession | null>(null);
  const signingRef = useRef(false);

  // Load existing session from localStorage on mount or address change
  useEffect(() => {
    if (address) {
      const existing = loadSession(address);
      setSession(existing);
    } else {
      setSession(null);
    }
  }, [address]);

  // Clear session state when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      setSession(null);
    }
  }, [isConnected]);

  const getSessionSignature = useCallback(async (): Promise<SessionSignature> => {
    if (!address) throw new Error("Wallet not connected");
    if (!walletClient) throw new Error("Wallet client not available");

    // Check existing session (re-read from storage in case another tab updated it)
    const existing = loadSession(address);
    if (existing) {
      setSession(existing);
      return { signature: existing.signature, expiresAt: existing.expiresAt };
    }

    // Prevent concurrent signing prompts
    if (signingRef.current) {
      throw new Error("Signing in progress");
    }
    signingRef.current = true;

    try {
      const expiresAt = Date.now() + SESSION_DURATION_MS;
      const message = buildSessionMessage(address, expiresAt);
      const signature = await walletClient.signMessage({ message });

      const newSession: StoredSession = { address, signature, expiresAt };
      saveSession(newSession);
      setSession(newSession);

      return { signature, expiresAt };
    } finally {
      signingRef.current = false;
    }
  }, [address, walletClient]);

  const clearCurrentSession = useCallback(() => {
    if (address) {
      clearSession(address);
      setSession(null);
    }
  }, [address]);

  return {
    /** Whether a valid session signature exists */
    hasSession: session !== null,
    /** Get or create a session signature. Prompts wallet if needed. */
    getSessionSignature,
    /** Explicitly clear the current session */
    clearSession: clearCurrentSession,
  };
}
