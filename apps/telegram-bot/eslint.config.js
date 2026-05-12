import baseConfig from "@launchpad/config/eslint/base";

export default [
  ...baseConfig,
  {
    // AGENTS.md: "no-console — error in non-lib files. Use a structured
    // logger in lib/logger.ts." Worker logs surface to anyone with
    // Cloudflare dashboard access, so we want exactly one place that
    // can emit log lines — and that place owns the redaction contract.
    files: ["src/**/*.ts"],
    rules: { "no-console": "error" },
  },
  {
    files: ["src/lib/logger.ts"],
    rules: { "no-console": "off" },
  },
];
