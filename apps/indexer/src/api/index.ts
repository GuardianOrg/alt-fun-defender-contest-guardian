import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { graphql } from "ponder";

import { getDiagnosticsSnapshot, isHealthy } from "../instrumentation";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);
/**
 * Lag-aware healthcheck — flips to 503 once the event loop is wedged so
 * Railway's healthcheck has an explicit reason to restart the container.
 * Without this, a stalled indexer process keeps responding 200 on the
 * GraphQL root and Railway has nothing to act on. See `instrumentation.ts`.
 */
app.get("/healthz", (c) => {
  const snapshot = getDiagnosticsSnapshot();
  const healthy = isHealthy(snapshot);
  return c.json({ ok: healthy, ...snapshot }, healthy ? 200 : 503);
});
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
