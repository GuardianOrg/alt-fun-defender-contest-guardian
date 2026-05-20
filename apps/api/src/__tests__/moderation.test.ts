import { buildSessionMessage, SESSION_DURATION_MS } from "@launchpad/shared";
import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type { AppBindings } from "../lib/types.js";

// Drizzle update().set().where().returning() chain. The route returns
// `[updated]` where `updated` is `{ address, isHidden }`. Each test
// stubs `mockReturning` to control the resulting row count.
const mockReturning = vi.fn();
const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    update: mockUpdate,
  }),
}));

const { default: moderationRoute } = await import("../routes/moderation.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/moderation", moderationRoute);
  return app;
}

// Pin the admin allowlist via env so we don't depend on the
// `DEFAULT_ADMIN_WALLETS` constant matching whatever address we sign with
// in this test.
const ADMIN_PRIVATE_KEY = generatePrivateKey();
const ADMIN_ACCOUNT = privateKeyToAccount(ADMIN_PRIVATE_KEY);
const NON_ADMIN_PRIVATE_KEY = generatePrivateKey();
const NON_ADMIN_ACCOUNT = privateKeyToAccount(NON_ADMIN_PRIVATE_KEY);

const TOKEN = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";

function makeEnv(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    HYPERDRIVE: { connectionString: "postgres://hyperdrive-test" } as unknown as Hyperdrive,
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    ADMIN_WALLETS: ADMIN_ACCOUNT.address,
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
    ...overrides,
  };
}

async function signSession(
  account: typeof ADMIN_ACCOUNT,
  expiresAt: number,
): Promise<string> {
  return account.signMessage({
    message: buildSessionMessage(account.address, expiresAt),
  });
}

