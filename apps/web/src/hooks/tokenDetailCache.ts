import type { Token } from "../services/types";

const STORAGE_KEY = "altfun:tokenDetailCache";
const MAX_ENTRIES = 8;

interface CachedTokenEntry {
  token: Token;
  viewedAt: number;
}

type CachedTokenMap = Record<string, CachedTokenEntry>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTokenStatus(value: unknown): value is Token["status"] {
  return value === "active" || value === "graduating" || value === "graduated";
}

function isToken(value: unknown): value is Token {
  if (!isRecord(value)) return false;
  return (
    typeof value.address === "string" &&
    typeof value.name === "string" &&
    typeof value.ticker === "string" &&
    typeof value.description === "string" &&
    (value.direction === "long" || value.direction === "short") &&
    typeof value.underlying === "string" &&
    typeof value.leverage === "number" &&
    typeof value.ltName === "string" &&
    typeof value.ltAddress === "string" &&
    isTokenStatus(value.status) &&
    typeof value.creatorAddress === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.isHidden === "boolean"
  );
}

function readCache(): CachedTokenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const entries: CachedTokenMap = {};
    for (const [address, entry] of Object.entries(parsed)) {
      if (!isRecord(entry)) continue;
      if (!isToken(entry.token)) continue;
      if (typeof entry.viewedAt !== "number") continue;
      entries[address.toLowerCase()] = {
        token: entry.token,
        viewedAt: entry.viewedAt,
      };
    }
    return entries;
  } catch {
    return {};
  }
}

function writeCache(cache: CachedTokenMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Best-effort cache: private browsing / quota failures should not affect the UI.
  }
}

export function readCachedToken(
  address: string | undefined,
): Token | undefined {
  if (!address) return undefined;
  return readCache()[address.toLowerCase()]?.token;
}

export function cacheTokenDetail(token: Token): void {
  const cache = readCache();
  const key = token.address.toLowerCase();
  cache[key] = { token, viewedAt: Date.now() };

  const trimmed = Object.fromEntries(
    Object.entries(cache)
      .sort(([, a], [, b]) => b.viewedAt - a.viewedAt)
      .slice(0, MAX_ENTRIES),
  );
  writeCache(trimmed);
}
