import { Hono } from "hono";
import { logger } from "hono/logger";

import type { AppBindings } from "./lib/types.js";
import webhook from "./routes/webhook.js";
import admin from "./routes/admin.js";

const app = new Hono<AppBindings>();

app.use("*", logger());

app.get("/", (c) => c.text("launchpad-telegram-bot"));
app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/", webhook);
app.route("/admin", admin);

// Re-export the ChatDO so Cloudflare can bind it via wrangler.json.
// The DO class must be a named export from the worker's main module.
export { ChatDO } from "./chat-do.js";

export default app;
