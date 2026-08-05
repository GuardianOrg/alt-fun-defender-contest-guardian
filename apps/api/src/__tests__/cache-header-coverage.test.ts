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
 * All production sources as text. Vite's raw glob rather than `node:fs`
 * — this package targets the Workers runtime and has no Node type
 * surface. The triple-slash reference above supplies `ImportMeta.glob`,
 * same as the source-scan gate in `api-db-503.test.ts`.
 *
 * Scans the whole tree, not just `routes/`: a directive written in a
 * `lib/` or `middleware/` helper reaches the wire exactly the same way.
 */
const ALLOWED_SOURCE = "../utils/cache-control.ts";

const productionSources = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).filter(
    ([path]) => path !== ALLOWED_SOURCE && !path.endsWith(".test.ts"),
  ),
);

// Both spellings matter: the shared directive is `s-maxage`, not
// `s-max-age`. Case-insensitive because HTTP directives are, so
// `S-Maxage=30` is just as effective and must not slip past. Kept as
// separate literals rather than composed from `.source`, so no regex is
// ever built from a variable.
const ANY_AGE = /(?:s-maxage|max-age)\s*=/i;
/**
 * Captures the digits after an age directive, or nothing when the value
 * isn't a literal — `${ttl}`, `" + ttl`, or the literal simply ending
 * there.
 */
const AGE_VALUE = /(?:s-maxage|max-age)\s*=\s*(\d+)?/gi;

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
 * True when a literal asks any cache to retain the body for >0 seconds,
 * OR when the scan can't prove it doesn't. Only an explicit `=0` passes.
 *
 * The unprovable cases are the ones that matter: `` `s-maxage=${ttl}` ``
 * is the shape `analytics.ts` used before this PR, and
 * `"public, max-age=" + ttl` is the same trick with concatenation. Both
 * emit a real TTL while containing no readable number.
 */
function declaresPositiveAge(literal: string): boolean {
  return [...literal.matchAll(AGE_VALUE)].some(
    ([, seconds]) => seconds === undefined || Number(seconds) > 0,
  );
}

describe("cache directives all originate in utils/cache-control.ts", () => {
  const offenders = Object.entries(productionSources).flatMap(
    ([path, source]) =>
      cacheAgeLiterals(source)
        .filter(declaresPositiveAge)
        .map((literal) => `${path}: ${literal}`),
  );

  it("no production source hand-writes a positive cache TTL", () => {
    expect(offenders).toEqual([]);
  });

  it("scans the whole tree, not just routes", () => {
    // Guards against the glob silently matching nothing and the
    // assertion above passing for the wrong reason.
    const paths = Object.keys(productionSources);
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.some((p) => p.startsWith("../lib/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("../middleware/"))).toBe(true);
    // The one file allowed to author directives must be excluded, or the
    // scan would flag the helper itself and prove nothing.
    expect(paths).not.toContain(ALLOWED_SOURCE);
  });

  it("only a known set of files writes a cache header at all", () => {
    // Enumerating who may name a cache header catches what value-shape
    // scanning can't: `c.header("Cache-Control", buildIt(30))` has no
    // directive literal to find. Codex review on this PR.
    //
    // Known limit: splitting the header NAME itself
    // (`["Cache","-Control"].join("")`) evades this too. Only an AST rule
    // would close that, and no accidental regression looks like it — the
    // shapes below are the ones reachable by mistake.
    const writers = Object.entries(productionSources)
      .filter(([, source]) => {
        const code = source
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        return (
          // The header named as a literal…
          /(["'`])(?:Cloudflare-CDN-)?Cache-Control\1/i.test(code) ||
          // …or via the exported constant, which is the natural form and
          // carries no literal at all.
          /\bCDN_CACHE_CONTROL_HEADER\b/.test(code)
        );
      })
      .map(([path]) => path)
      .sort();

    // `cache-control.ts` is excluded from the scan by construction; these
    // four legitimately name a header without authoring a TTL — the SWR
    // fallback, the no-store default, token detail's private branch, and
    // the temporary per-endpoint killswitch (which only ever writes
    // `no-store`). Drop the killswitch entry when that module is
    // deleted, so the list keeps failing on anything unaccounted for.
    expect(writers).toEqual([
      "../middleware/default-no-store.ts",
      "../middleware/zone-cache-killswitch.ts",
      "../routes/tokens/detail.ts",
      "../utils/swr-cache.ts",
    ]);
  });

  it("flags a case-variant directive, since HTTP directives are case-insensitive", () => {
    const sample = `c.header("Cache-Control", "public, S-Maxage=30");`;
    expect(cacheAgeLiterals(sample).filter(declaresPositiveAge)).toHaveLength(1);
  });

  it("flags a hand-written directive when one is introduced", () => {
    const sample = `c.header("Cache-Control", "public, s-maxage=30");`;
    expect(cacheAgeLiterals(sample).filter(declaresPositiveAge)).toHaveLength(1);
  });

  it("flags a concatenated TTL, which has neither digits nor interpolation", () => {
    // `"public, max-age=" + ttl` reads as compliant to any scan that
    // only looks for numbers or `${`. Codex review on this PR.
    const sample = `c.header("Cache-Control", "public, max-age=" + ttlSec);`;
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
