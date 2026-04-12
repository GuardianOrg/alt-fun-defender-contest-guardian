import { Hono } from "hono";

import { adminAuth } from "../../middleware/admin-auth.js";
import apiKeysRoute from "../api-keys.js";
import analytics from "./analytics.js";
import moderation from "./moderation.js";

import type { AppBindings } from "../../lib/types.js";

const admin = new Hono<{ Bindings: AppBindings }>();

admin.use("*", adminAuth);

admin.route("/api-keys", apiKeysRoute);
admin.route("/analytics", analytics);
admin.route("/", moderation);

export default admin;
