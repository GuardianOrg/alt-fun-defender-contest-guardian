import { describe, expect, it } from "vitest";

import {
  INTENT_TTL_SECONDS,
  claimIntent,
  intentKey,
  markFinal,
  markSubmitted,
  readIntent,
  type IdempotencyKv,
} from "../../lib/idempotency.js";

/**
 * KV stub that records every `put` call so we can assert TTL is wired
 * through. Real Cloudflare KV expires entries via `expirationTtl`; if we
 * stop passing it the commit-log would accumulate state forever and
 * eventually break long-tail retries.
 */
class RecordingKv implements IdempotencyKv {
  readonly puts: Array<{
    key: string;
    value: string;
    options?: { expirationTtl?: number };
  }> = [];
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.puts.push({ key, value, options });
    this.store.set(key, value);
  }
}

describe("intentKey", () => {
  it("keys on (userId, nonce) so different users / nonces never collide", () => {
    expect(intentKey(7, "abc")).toBe("txintent:7:abc");
    expect(intentKey(8, "abc")).not.toBe(intentKey(7, "abc"));
    expect(intentKey(7, "xyz")).not.toBe(intentKey(7, "abc"));
  });
});

describe("claimIntent", () => {
  it("claims an empty slot and persists `submitting`", async () => {
    const kv = new RecordingKv();
    const outcome = await claimIntent(kv, intentKey(1, "n1"));
    expect(outcome.kind).toBe("claimed");
    const record = await readIntent(kv, intentKey(1, "n1"));
    expect(record?.status).toBe("submitting");
  });

  it("returns the prior record when the slot is already taken (no overwrite)", async () => {
    const kv = new RecordingKv();
    const key = intentKey(1, "n1");
    await claimIntent(kv, key);
    await markSubmitted(kv, key, "0xabc");

    const outcome = await claimIntent(kv, key);
    expect(outcome.kind).toBe("duplicate");
    if (outcome.kind === "duplicate") {
      expect(outcome.record.status).toBe("submitted");
      expect(outcome.record.txHash).toBe("0xabc");
    }
    // A duplicate claim must not write again — otherwise we'd erase the
    // hash and confuse the retry path that depends on it.
    const writes = kv.puts.filter((p) => p.key === key);
    expect(writes).toHaveLength(2); // one `claimed` + one `markSubmitted`, nothing more
  });

  it("writes every record with the 1-hour TTL so abandoned flows expire", async () => {
    const kv = new RecordingKv();
    const key = intentKey(1, "n1");
    await claimIntent(kv, key);
    await markSubmitted(kv, key, "0xabc");
    await markFinal(kv, key, {
      ok: true,
      txHash: "0xabc",
      quotedOut: "1",
      minOut: "1",
    });
    for (const put of kv.puts) {
      expect(put.options?.expirationTtl).toBe(INTENT_TTL_SECONDS);
    }
  });
});

describe("markSubmitted / markFinal", () => {
  it("`markSubmitted` records the tx hash so retries can re-await the receipt", async () => {
    const kv = new RecordingKv();
    const key = intentKey(1, "n1");
    await claimIntent(kv, key);
    await markSubmitted(kv, key, "0xdeadbeef");
    const record = await readIntent(kv, key);
    expect(record).toMatchObject({ status: "submitted", txHash: "0xdeadbeef" });
  });

  it("`markFinal` round-trips the serialised execution result", async () => {
    const kv = new RecordingKv();
    const key = intentKey(1, "n1");
    await claimIntent(kv, key);
    await markFinal(kv, key, {
      ok: true,
      txHash: "0xabc",
      quotedOut: "1000",
      minOut: "990",
    });
    const record = await readIntent(kv, key);
    expect(record?.status).toBe("completed");
    expect(record?.result).toMatchObject({
      ok: true,
      quotedOut: "1000",
      minOut: "990",
    });
  });

  it("`markFinal` with a failure flips status to `failed`", async () => {
    const kv = new RecordingKv();
    const key = intentKey(1, "n1");
    await claimIntent(kv, key);
    await markFinal(kv, key, { ok: false, kind: "reverted", reason: "boom" });
    const record = await readIntent(kv, key);
    expect(record?.status).toBe("failed");
    expect(record?.result?.kind).toBe("reverted");
  });
});

describe("readIntent", () => {
  it("returns null when the key has never been written", async () => {
    const kv = new RecordingKv();
    expect(await readIntent(kv, "txintent:1:never")).toBeNull();
  });

  it("returns null when the stored blob is malformed (defensive parse)", async () => {
    const kv = new RecordingKv();
    await kv.put("txintent:1:bad", "{not json");
    expect(await readIntent(kv, "txintent:1:bad")).toBeNull();
  });
});
