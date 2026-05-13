import type { AppConfig } from "../config.ts";
import type { AltFunApiClient } from "../lib/api-client.ts";
import type { Clients } from "../lib/clients.ts";

/**
 * Per-iteration outcome rolled up by the runner into the final summary.
 * Scenarios produce one of these per loop body so the reporter can
 * aggregate without knowing what the scenario actually did.
 */
export interface IterationResult {
  ok: boolean;
  /** Wall-clock for this iteration, milliseconds. */
  durationMs: number;
  /** Optional free-form per-iteration tags (e.g. `pair: "HYPE-3L"`). */
  tags?: Record<string, string | number>;
  /** Populated when `ok === false`. */
  error?: string;
}

/**
 * Wired-up shared dependencies passed into every scenario. `Scenario.run`
 * owns its own loop and concurrency — the runner only orchestrates the
 * top-level "dispatch and report" flow, deliberately not a framework.
 */
export interface ScenarioContext {
  config: AppConfig;
  clients: Clients;
  api: AltFunApiClient;
}

export interface ScenarioResult {
  iterations: IterationResult[];
  /** Optional scenario-specific lines printed before the standard summary. */
  notes?: string[];
}

/**
 * Implement and register a `Scenario` in `scenarios/index.ts` to add a
 * new stress test. The two-method shape (`parseOptions` + `run`) keeps
 * argv parsing colocated with the scenario that consumes it — no central
 * "options union" type, no flag plumbing through the runner.
 */
export interface Scenario<TOptions> {
  name: string;
  description: string;
  /** One-paragraph usage block printed by `--help` for the scenario. */
  helpText: string;
  parseOptions(argv: string[]): TOptions;
  run(ctx: ScenarioContext, options: TOptions): Promise<ScenarioResult>;
}

/**
 * Type-erased scenario reference held in the registry. The runner only
 * ever sees this shape — `parseOptions` returns `unknown`, which `run`
 * accepts. Each scenario file owns the proper generic on its export.
 */
export type AnyScenario = Scenario<unknown>;
