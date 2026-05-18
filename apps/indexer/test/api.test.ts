import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../src/api/index";
import { _resetForTesting } from "../src/instrumentation";

describe("indexer Hono app", () => {
  beforeEach(() => {
    _resetForTesting();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    _resetForTesting();
    vi.restoreAllMocks();
  });

  it("serves /healthz with the diagnostics snapshot", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.pid).toBe("number");
    expect(typeof body.loop_lag_p99_ms).toBe("number");
    expect(typeof body.unhealthy_lag_threshold_ms).toBe("number");
  });

  // GraphQL was retired alongside the API's switch to direct-DB reads. The
  // mount lived at `/` and `/graphql`; both must now 404 so a regression
  // (someone re-adds `app.use("/", graphql({...}))`) trips this test
  // instead of silently re-exposing the indexer's full schema to the world.
  it("does not mount GraphQL at /", async () => {
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    expect(res.status).toBe(404);
  });

  it("does not mount GraphQL at /graphql", async () => {
    const res = await app.request("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    expect(res.status).toBe(404);
  });
});
