import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "out");
const abiDir = join(__dirname, "..", "..", "shared", "src", "abis");

const contracts = [
  "Bonding",
  "Factory",
  "Router",
  "Pair",
  "Token",
  "Zap",
  "LPLock",
  "FeeVault",
  "BotFeeRouter",
];

if (!existsSync(abiDir)) {
  mkdirSync(abiDir, { recursive: true });
}

const exports = [];

for (const name of contracts) {
  const artifactPath = join(outDir, `${name}.sol`, `${name}.json`);

  if (!existsSync(artifactPath)) {
    console.warn(`Skipping ${name}: artifact not found at ${artifactPath}`);
    continue;
  }

  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  const abi = JSON.stringify(artifact.abi, null, 2);

  const tsContent = `export const ${name}Abi = ${abi} as const;\n`;
  const outPath = join(abiDir, `${name}.ts`);
  writeFileSync(outPath, tsContent);
  exports.push(`export { ${name}Abi } from "./${name}.js";`);

  console.log(`Exported ${name} ABI -> ${outPath}`);
}

const manualAbis = ["UniswapV2Pair", "LeveragedToken", "LeveragedTokenHelper"];
for (const name of manualAbis) {
  if (existsSync(join(abiDir, `${name}.ts`))) {
    exports.push(`export { ${name}Abi } from "./${name}.js";`);
  }
}

const indexContent = exports.length > 0
  ? exports.join("\n") + "\n"
  : "export {};\n";

writeFileSync(join(abiDir, "index.ts"), indexContent);
console.log(`\nWrote ABI index with ${exports.length} exports.`);
