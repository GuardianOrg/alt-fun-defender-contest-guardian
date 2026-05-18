import { API_BASE } from "../services/api";

/**
 * Cloudflare Image Transformations rewrite the request through
 * `https://<zone>/cdn-cgi/image/<opts>/<original-path>`. The zone-level
 * feature is enabled on the `alt.fun` zone (Speed → Optimization →
 * Image Resizing). Hits against any other host — local dev's
 * `http://localhost:8787`, the web app's own origin (where
 * `DEFAULT_TOKEN_IMAGE` lives), or a third-party CDN — bypass the
 * rewrite cleanly so the original `src` is preserved.
 *
 * The R2-served token images live at `/images/tokens/<uuid>.<ext>`
 * under the API origin and are typically uploaded at 400×400+ but
 * rendered into 28–96 px slots, so most of the curve image weight is
 * pixels the user will never see. `width=` plus `format=auto`
 * (AVIF→WebP→original content negotiation against the `Accept`
 * header) collapses the typical 50–200 KB PNG to a sub-10 KB AVIF
 * per row.
 *
 * Pricing: Cloudflare bills ~$0.50 per 1k unique transformations; the
 * cache hit rate is high once a page has warmed because every viewer
 * requests the same `(src, width)` tuple, so the marginal cost is
 * dominated by the first paint after a cache flush, not the per-pageview
 * volume.
 */

interface ApiOriginConfig {
  origin: string;
  hostname: string;
}

/** Parsed lazily — `vi.mock("../services/api", …)` in tests would
 *  otherwise race against module-init. The result is cached for the
 *  life of the isolate. */
let cachedApiOrigin: ApiOriginConfig | null | undefined;

function getApiOriginConfig(): ApiOriginConfig | null {
  if (cachedApiOrigin !== undefined) return cachedApiOrigin;
  try {
    const url = new URL(API_BASE);
    cachedApiOrigin = { origin: url.origin, hostname: url.hostname };
  } catch {
    cachedApiOrigin = null;
  }
  return cachedApiOrigin;
}

/**
 * Cloudflare Image Transformations are zone-level on `alt.fun`. Local
 * dev points `VITE_API_URL` at `http://localhost:8787`, which has no
 * Cloudflare edge in front of it — rewriting to a non-existent
 * `/cdn-cgi/image/...` path would 404 every token logo. Gating on the
 * `.alt.fun` suffix keeps the helper a no-op in dev (and in any
 * future preview env that doesn't run behind the CF zone) while
 * lighting up for `api.alt.fun` / `staging.alt.fun` in CI + prod.
 */
function transformsEnabled(config: ApiOriginConfig | null): boolean {
  return config !== null && config.hostname.endsWith(".alt.fun");
}

export interface TransformOpts {
  /** Target render width in CSS pixels — Cloudflare reads this verbatim. */
  width: number;
  /** Default 85 — sweet spot for AVIF/WebP quality vs size at small sizes. */
  quality?: number;
  /** Default `auto` — content-negotiated AVIF→WebP→original. */
  format?: "auto" | "avif" | "webp" | "jpeg" | "png";
  /** Default `cover` — token logos are square slots, mirror `object-fit`. */
  fit?: "cover" | "contain" | "scale-down" | "crop" | "pad";
}

/**
 * Rewrite a token image URL through Cloudflare's `/cdn-cgi/image/`
 * proxy at the requested dimensions. Returns `src` unchanged when:
 *
 * - The src is empty / missing / undefined (e.g. `Token.image` on a
 *   token whose creator skipped image upload).
 * - The src is a blob/data URI (local upload preview before launch).
 * - The src is a root-relative path (the public `DEFAULT_TOKEN_IMAGE`
 *   served from the web app's own origin, never from R2).
 * - The src host is not on the `.alt.fun` zone (local dev's
 *   `localhost:8787`, third-party CDNs, etc.).
 * - The src is already a `/cdn-cgi/image/…` URL (defensive against
 *   double-wrapping if a future caller stores a pre-transformed URL).
 *
 * The full no-op behaviour is what lets every render site call the
 * helper unconditionally without a per-site bypass for the default
 * image / blob preview / local-dev case.
 *
 * Accepts `string | undefined` so callers can pass `token.image` (the
 * `Token.image` field is optional) without an extra `?? ""` guard.
 */
export function transformImageUrl(
  src: string | undefined,
  opts: TransformOpts,
): string | undefined {
  if (!src) return src;
  const config = getApiOriginConfig();
  if (!transformsEnabled(config) || config === null) return src;
  if (!src.startsWith("http://") && !src.startsWith("https://")) return src;

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }

  if (url.origin !== config.origin) return src;
  if (url.pathname.startsWith("/cdn-cgi/image/")) return src;

  const parts: string[] = [`width=${opts.width}`];
  parts.push(`quality=${opts.quality ?? 85}`);
  parts.push(`format=${opts.format ?? "auto"}`);
  if (opts.fit) parts.push(`fit=${opts.fit}`);

  return `${url.origin}/cdn-cgi/image/${parts.join(",")}${url.pathname}${url.search}`;
}

/**
 * Build a 1x/2x `srcSet` string for the given render width (CSS px).
 * Mirrors the typical retina pattern — the browser picks `2x` on
 * `devicePixelRatio ≥ 2` displays. Returns an empty string when the
 * helper short-circuits to the original src (the caller should omit
 * the `srcSet` attribute entirely in that case to avoid feeding the
 * browser a `<url> 1x, <url> 2x` line that resolves to the same byte
 * range twice).
 */
export function srcSetFor(
  src: string | undefined,
  width: number,
  opts: { quality?: number; format?: TransformOpts["format"] } = {},
): string {
  if (!src) return "";
  const x1 = transformImageUrl(src, {
    width,
    quality: opts.quality,
    format: opts.format,
  });
  const x2 = transformImageUrl(src, {
    width: width * 2,
    quality: opts.quality,
    format: opts.format,
  });
  if (x1 === src && x2 === src) return "";
  return `${x1} 1x, ${x2} 2x`;
}

/**
 * Reset the cached API origin lookup. Internal hook for unit tests that
 * remount the helper after `vi.stubEnv` / `vi.mock`-driven env swaps;
 * production callers never need this.
 */
export function __resetApiOriginCacheForTests(): void {
  cachedApiOrigin = undefined;
}
