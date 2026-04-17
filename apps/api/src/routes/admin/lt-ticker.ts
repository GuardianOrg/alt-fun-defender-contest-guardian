import { Hono } from "hono";

import formatSuccess from "../../utils/format-success.js";
import formatError from "../../utils/format-error.js";

import type { AppBindings } from "../../lib/types.js";

const ltTicker = new Hono<{ Bindings: AppBindings }>();

ltTicker.get("/", async (c) => {
  const id = c.env.LT_TICKER_DO.idFromName("lt-ticker");
  const stub = c.env.LT_TICKER_DO.get(id);

  try {
    const res = await stub.fetch("https://internal/ensure");
    const body = (await res.json()) as unknown;
    return c.json(formatSuccess(body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(formatError(`LtTicker unreachable: ${message}`), 503);
  }
});

export default ltTicker;
