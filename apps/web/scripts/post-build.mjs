#!/usr/bin/env node
/**
 * Web post-build step. Two responsibilities:
 *
 *   1. Generate `dist/sitemap.xml` from the public `/api/v1/tokens` feed
 *      so Google can discover every token detail page (`/token/<addr>`)
 *      without having to render the SPA. Build-time generation is fine
 *      because the deploy pipeline runs on every merge to `main` — the
 *      sitemap is at most one deploy stale at any moment.
 *
 *   2. Copy `dist/index.html` to `dist/404.html`. Combined with the
 *      `public/_redirects` whitelist, this lets Cloudflare Pages return
 *      HTTP 404 for genuinely unknown paths while still booting the SPA
 *      shell so React Router renders the styled `NotFound` component.
 *      Done after `vite build` because the bundle hash references inside
 *      `index.html` change every build.
 *
 * No new runtime dependencies — pure Node 22 (`fetch`, `node:fs`,
 * `node:path`). The script is best-effort: API outages or RPC hiccups
 * degrade to a sitemap with just the static marketing routes rather
 * than failing the entire web deploy. The next successful build picks
 * back up automatically.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, "..");
const DIST_DIR = resolve(WEB_ROOT, "dist");

const SITE_URL = (process.env.SITE_URL ?? "https://alt.fun").replace(/\/$/, "");
const API_URL = (
  process.env.SITEMAP_API_URL ??
  process.env.VITE_API_URL ??
  "https://api.alt.fun"
).replace(/\/$/, "");

// API list endpoint caps each page at 100 (`MAX_PAGE_SIZE` in
// `apps/api/src/routes/tokens/list.ts`). Anything above the cap returns
// 400, so respect it here. The page-budget cap (50 pages = 5000 tokens)
// is well above the current catalogue but bounds wall-clock per build
// in case the API ever paginates without an empty terminator. Sitemaps
// themselves cap at 50_000 URLs / 50MiB — we'd need a sitemap index
// well before either of those.
const TOKENS_PER_PAGE = 100;
const MAX_PAGES = 50;
const FETCH_TIMEOUT_MS = 10_000;

// Static SPA routes worth surfacing to search. `/profile` is wallet-gated
// and renders nothing useful to a crawler — skip it.
const STATIC_ROUTES = [
  { path: "/", priority: "1.0", changefreq: "hourly" },
  { path: "/create", priority: "0.8", changefreq: "weekly" },
];

/**
 * `fetch` with a hard timeout. Mirrors the shape `apps/api` uses
 * everywhere outbound — better to fall through to the static-only
 * sitemap than hang a build waiting on a degraded API.
 */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllTokens() {
  const tokens = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * TOKENS_PER_PAGE;
    const url = `${API_URL}/api/v1/tokens?limit=${TOKENS_PER_PAGE}&offset=${offset}`;
    const body = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    const batch = Array.isArray(body?.data) ? body.data : [];
    if (batch.length === 0) break;
    for (const token of batch) {
      if (
        typeof token?.address === "string" &&
        token.address.startsWith("0x") &&
        token.isHidden !== true
      ) {
        tokens.push({
          address: token.address,
          createdAt: typeof token.createdAt === "string" ? token.createdAt : null,
          lastTradeAt:
            typeof token.lastTradeAt === "string" ? token.lastTradeAt : null,
        });
      }
    }
    if (batch.length < TOKENS_PER_PAGE) break;
  }
  return tokens;
}

function xmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSitemapXml(tokens) {
  // Prefer `lastTradeAt` over `createdAt` for `<lastmod>` so Google
  // re-crawls hot tokens more aggressively than dormant ones. Falls
  // back to today's date if both fields are missing.
  const today = new Date().toISOString();
  const urls = [
    ...STATIC_ROUTES.map(
      (route) =>
        `  <url>\n    <loc>${xmlEscape(SITE_URL + route.path)}</loc>\n    <changefreq>${route.changefreq}</changefreq>\n    <priority>${route.priority}</priority>\n  </url>`,
    ),
    ...tokens.map((token) => {
      const lastmod = token.lastTradeAt ?? token.createdAt ?? today;
      return `  <url>\n    <loc>${xmlEscape(`${SITE_URL}/token/${token.address}`)}</loc>\n    <lastmod>${xmlEscape(lastmod)}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>0.6</priority>\n  </url>`;
    }),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

function writeSitemap(tokens) {
  const xml = buildSitemapXml(tokens);
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }
  const target = resolve(DIST_DIR, "sitemap.xml");
  writeFileSync(target, xml, "utf8");
  return target;
}

function copyIndexTo404() {
  const indexPath = resolve(DIST_DIR, "index.html");
  if (!existsSync(indexPath)) {
    console.warn(
      `[post-build] expected ${indexPath} to exist; did \`vite build\` run? skipping 404.html copy`,
    );
    return null;
  }
  const target = resolve(DIST_DIR, "404.html");
  copyFileSync(indexPath, target);
  return target;
}

async function main() {
  let tokens = [];
  try {
    tokens = await fetchAllTokens();
    console.log(
      `[post-build] sitemap: fetched ${tokens.length} tokens from ${API_URL}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[post-build] sitemap: token fetch failed (${msg}); falling back to static routes only`,
    );
  }

  const sitemapPath = writeSitemap(tokens);
  console.log(
    `[post-build] sitemap: wrote ${tokens.length + STATIC_ROUTES.length} urls → ${sitemapPath}`,
  );

  const notFoundPath = copyIndexTo404();
  if (notFoundPath) {
    console.log(`[post-build] 404: wrote ${notFoundPath}`);
  }
}

main().catch((err) => {
  console.error("[post-build] unexpected failure:", err);
  process.exit(1);
});
