import { useSyncExternalStore } from "react";

/** First-visit face seed set; the wider pool unlocks after cycling. */
export const CORE_PROFILE_FACES = [
  "o_O",
  "^_^",
  ">_<",
  "~_~",
  "(._.)",
  "(o_o)",
  "(~_~)",
  "(o_O)",
];

/** Extra faces available only after the user cycles. */
const EXTRA_PROFILE_FACES = [
  "(^_^)",
  "(>_<)",
  "(@_@)",
  "(=_=)",
  "(^o^)",
  "(T_T)",
  "(·_·)",
  "(^.^)",
  "(-_-)",
  "(¬_¬)",
  "(>_>)",
  "(o_<)",
  "@_@",
  "=_=",
  "^o^",
  "._.",
  "o_o",
  "·_·",
  "^.^",
  "-_-",
  "¬_¬",
  "*_*",
  ":)",
  ":D",
  ":P",
  ";)",
  ":O",
  "xD",
  ":/",
  "<3",
  "o.O",
  "=)",
];

/** Full placeholder face pool, with core faces as a strict prefix. */
export const PROFILE_FACES = [...CORE_PROFILE_FACES, ...EXTRA_PROFILE_FACES];

/* Tiny localStorage-backed external store for the active profile face. */

const STORAGE_KEY = "altfun:profileFace";

const pickRandomFace = (pool: readonly string[], exclude?: string): string => {
  const filtered = exclude ? pool.filter((f) => f !== exclude) : pool;
  return filtered[Math.floor(Math.random() * filtered.length)] ?? pool[0];
};

const readInitial = (): string => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Preserve previously selected extra faces across reloads.
    if (stored && PROFILE_FACES.includes(stored)) return stored;
  } catch {
    // Fall through to a fresh random pick without persistence.
  }
  const initial = pickRandomFace(CORE_PROFILE_FACES);
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

/** Pick a new random face from the full pool and notify subscribers. */
export function cycleProfileFace(): void {
  const next = pickRandomFace(PROFILE_FACES, currentFace);
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

/** React hook for the current profile face, including cross-tab updates. */
export function useProfileFace(): string {
  return useSyncExternalStore(subscribe, getProfileFace, getProfileFace);
}
