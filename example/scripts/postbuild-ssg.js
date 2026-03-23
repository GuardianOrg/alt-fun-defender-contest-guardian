import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const pages = [
  {
    path: "/liquidation-points",
    replacements: [
      {
        find: /<meta name="twitter:image" content=".*?" \/>/,
        replace: `<meta name="twitter:image" content="https://bounce.tech/liquidation-points-preview.webp" />`,
      },
      {
        find: /<meta property="og:image" content=".*?" \/>/,
        replace: `<meta property="og:image" content="https://bounce.tech/liquidation-points-preview.webp" />`,
      },
    ],
  },
];

const distDir = resolve("dist");
const indexHtmlPath = resolve(distDir, "index.html");
const indexHtml = readFileSync(indexHtmlPath, "utf-8");

pages.forEach(({ path, replacements }) => {
  let html = indexHtml;

  // Apply all replacements
  replacements.forEach(({ find, replace }) => {
    html = html.replace(find, replace);
  });

  // Ensure folder exists
  const pageDir = resolve(distDir, "." + path);
  mkdirSync(pageDir, { recursive: true });

  // Write new index.html
  writeFileSync(resolve(pageDir, "index.html"), html);

  console.log(`✅ Generated ${path} page at ${pageDir}/index.html`);
});
