import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { corsMiddleware } from "../middleware/cors.js";
import type { AppBindings } from "../lib/types.js";

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.use("*", corsMiddleware);
  app.get("/read", (c) => c.json({ ok: true }));
  app.post("/write", (c) => c.json({ ok: true }));
  app.put("/write", (c) => c.json({ ok: true }));
  return app;
}

function makeEnv(): AppBindings {
  return {
    ADMIN_API_KEY: "",
    DATABASE_URL: "",
    BOUNCETECH_DATABASE_URL: "",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

describe("corsMiddleware", () => {
  describe("read requests (public)", () => {
    it("returns wildcard for any origin on GET (CDN-cacheable)", async () => {
      const app = createApp();
      const res = await app.request(
        "/read",
        { headers: { Origin: "https://evil.com" } },
        makeEnv(),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("returns wildcard when no Origin header is sent", async () => {
      const app = createApp();
      const res = await app.request("/read", {}, makeEnv());

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("never sets Access-Control-Allow-Credentials", async () => {
      const app = createApp();
      const res = await app.request(
        "/read",
        { headers: { Origin: "https://alt.fun" } },
        makeEnv(),
      );

      expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });
  });

  describe("write requests (locked)", () => {
    it("reflects https://alt.fun on POST", async () => {
      const app = createApp();
      const res = await app.request(
        "/write",
        {
          method: "POST",
          headers: {
            Origin: "https://alt.fun",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
        makeEnv(),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://alt.fun");
    });

    it("reflects https://www.alt.fun on POST", async () => {
      const app = createApp();
      const res = await app.request(
        "/write",
        {
          method: "POST",
          headers: {
            Origin: "https://www.alt.fun",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
        makeEnv(),
      );

      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://www.alt.fun");
    });

    it("blocks https://evil.com on POST (no Allow-Origin header)", async () => {
      const app = createApp();
      const res = await app.request(
        "/write",
        {
          method: "POST",
          headers: {
            Origin: "https://evil.com",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
        makeEnv(),
      );

      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("blocks https://alt-fun.evil.com (subdomain bait) on POST", async () => {
      const app = createApp();
      const res = await app.request(
        "/write",
        {
          method: "POST",
          headers: {
            Origin: "https://alt-fun.evil.com",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
        makeEnv(),
      );

      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("allows localhost dev origins on PUT (any port)", async () => {
      const app = createApp();
      const res = await app.request(
        "/write",
        {
          method: "PUT",
          headers: {
            Origin: "http://localhost:5173",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
        makeEnv(),
      );

      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    });

    it("allows 127.0.0.1 dev origins on POST", async () => {
      const app = createApp();
      const res = await app.request(
        "/write",
        {
          method: "POST",
          headers: {
            Origin: "http://127.0.0.1:8787",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
        makeEnv(),
      );

      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:8787");
    });
  });

  describe("preflight requests", () => {
    it("approves write preflight from https://alt.fun", async () => {
      const app = createApp();
      const res = await app.request(
        "/write",
        {
          method: "OPTIONS",
          headers: {
            Origin: "https://alt.fun",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-api-key",
          },
        },
        makeEnv(),
      );

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://alt.fun");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });

    it("blocks write preflight from https://evil.com", async () => {
      const app = createApp();
      const res = await app.request(
        "/write",
        {
          method: "OPTIONS",
          headers: {
            Origin: "https://evil.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
          },
        },
        makeEnv(),
      );

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("approves read preflight from any origin (returns wildcard)", async () => {
      const app = createApp();
      const res = await app.request(
        "/read",
        {
          method: "OPTIONS",
          headers: {
            Origin: "https://third-party-integrator.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-api-key",
          },
        },
        makeEnv(),
      );

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });
});
