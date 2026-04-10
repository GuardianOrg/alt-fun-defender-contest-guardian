import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import puppeteer from "puppeteer-core";

import {
  LEVERAGE_NUMBER_PATHS,
  LONG_ARROW_PATH,
  SHORT_ARROW_PATH,
} from "../src/constants/leveragedTokenPaths";
import { TARGET_ASSETS_BASE } from "../src/constants/targetAssetsBase";
import { getLeverageTokenSymbol } from "../src/utils/getLeverageTokenSymbol.util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.resolve(ROOT, "public/leveraged-tokens");

// ── Build SVG markup ────────────────────────────────────────────────────────

function buildSvg({
  logoDataUri,
  accentColor,
  leverage,
  long,
}: {
  logoDataUri: string;
  accentColor: string;
  leverage: number;
  long: boolean;
}) {
  const gradientId0 = `paint1_export_${Math.random().toString(36).substr(2, 8)}`;
  const gradientId1 = `paint2_export_${Math.random().toString(36).substr(2, 8)}`;

  const leveragePath = LEVERAGE_NUMBER_PATHS[leverage];
  const leverageElement = leveragePath
    ? `<path d="${leveragePath}" fill="white"/>`
    : "";

  const arrowPath = long ? LONG_ARROW_PATH : SHORT_ARROW_PATH;

  return `<svg width="120" height="120" viewBox="0 0 188 188" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- base -->
  <rect x="45" y="47" width="97.9161" height="97.915" rx="20.8333"/>
  <foreignObject x="45" y="47" width="97.9161" height="97.915">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
      <img src="${logoDataUri}" />
    </div>
  </foreignObject>

  <!-- ring -->
  <path d="M94 0C145.915 0 188 42.0852 188 94C188 145.915 145.915 188 94 188C42.0852 188 0 145.915 0 94C0 42.0852 42.0852 0 94 0ZM94 47.5C68.0426 47.5 47 68.5426 47 94.5C47 120.457 68.0426 141.5 94 141.5C119.957 141.5 141 120.457 141 94.5C141 68.5426 119.957 47.5 94 47.5Z" fill="#17181F"/>

  <!-- accent bottom -->
  <path d="M139.031 176.5C125.528 183.86 110.029 188 93.5312 188C77.0338 188 61.5344 183.86 48.0312 176.5C53.2565 156.663 71.6323 142 93.5312 142C115.43 142 133.806 156.663 139.031 176.5Z" fill="url(#${gradientId0})"/>
  <!-- accent top -->
  <path d="M139.062 11.75C133.834 32.0188 115.445 47 93.5312 47C71.6176 47 53.2288 32.0188 48 11.75C61.5124 4.23018 77.0225 0 93.5312 0C110.04 0 125.55 4.23018 139.062 11.75Z" fill="url(#${gradientId1})"/>

  <!-- leverage number -->
  ${leverageElement}

  <!-- arrow -->
  <path d="${arrowPath}" fill="white"/>

  <defs>
    <linearGradient id="${gradientId0}" x1="93.5312" y1="144.728" x2="93.5312" y2="188" gradientUnits="userSpaceOnUse">
      <stop stop-color="#17181F"/>
      <stop offset="1" stop-color="${accentColor}"/>
    </linearGradient>
    <linearGradient id="${gradientId1}" x1="93.5312" y1="2.7878" x2="93.5312" y2="47" gradientUnits="userSpaceOnUse">
      <stop stop-color="${accentColor}"/>
      <stop offset="1" stop-color="#17181F"/>
    </linearGradient>
  </defs>
</svg>`;
}

// ── Find local Chrome/Chromium ──────────────────────────────────────────────

function findChrome(): string {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Error(
      `CHROME_PATH is set but not found: ${process.env.CHROME_PATH}`,
    );
  }

  const candidates =
    process.platform === "darwin"
      ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      ]
      : process.platform === "win32"
        ? [
          `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
        : [
          "google-chrome",
          "google-chrome-stable",
          "chromium",
          "chromium-browser",
        ];

  for (const candidate of candidates) {
    if (process.platform === "win32" || process.platform === "darwin") {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      try {
        const resolved = execSync(`which ${candidate}`, {
          encoding: "utf-8",
        }).trim();
        if (resolved) return resolved;
      } catch {
        // not found, try next
      }
    }
  }

  throw new Error(
    "Could not find Chrome or Chromium. Install Google Chrome, or set CHROME_PATH env var.\n" +
    "You can also run: npx @puppeteer/browsers install chrome",
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const logoDir = path.resolve(ROOT, "src/assets/logos");
  const logoCache: Record<string, string> = {};
  for (const asset of TARGET_ASSETS_BASE) {
    const svgContent = fs.readFileSync(
      path.join(logoDir, `${asset.id}.svg`),
      "utf-8",
    );
    const base64 = Buffer.from(svgContent).toString("base64");
    logoCache[asset.symbol] = `data:image/svg+xml;base64,${base64}`;
  }

  const variants: {
    symbol: string;
    leverage: number;
    long: boolean;
    accentColor: string;
    logoDataUri: string;
    filename: string;
  }[] = [];

  for (const asset of TARGET_ASSETS_BASE) {
    const allLeverages = [
      ...new Set([
        ...asset.longLeverageOptions,
        ...asset.shortLeverageOptions,
      ]),
    ].sort((a, b) => a - b);

    for (const leverage of allLeverages) {
      for (const direction of ["long", "short"] as const) {
        variants.push({
          symbol: asset.symbol,
          leverage,
          long: direction === "long",
          accentColor: asset.accentColor,
          logoDataUri: logoCache[asset.symbol],
          filename: getLeverageTokenSymbol(asset.symbol, leverage, direction) + ".png",
        });
      }
    }
  }

  console.log(`Exporting ${variants.length} token icons to ${OUTPUT_DIR}\n`);

  const executablePath = findChrome();
  console.log(`Using browser: ${executablePath}\n`);

  const launchArgs: string[] = [];
  if (
    process.env.CI === "true" ||
    process.env.PUPPETEER_DISABLE_SANDBOX === "true"
  ) {
    launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: launchArgs,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 200, height: 200, deviceScaleFactor: 1 });

  const expectedFiles = new Set<string>();

  for (const variant of variants) {
    expectedFiles.add(variant.filename);
    const svg = buildSvg(variant);

    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    body { background: transparent; width: 120px; height: 120px; overflow: hidden; }
  </style>
</head>
<body>${svg}</body>
</html>`;

    await page.setContent(html, { waitUntil: "load" });

    const element = await page.$("svg");
    if (!element) {
      throw new Error(
        `Failed to render SVG for ${variant.filename}: no <svg> element found after setting page content.`,
      );
    }
    await element.screenshot({
      path: path.join(OUTPUT_DIR, variant.filename),
      omitBackground: true,
    });

    console.log(`  ✓ ${variant.filename}`);
  }

  const existing = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".png"));
  for (const file of existing) {
    if (!expectedFiles.has(file)) {
      fs.unlinkSync(path.join(OUTPUT_DIR, file));
      console.log(`  ✗ removed stale ${file}`);
    }
  }

  await browser.close();
  console.log(
    `\nDone! ${variants.length} icons saved to public/leveraged-tokens/`,
  );
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
