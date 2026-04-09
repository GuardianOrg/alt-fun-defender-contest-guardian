import { Hono } from "hono";

import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

const trades = new Hono<{ Bindings: AppBindings }>();

trades.get("/", async (c) => {
  return c.json(formatSuccess([]));
});

trades.get("/ohlcv/:address", async (c) => {
  void c.req.param("address");
  return c.json(formatSuccess([]));
});

export default trades;
