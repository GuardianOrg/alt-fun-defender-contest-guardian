import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "altfun:recentlyViewed";
const MAX_ENTRIES = 8;

function readFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function writeToStorage(addresses: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
  } catch {
    // Ignore quota / privacy errors — recently viewed is best-effort.
  }
}

export function useRecentlyViewed(): string[] {
  const [addresses, setAddresses] = useState<string[]>(() => readFromStorage());

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setAddresses(readFromStorage());
    };
    const custom = () => setAddresses(readFromStorage());
    window.addEventListener("storage", handler);
    window.addEventListener("altfun:recentlyViewed", custom);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("altfun:recentlyViewed", custom);
    };
  }, []);

  return addresses;
}

export function useTrackRecentlyViewed(address: string | undefined) {
  const track = useCallback(() => {
    if (!address) return;
    const normalized = address.toLowerCase();
    const current = readFromStorage();
    const next = [
      normalized,
      ...current.filter((a) => a.toLowerCase() !== normalized),
    ].slice(0, MAX_ENTRIES);
    writeToStorage(next);
    window.dispatchEvent(new Event("altfun:recentlyViewed"));
  }, [address]);

  useEffect(() => {
    track();
  }, [track]);
}
