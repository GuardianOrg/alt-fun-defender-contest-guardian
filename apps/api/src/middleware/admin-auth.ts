import type { Context, Next } from "hono";

import type { AppBindings } from "../lib/types.js";

export async function adminAuth(c: Context<{ Bindings: AppBindings }>, next: Next) {
  const apiKey = c.req.header("X-Admin-Key");
  if (!apiKey || apiKey !== c.env.ADMIN_API_KEY) {
    return c.json({ status: "error", error: "Unauthorized", data: null }, 401);
  }
  await next();
}
