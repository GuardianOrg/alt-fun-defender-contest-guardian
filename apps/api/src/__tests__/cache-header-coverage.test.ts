/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";

/**
 * A route that hand-writes its own cache directive gets the browser and
 * Worker tiers but not the Cloudflare zone, which reads
 * `Cloudflare-CDN-Cache-Control` instead. That's how nine routes ended
 * up advertising a TTL while every single request still reached Neon.
 *
 * This test makes the class of mistake unrepresentable: every non-zero
 * cache TTL in the API must be built by `src/utils/cache-control.ts`,
 * which stamps both tiers from one number. A zeroed directive
 * (`no-store, max-age=0, s-maxage=0`) is the deliberate opt-out and
 * stays allowed.
 */

/**
 * Route sources as text. Vite's raw glob rather than `node:fs` — this
 * package targets the Workers runtime and has no Node type surface. The
 * triple-slash reference above supplies `ImportMeta.glob`, same as the
 * source-scan gate in `api-db-503.test.ts`.
 */
const routeSources = import.meta.glob<string>("../routes/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Both spellings matter: the shared directive is `s-maxage`, not
// `s-max-age`. Kept as three separate literals rather than one composed
// from `.source`, so no regex is ever built from a variable.
const ANY_AGE = /(?:s-maxage|max-age)\s*=/;
const NUMERIC_AGE = /(?:s-maxage|max-age)\s*=\s*(\d+)/g;
const INTERPOLATED_AGE = /(?:s-maxage|max-age)\s*=\s*\$\{/;

/** String literals (quoted or backticked) that mention a cache age. */
function cacheAgeLiterals(source: string): string[] {
  const stripped = source
    // Comments explain policy; they don't set headers.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const literals = stripped.match(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g) ?? [];
  return literals.filter((literal) => ANY_AGE.test(literal));
}

/**
 * True when a literal asks any cache to retain the body for >0 seconds.
 * An interpolated age (`` `s-maxage=${ttl}` ``) counts: the value can't
 * be read statically, so it can't be shown to be the zeroed opt-out.
 * That was the shape `analytics.ts` used before this PR, so the hole is
 * not hypothetical.
 */
function declaresPositiveAge(literal: string): boolean {
  if (INTERPOLATED_AGE.test(literal)) return true;
  return [...literal.matchAll(NUMERIC_AGE)].some(
    ([, seconds]) => Number(seconds) > 0,
  );
}

describe("cache directives all originate in utils/cache-control.ts", () => {
  const offenders = Object.entries(routeSources).flatMap(([path, source]) =>
    cacheAgeLiterals(source)
      .filter(declaresPositiveAge)
      .map((literal) => `${path}: ${literal}`),
  );

  it("no route hand-writes a positive cache TTL", () => {
    expect(offenders).toEqual([]);
  });

  it("finds route files to check at all", () => {
    // Guards against the glob silently matching nothing and the
    // assertion above passing for the wrong reason.
    expect(Object.keys(routeSources).length).toBeGreaterThan(10);
  });

  it("flags a hand-written directive when one is introduced", () => {
    const sample = `c.header("Cache-Control", "public, s-maxage=30");`;
    expect(cacheAgeLiterals(sample).filter(declaresPositiveAge)).toHaveLength(1);
  });

  it("flags an interpolated TTL, which no numeric scan can prove is zero", () => {
    // The shape `analytics.ts` used before this PR. A scan that only reads
    // digits sees no value here and waves it through. CodeRabbit review on
    // this PR.
    const sample =
      "c.header(\"Cache-Control\", `public, s-maxage=${ttlSec}, stale-while-revalidate=${ttlSec * 2}`);";
    expect(cacheAgeLiterals(sample).filter(declaresPositiveAge)).toHaveLength(1);
  });

  it("leaves the deliberate no-store opt-out alone", () => {
    const sample = `response.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0, s-maxage=0",
    );`;
    expect(cacheAgeLiterals(sample).filter(declaresPositiveAge)).toEqual([]);
  });
});