describe("GET /moderation/admins/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for an invalid address", async () => {
    const app = createApp();
    const res = await app.request("/moderation/admins/not-an-address", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns isAdmin=true for a wallet in the allowlist", async () => {
    const app = createApp();
    const res = await app.request(
      `/moderation/admins/${ADMIN_ACCOUNT.address}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { isAdmin: boolean; address: string } };
    expect(body.data.isAdmin).toBe(true);
    // Echoes back the canonical checksum form so callers can use it
    // as a stable key without re-checksumming.
    expect(body.data.address).toBe(ADMIN_ACCOUNT.address);
  });

  it("returns isAdmin=false for a wallet not in the allowlist", async () => {
    const app = createApp();
    const res = await app.request(
      `/moderation/admins/${NON_ADMIN_ACCOUNT.address}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { isAdmin: boolean } };
    expect(body.data.isAdmin).toBe(false);
  });

  it("matches addresses regardless of input casing", async () => {
    const app = createApp();
    const res = await app.request(
      `/moderation/admins/${ADMIN_ACCOUNT.address.toLowerCase()}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { isAdmin: boolean } };
    expect(body.data.isAdmin).toBe(true);
  });

  it("falls back to the shared default allowlist when ADMIN_WALLETS is unset", async () => {
    // The hardcoded canonical admin from `DEFAULT_ADMIN_WALLETS`. Wired
    // for the issue #586 launch — if this changes, both this test and
    // the docstring on `DEFAULT_ADMIN_WALLETS` need updating in lockstep.
    const CANONICAL = "0xef126Ea643fC8940D9D6634DCd07F3989963Fbe6";
    const env = makeEnv({ ADMIN_WALLETS: undefined });
    const app = createApp();
    const res = await app.request(`/moderation/admins/${CANONICAL}`, {}, env);
    const body = (await res.json()) as { data: { isAdmin: boolean } };
    expect(body.data.isAdmin).toBe(true);
  });

  it("supports a comma-separated allowlist with whitespace tolerated", async () => {
    const env = makeEnv({
      ADMIN_WALLETS: `   ${ADMIN_ACCOUNT.address}  ,${NON_ADMIN_ACCOUNT.address}  `,
    });
    const app = createApp();
    const a = await app.request(
      `/moderation/admins/${ADMIN_ACCOUNT.address}`,
      {},
      env,
    );
    const b = await app.request(
      `/moderation/admins/${NON_ADMIN_ACCOUNT.address}`,
      {},
      env,
    );
    const aBody = (await a.json()) as { data: { isAdmin: boolean } };
    const bBody = (await b.json()) as { data: { isAdmin: boolean } };
    expect(aBody.data.isAdmin).toBe(true);
    expect(bBody.data.isAdmin).toBe(true);
  });
});

async function postHide(args: {
  app: ReturnType<typeof createApp>;
  env: AppBindings;
  token: string;
  body: Record<string, unknown>;
}): Promise<Response> {
  return args.app.request(
    `/moderation/tokens/${args.token}/hide`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args.body),
    },
    args.env,
  );
}

describe("POST /moderation/tokens/:address/hide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReturning.mockResolvedValue([{ address: TOKEN, isHidden: true }]);
  });

  it("returns 400 for an invalid token address", async () => {
    const app = createApp();
    const expiresAt = Date.now() + 60_000;
    const signature = await signSession(ADMIN_ACCOUNT, expiresAt);
    const res = await postHide({
      app,
      env: makeEnv(),
      token: "not-an-address",
      body: { address: ADMIN_ACCOUNT.address, signature, expiresAt },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is missing required fields", async () => {
    const app = createApp();
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the signing address is not a valid hex address", async () => {
    const app = createApp();
    const expiresAt = Date.now() + 60_000;
    const signature = await signSession(ADMIN_ACCOUNT, expiresAt);
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      body: { address: "not-an-address", signature, expiresAt },
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 for an expired session signature", async () => {
    const expiresAt = Date.now() - 1_000;
    const signature = await signSession(ADMIN_ACCOUNT, expiresAt);
    const app = createApp();
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      body: { address: ADMIN_ACCOUNT.address, signature, expiresAt },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("expired");
  });

  it("returns 401 when expiresAt exceeds the maximum lifetime", async () => {
    // 30 days out — way past SESSION_DURATION_MS (24h).
    const expiresAt = Date.now() + SESSION_DURATION_MS * 30;
    const signature = await signSession(ADMIN_ACCOUNT, expiresAt);
    const app = createApp();
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      body: { address: ADMIN_ACCOUNT.address, signature, expiresAt },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when the signature is malformed", async () => {
    const expiresAt = Date.now() + 60_000;
    const app = createApp();
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      body: {
        address: ADMIN_ACCOUNT.address,
        signature: "0xdeadbeef",
        expiresAt,
      },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when the recovered signer doesn't match the claimed address", async () => {
    // Sign with a different account than `address` claims.
    const expiresAt = Date.now() + 60_000;
    const signature = await signSession(NON_ADMIN_ACCOUNT, expiresAt);
    const app = createApp();
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      // Claims to be ADMIN but actually signed by NON_ADMIN. Signature
      // recovery should produce NON_ADMIN's address, which won't match
      // the claimed ADMIN_ACCOUNT.address.
      body: { address: ADMIN_ACCOUNT.address, signature, expiresAt },
    });
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 when the signer is not in the allowlist", async () => {
    const expiresAt = Date.now() + 60_000;
    const signature = await signSession(NON_ADMIN_ACCOUNT, expiresAt);
    const app = createApp();
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      body: { address: NON_ADMIN_ACCOUNT.address, signature, expiresAt },
    });
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the token does not exist in the registry", async () => {
    mockReturning.mockResolvedValueOnce([]);
    const expiresAt = Date.now() + 60_000;
    const signature = await signSession(ADMIN_ACCOUNT, expiresAt);
    const app = createApp();
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      body: { address: ADMIN_ACCOUNT.address, signature, expiresAt },
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 and updates the token when the signature is valid", async () => {
    const expiresAt = Date.now() + 60_000;
    const signature = await signSession(ADMIN_ACCOUNT, expiresAt);
    const app = createApp();
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      body: { address: ADMIN_ACCOUNT.address, signature, expiresAt },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { address: string; isHidden: boolean; admin: string };
    };
    expect(body.data.isHidden).toBe(true);
    expect(body.data.admin).toBe(ADMIN_ACCOUNT.address);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith({ isHidden: true });
  });

  it("accepts a lowercased address in the body and normalises to checksum", async () => {
    const expiresAt = Date.now() + 60_000;
    const signature = await signSession(ADMIN_ACCOUNT, expiresAt);
    const app = createApp();
    const res = await postHide({
      app,
      env: makeEnv(),
      token: TOKEN,
      body: {
        address: ADMIN_ACCOUNT.address.toLowerCase(),
        signature,
        expiresAt,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { admin: string } };
    expect(body.data.admin).toBe(ADMIN_ACCOUNT.address);
  });
});

describe("POST /moderation/tokens/:address/unhide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReturning.mockResolvedValue([{ address: TOKEN, isHidden: false }]);
  });

  it("returns 200 with isHidden=false when the signature is valid", async () => {
    const expiresAt = Date.now() + 60_000;
    const signature = await signSession(ADMIN_ACCOUNT, expiresAt);
    const app = createApp();
    const res = await app.request(
      `/moderation/tokens/${TOKEN}/unhide`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: ADMIN_ACCOUNT.address,
          signature,
          expiresAt,
        }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { isHidden: boolean } };
    expect(body.data.isHidden).toBe(false);
    expect(mockSet).toHaveBeenCalledWith({ isHidden: false });
  });

  it("returns 401 for a non-admin signer (same body shape as hide)", async () => {
    const expiresAt = Date.now() + 60_000;
    const signature = await signSession(NON_ADMIN_ACCOUNT, expiresAt);
    const app = createApp();
    const res = await app.request(
      `/moderation/tokens/${TOKEN}/unhide`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: NON_ADMIN_ACCOUNT.address,
          signature,
          expiresAt,
        }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
