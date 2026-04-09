import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import formatSuccess from "./utils/format-success.js";
import formatError from "./utils/format-error.js";
import tokens from "./routes/tokens.js";
import trades from "./routes/trades.js";
import creators from "./routes/creators.js";
import admin from "./routes/admin.js";

import type { AppBindings } from "./lib/types.js";

const app = new Hono<{ Bindings: AppBindings }>();

app.use("*", logger());
app.use("*", cors());
app.use("*", prettyJSON());

app.get("/", (c) => c.json(formatSuccess("bounce.fun API")));
app.get("/health", (c) => c.json(formatSuccess("healthy")));

app.route("/api/v1/tokens", tokens);
app.route("/api/v1/trades", trades);
app.route("/api/v1/creators", creators);
app.route("/api/v1/admin", admin);

app.notFound((c) => c.json(formatError("Not Found"), 404));

app.onError((err, c) => {
  console.error("Error:", err);
  return c.json(formatError("Internal Server Error"), 500);
});

export default app;
