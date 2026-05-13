import { useSyncExternalStore } from "react";

/**
 * Curated subset of `PROFILE_FACES` that a brand-new user is seeded
 * with on their first visit (see `readInitial`). Trimmed to a small
 * "house style" set — straightforward kaomoji, no Western-style
 * emoticons — so the first-impression avatar reads as a recognisable
 * identity rather than a random roll across the full novelty pool.
 * The wider pool only unlocks once the user clicks the change-face
 * button on the profile page.
 */
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

/**
 * Extras layered on top of the core seed set. The change-face button
 * cycles across `[...CORE, ...EXTRAS]`, so anything added here becomes
 * reachable from the profile page but never appears as a fresh
 * user's starting avatar.
 */
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
  "(^_~)",
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
  ":3",
  "B)",
  ":/",
  "<3",
  "o.O",
  "=)",
  ":-)",
  ":'D",
];

/**
 * Full pool of placeholder ASCII faces — core seed faces plus the
 * wider novelty pool that `cycleProfileFace()` rolls across. Order is
 * `[...CORE, ...EXTRA]` so the seed set is guaranteed to be a strict
 * prefix subset; `pickRandomFace` can take either as a `pool` arg
 * without worrying about overlap.
 *
 * Prototype only — real avatars (gradient by address, ENS pfp, …)
 * will replace this once the profile flow is wired up.
 */
export const PROFILE_FACES = [...CORE_PROFILE_FACES, ...EXTRA_PROFILE_FACES];

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

const pickRandomFace = (pool: readonly string[], exclude?: string): string => {
  const filtered = exclude ? pool.filter((f) => f !== exclude) : pool;
  return filtered[Math.floor(Math.random() * filtered.length)] ?? pool[0];
};

const readInitial = (): string => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Validate against the full pool, not just the core set: a user
    // who's already cycled to an extra face on a previous visit must
    // keep it across reloads. The core-only restriction only applies
    // to the *first* assignment below.
    if (stored && PROFILE_FACES.includes(stored)) return stored;
  } catch {
    // localStorage unavailable (SSR, sandboxed iframe, disabled storage)
    // — fall through to a fresh random pick without persistence.
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

/**
 * Pick a new random face from the *full* `PROFILE_FACES` pool
 * (different from the current one), persist it, and notify
 * subscribers. The first-assignment restriction to `CORE_PROFILE_FACES`
 * only applies in `readInitial`; once the user explicitly asks for a
 * new face via the profile page, the entire novelty pool opens up.
 * No-op if the pool collapses to a single entry.
 */
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

/**
 * React hook returning the current profile face, re-rendering the
 * caller whenever it changes (in this tab or another).
 */
export function useProfileFace(): string {
  return useSyncExternalStore(subscribe, getProfileFace, getProfileFace);
}
