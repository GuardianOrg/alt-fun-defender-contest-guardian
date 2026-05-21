import { API_BASE } from "../services/api";

/**
 * Cloudflare Image Transformations run only on the `alt.fun` zone; local,
 * default, blob/data, and third-party images pass through unchanged.
 */

interface ApiOriginConfig {
  origin: string;
  hostname: string;
}

/** Parsed lazily so tests can mock `API_BASE` before first use. */
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

/** Transform only hosts under the Cloudflare-backed `alt.fun` zone. */
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

/** Rewrite eligible token images through `/cdn-cgi/image/`, otherwise return `src`. */
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

/** Build a 1x/2x `srcSet`, or empty string when transforms are unavailable. */
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

/** Test-only cache reset. */
export function __resetApiOriginCacheForTests(): void {
  cachedApiOrigin = undefined;
}
