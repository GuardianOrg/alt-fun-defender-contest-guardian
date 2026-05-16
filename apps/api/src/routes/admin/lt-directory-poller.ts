import { Hono } from "hono";

import formatSuccess from "../../utils/format-success.js";
import formatError from "../../utils/format-error.js";

import type { AppBindings } from "../../lib/types.js";

const ltDirectoryPoller = new Hono<{ Bindings: AppBindings }>();

ltDirectoryPoller.get("/", async (c) => {
  const id = c.env.LT_DIRECTORY_POLLER_DO.idFromName("lt-directory-poller-v2");
  const stub = c.env.LT_DIRECTORY_POLLER_DO.get(id);

  try {
    const res = await stub.fetch("https://internal/ensure");
    if (!res.ok) {
      return c.json(
        formatError(`LtDirectoryPoller /ensure returned HTTP ${res.status}`),
        503,
      );
    }
    const body = (await res.json()) as unknown;
    return c.json(formatSuccess(body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(formatError(`LtDirectoryPoller unreachable: ${message}`), 503);
  }
});

export default ltDirectoryPoller;
