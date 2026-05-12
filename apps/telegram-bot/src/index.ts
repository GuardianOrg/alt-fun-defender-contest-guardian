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

export default app;
