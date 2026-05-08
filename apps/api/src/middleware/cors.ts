import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

/**
 * CORS allowlist for browser-driven write requests (POST/PUT/PATCH/DELETE).
 *
 * Reads (GET/HEAD) intentionally stay open to any origin so third-party
 * integrators can embed Alt Fun token data, prices, charts, etc. directly
 * from a web app without us having to maintain an explicit allowlist.
 *
 * Writes (and their preflights) are locked to first-party Alt Fun frontends
 * so a malicious page can't drive a victim's browser into POSTing comments,
 * editing profiles, registering tokens, or uploading images on their behalf
 * (the session signature in localStorage and any future cookie-bound auth
 * would otherwise be exfiltrable via a stray <form> on evil.com). Server-
 * side integrators using `X-API-Key` don't issue browser preflights and so
 * are unaffected by this lockdown.
 */
const ALLOWED_WRITE_ORIGINS: ReadonlySet<string> = new Set([
  "https://alt.fun",
  "https://www.alt.fun",
]);

/**
 * Loopback origins permitted for write CORS during local development. Hosts
 * are matched exactly against the URL `hostname`, so `localhost:5173`,
 * `127.0.0.1:8787`, etc. all resolve correctly regardless of port. We accept
 * any port because Vite, vitest, wrangler, and storybook all bind different
 * ports and forcing a fixed list would break working setups for no real
 * security gain (an attacker on `localhost` already owns the dev machine).
 */
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isDevOrigin(origin: string): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return DEV_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isWriteMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

/**
 * Resolve the effective HTTP method for a request. For OPTIONS preflights
 * the browser advertises the upcoming method via `Access-Control-Request-
 * Method`; for everything else the request method itself is the answer.
 * Defaults to GET when the preflight header is missing so a malformed
 * preflight degrades into a permissive read rather than an accidental write.
 */
function effectiveMethod(method: string, requestedMethod: string | undefined): string {
  if (method.toUpperCase() !== "OPTIONS") return method;
  return requestedMethod ?? "GET";
}

export const corsMiddleware: MiddlewareHandler = cors({
  origin: (origin, c) => {
    const method = effectiveMethod(
      c.req.method,
      c.req.header("Access-Control-Request-Method"),
    );

    if (!isWriteMethod(method)) {
      return origin || "*";
    }

    if (!origin) return null;
    if (ALLOWED_WRITE_ORIGINS.has(origin)) return origin;
    if (isDevOrigin(origin)) return origin;
    return null;
  },
  allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "X-API-Key", "X-Admin-Key", "Authorization"],
  exposeHeaders: ["Retry-After"],
  credentials: false,
  maxAge: 600,
});
