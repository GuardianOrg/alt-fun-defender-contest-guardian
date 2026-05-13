import { loadConfig } from "./config.ts";
import { buildApiClient } from "./lib/api-client.ts";
import { buildClients } from "./lib/clients.ts";
import {
  banner,
  divider,
  errMessage,
  failure,
  info,
  kv,
  log,
  report,
  section,
} from "./lib/logger.ts";

import type {
  AnyScenario,
  IterationResult,
  ScenarioContext,
  ScenarioResult,
} from "./scenarios/types.ts";

/**
 * Top-level orchestration:
 *
 *   1. Parse the scenario's own option block.
 *   2. Build the shared context (wallet, public/wallet clients, API).
 *   3. Run the scenario.
 *   4. Print a summary.
 *
 * Per-iteration concurrency, retries, and pacing all live inside the
 * scenario — keeping the runner thin means scenarios that need different
 * sequencing don't have to fight a framework.
 */
export async function runScenario(
  scenario: AnyScenario,
  rawOptions: string[],
): Promise<number> {
  let options: unknown;
  try {
    options = scenario.parseOptions(rawOptions);
  } catch (err) {
    report(`Invalid flags for ${scenario.name}: ${errMessage(err)}`);
    report("");
    report(scenario.helpText);
    return 1;
  }

  const config = loadConfig();
  const clients = buildClients(config);
  const api = buildApiClient(config.apiBaseUrl, config.apiKey);
  const ctx: ScenarioContext = { config, clients, api };

  banner(`Alt Fun stress test · ${scenario.name}`);
  kv("wallet", clients.account.address);
  kv("rpc", config.rpcUrl);
  kv("api", `${config.apiBaseUrl}${config.apiKey ? "  (key set)" : "  (no key)"}`);

  const startedAt = Date.now();
  let result: ScenarioResult;
  try {
    result = await scenario.run(ctx, options);
  } catch (err) {
    log("error", "scenario_aborted", {
      scenario: scenario.name,
      error: errMessage(err),
    });
    section("💥", "Scenario aborted");
    failure(errMessage(err));
    return 1;
  }
  const totalMs = Date.now() - startedAt;

  printSummary(result, totalMs);
  return result.iterations.some((it) => !it.ok) ? 1 : 0;
}

function printSummary(result: ScenarioResult, totalMs: number): void {
  const { iterations, notes } = result;
  const ok = iterations.filter((it) => it.ok);
  const failed = iterations.filter((it) => !it.ok);
  const durations = iterations
    .map((it) => it.durationMs)
    .sort((a, b) => a - b);

  report("");
  divider();
  section("📊", "Summary");

  kv("total wall", `${(totalMs / 1000).toFixed(1)}s`);
  kv(
    "iterations",
    `${iterations.length}  (${ok.length} ok, ${failed.length} failed)`,
  );
  if (durations.length > 0) {
    kv(
      "per iter",
      `min ${formatMs(durations[0]!)} · p50 ${formatMs(percentile(durations, 0.5))} · p95 ${formatMs(percentile(durations, 0.95))} · max ${formatMs(durations.at(-1)!)}`,
    );
  }

  if (notes && notes.length > 0) {
    section("ℹ️ ", "Run config");
    for (const note of notes) info(note);
  }

  if (failed.length > 0) {
    section("❗", "Failures");
    const grouped = groupErrors(failed);
    for (const [message, count] of grouped) {
      failure(`${count}×  ${message}`);
    }
  }

  report("");
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor(sortedAsc.length * p)),
  );
  return sortedAsc[idx]!;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function groupErrors(failed: IterationResult[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const it of failed) {
    const key = it.error ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}
