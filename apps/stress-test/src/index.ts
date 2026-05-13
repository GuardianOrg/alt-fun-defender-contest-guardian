import { errMessage, report, setDebug } from "./lib/logger.ts";
import { runScenario } from "./runner.ts";
import { findScenario, SCENARIOS } from "./scenarios/index.ts";

function printGlobalHelp(): void {
  report("Alt Fun stress test harness");
  report("");
  report("Usage: npm run start -- <scenario> [...flags]");
  report("");
  report("Scenarios:");
  for (const scenario of SCENARIOS) {
    report(`  ${scenario.name.padEnd(18)} ${scenario.description}`);
  }
  report("");
  report("Per-scenario flags: pass `--help` after the scenario name.");
  report("Global flag: `--debug` enables verbose JSON logs on stderr (capture with `2>debug.log`).");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printGlobalHelp();
    return 0;
  }

  // Strip the `--debug` flag from anywhere in argv so it's available to
  // scenarios without competing with their per-scenario flag parsing.
  const debugIdx = argv.indexOf("--debug");
  if (debugIdx !== -1) {
    setDebug(true);
    argv.splice(debugIdx, 1);
  }

  const scenarioName = argv.shift();
  if (!scenarioName) {
    printGlobalHelp();
    return 1;
  }

  const scenario = findScenario(scenarioName);
  if (!scenario) {
    report(`Unknown scenario: ${scenarioName}`);
    report("");
    printGlobalHelp();
    return 1;
  }

  if (argv[0] === "--help" || argv[0] === "-h") {
    report(scenario.helpText);
    return 0;
  }

  return await runScenario(scenario, argv);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    report(`Fatal: ${errMessage(err)}`);
    process.exit(1);
  });
