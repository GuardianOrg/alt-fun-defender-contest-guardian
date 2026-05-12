import { useSyncExternalStore } from "react";

/**
 * Pool of placeholder ASCII faces used as a stand-in for the user's
 * profile avatar — a mix of Japanese-style kaomoji and shorter Western
 * emoticons.
 *
 * Prototype only — real avatars (gradient by address, ENS pfp, …)
 * will replace this once the profile flow is wired up.
 */
export const PROFILE_FACES = [
  "(o_O)",
  "(^_^)",
  "(>_<)",
  "(@_@)",
  "(=_=)",
  "(^o^)",
  "(T_T)",
  "(._.)",
  "(o_o)",
  "(~_~)",
  "(·_·)",
  "(^.^)",
  "(-_-)",
  "(¬_¬)",
  "(^_~)",
  "(>_>)",
  "(o_<)",
  ":)",
  ":D",
  ":P",
  ";)",
  ":O",
  "xD",
  ":3",
  "B)",
  ":/",
  "<3",
  "^^",
  "o.O",
  ">:)",
  "=)",
  ":-)",
  ":'D",
  ";P",
  ";_;",
  "*_*",
  "^_^",
  ">_<",
  "@_@",
  "=_=",
  "^o^",
  "._.",
  "o_o",
  "~_~",
  "·_·",
  "^.^",
  "-_-",
  "¬_¬",
];

/* Tiny external store for the active profile face.
 *
 * Persisted in localStorage so a face the user picks on the profile
 * page survives reloads and becomes their identity across the app
 * (header chip + profile hero share the same selection). Wrapped in
 * React's `useSyncExternalStore` so any consumer re-renders the
 * moment the face changes — no prop drilling, no Redux slice for a
 * single string.
 *
 * Cross-tab sync: a `storage` event listener picks up writes made in
 * other tabs of the same origin, so changing the face in one tab
 * updates the header avatar in the others. */

const STORAGE_KEY = "altfun:profileFace";

const pickRandomFace = (exclude?: string): string => {
  const pool = exclude
    ? PROFILE_FACES.filter((f) => f !== exclude)
    : PROFILE_FACES;
  return pool[Math.floor(Math.random() * pool.length)] ?? PROFILE_FACES[0];
};

const readInitial = (): string => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && PROFILE_FACES.includes(stored)) return stored;
  } catch {
    // localStorage unavailable (SSR, sandboxed iframe, disabled storage)
    // — fall through to a fresh random pick without persistence.
  }
  const initial = pickRandomFace();
  try {
    window.localStorage.setItem(STORAGE_KEY, initial);
  } catch {
    // Best-effort persistence; ignore failures.
  }
  return initial;
};

let currentFace =
  typeof window === "undefined" ? PROFILE_FACES[0] : readInitial();
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((l) => l());
};

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    if (!PROFILE_FACES.includes(e.newValue)) return;
    currentFace = e.newValue;
    emit();
  });
}

/** Read the current face without subscribing (one-shot, non-reactive). */
export function getProfileFace(): string {
  return currentFace;
}

/**
 * Pick a new random face (different from the current one), persist
 * it, and notify subscribers. No-op if the pool collapses to a single
 * entry.
 */
export function cycleProfileFace(): void {
  const next = pickRandomFace(currentFace);
  if (next === currentFace) return;
  currentFace = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Best-effort persistence.
  }
  emit();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * React hook returning the current profile face, re-rendering the
 * caller whenever it changes (in this tab or another).
 */
export function useProfileFace(): string {
  return useSyncExternalStore(subscribe, getProfileFace, getProfileFace);
}
