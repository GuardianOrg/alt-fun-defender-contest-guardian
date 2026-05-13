import { scenario as createTokens } from "./create-tokens.ts";
import { scenario as tradeToken } from "./trade-token.ts";

import type { AnyScenario } from "./types.ts";

/**
 * Single source of truth for which scenarios the CLI knows about. To add
 * a new scenario:
 *
 *   1. Drop a file in `src/scenarios/` exporting `scenario: AnyScenario`
 *      (see `create-tokens.ts` for the pattern).
 *   2. Import it here and add it to `SCENARIOS`.
 *
 * That's it. The runner (`src/runner.ts`) and CLI entry (`src/index.ts`)
 * are scenario-agnostic and don't need touching.
 */
export const SCENARIOS: readonly AnyScenario[] = [createTokens, tradeToken];

export function findScenario(name: string): AnyScenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
