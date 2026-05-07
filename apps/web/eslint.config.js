import baseConfig from "@launchpad/config/eslint/base";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

// `eslint-plugin-import-x` is a maintained fork of `eslint-plugin-import` that
// supports ESLint 9 and 10. The legacy plugin still calls APIs ESLint 10
// removed (`sourceCode.getTokenOrCommentBefore`), so `import/order` blows up
// with a `TypeError` on every CI run. Rule names are renamed `import` →
// `import-x` to match the plugin's published namespace.
export default tseslint.config([
  globalIgnores(["dist", "example", "e2e"]),
  ...baseConfig,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
      importX.flatConfigs.recommended,
      importX.flatConfigs.typescript,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    settings: {
      "import-x/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "import-x/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling"],
            "index",
            "object",
            "type",
          ],
          pathGroups: [
            {
              pattern: "react",
              group: "external",
              position: "before",
            },
            {
              pattern: "*.css",
              group: "index",
              position: "after",
            },
          ],
          pathGroupsExcludedImportTypes: ["react"],
          alphabetize: { order: "asc", caseInsensitive: true },
          "newlines-between": "always",
        },
      ],
    },
  },
]);
