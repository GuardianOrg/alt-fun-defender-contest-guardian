#!/usr/bin/env node
/**
 * Wrapper around `ponder dev` that fails fast if Ponder's default port is
 * already taken — typically by a stale `ponder dev` from a previous session
 * that turbo couldn't clean up (e.g. the npm script crashed but the child
 * process leaked).
 *
 * Without this guard, Ponder silently falls back to the next free port
 * (42070, 42071, …) and the API keeps hitting the dead instance on 42069
 * via the `PONDER_URL` in `apps/api/.dev.vars`. The web app then sits in a
 * "loading forever" state with no obvious error — see
 * `apps/api/src/lib/ponder-client.ts` for the corresponding health-check
 * tightening that detects the same scenario from the API side.
 *
 * The probe is a Node-native TCP listen attempt. No dependencies; ~5ms.
 */
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:net";

const PORT = 42069;

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

function describePortOwner(port) {
  // Best-effort diagnostic. `lsof` is universally available on macOS and
  // most Linux dev boxes; if it isn't, we just skip the detail block.
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

const free = await isPortFree(PORT);
if (!free) {
  const owner = describePortOwner(PORT);
  process.stderr.write("\n");
  process.stderr.write(`✖ Port ${PORT} is already in use.\n`);
  process.stderr.write(
    "  This is almost always a stray `ponder dev` from a previous session.\n",
  );
  process.stderr.write(
    "  Refusing to start: Ponder would otherwise fall back to a different\n",
  );
  process.stderr.write(
    `  port and the API (\`PONDER_URL=http://localhost:${PORT}\`) would keep\n`,
  );
  process.stderr.write(
    "  hitting the dead instance — producing a silent \"loading forever\" UI.\n",
  );
  process.stderr.write("\n");
  process.stderr.write("  To fix:\n");
  process.stderr.write(`    lsof -ti :${PORT} | xargs kill -9\n`);
  process.stderr.write("\n");
  if (owner) {
    process.stderr.write("  Currently bound by:\n");
    for (const line of owner.split("\n")) {
      process.stderr.write(`    ${line}\n`);
    }
    process.stderr.write("\n");
  }
  process.exit(1);
}

const child = spawn("ponder", ["dev"], { stdio: "inherit" });

child.on("error", (err) => {
  // ENOENT here means `ponder` wasn't resolvable — almost always because
  // this script was invoked outside `npm run` (which puts
  // `node_modules/.bin` on PATH). Surface a clear message instead of an
  // unhandled-error stack trace.
  process.stderr.write(`\n✖ Failed to spawn 'ponder dev': ${err.message}\n`);
  if (err.code === "ENOENT") {
    process.stderr.write(
      "  Run via 'npm run dev' from the workspace root or 'apps/indexer'.\n",
    );
  }
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
