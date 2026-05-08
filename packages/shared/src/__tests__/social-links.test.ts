import { describe, expect, it } from "vitest";

import {
  buildTelegramUrl,
  buildTwitterUrl,
  buildWebsiteUrl,
  sanitizeTelegramHandle,
  sanitizeTwitterHandle,
  sanitizeWebsiteUrl,
} from "../social-links.js";

describe("sanitizeTwitterHandle", () => {
  it("normalises bare handles", () => {
    expect(sanitizeTwitterHandle("alice")).toBe("alice");
    expect(sanitizeTwitterHandle("@alice")).toBe("alice");
    expect(sanitizeTwitterHandle("  alice  ")).toBe("alice");
  });

  it("extracts handles from x.com / twitter.com URLs", () => {
    expect(sanitizeTwitterHandle("https://x.com/alice")).toBe("alice");
    expect(sanitizeTwitterHandle("https://twitter.com/alice")).toBe("alice");
    expect(sanitizeTwitterHandle("https://www.twitter.com/alice")).toBe("alice");
    expect(sanitizeTwitterHandle("https://mobile.twitter.com/alice")).toBe("alice");
    expect(sanitizeTwitterHandle("https://x.com/alice/status/123")).toBe("alice");
    expect(sanitizeTwitterHandle("https://X.COM/alice")).toBe("alice");
  });

  it("rejects javascript: and other non-http schemes", () => {
    expect(sanitizeTwitterHandle("javascript:alert(1)")).toBe("");
    expect(sanitizeTwitterHandle("data:text/html,<script>")).toBe("");
    expect(sanitizeTwitterHandle("file:///etc/passwd")).toBe("");
  });

  it("rejects look-alike / phishing hosts", () => {
    expect(sanitizeTwitterHandle("https://x.com.evil.tld/login")).toBe("");
    expect(sanitizeTwitterHandle("https://evil.tld/x.com/alice")).toBe("");
    // IDN homograph (Cyrillic 'х' renders as 'x'). The URL parser keeps it
    // raw, so we miss the host-allowlist check and reject — exactly what we
    // want.
    expect(sanitizeTwitterHandle("https://х.com/alice")).toBe("");
  });

  it("rejects handles that violate Twitter's character / length rules", () => {
    expect(sanitizeTwitterHandle("nope!")).toBe("");
    expect(sanitizeTwitterHandle("hi.there")).toBe("");
    expect(sanitizeTwitterHandle("a".repeat(16))).toBe("");
    // 16-char handle inside a well-formed URL: exercises the post-parse
    // regex check rather than the URL parser bailing on a malformed input.
    expect(sanitizeTwitterHandle(`https://x.com/${"a".repeat(16)}`)).toBe("");
  });

  it("returns empty for empty / null / undefined input", () => {
    expect(sanitizeTwitterHandle("")).toBe("");
    expect(sanitizeTwitterHandle("   ")).toBe("");
    expect(sanitizeTwitterHandle(null)).toBe("");
    expect(sanitizeTwitterHandle(undefined)).toBe("");
  });
});

describe("sanitizeTelegramHandle", () => {
  it("normalises bare usernames and t.me/ shortcuts", () => {
    expect(sanitizeTelegramHandle("alice")).toBe("alice");
    expect(sanitizeTelegramHandle("@alice")).toBe("alice");
    expect(sanitizeTelegramHandle("t.me/alice")).toBe("alice");
    expect(sanitizeTelegramHandle("telegram.me/alice")).toBe("alice");
  });

  it("extracts handles from t.me / telegram.me URLs", () => {
    expect(sanitizeTelegramHandle("https://t.me/alice")).toBe("alice");
    expect(sanitizeTelegramHandle("https://telegram.me/alice")).toBe("alice");
    expect(sanitizeTelegramHandle("https://t.me/alice/12345")).toBe("alice");
  });

  it("preserves invite-link tails", () => {
    expect(sanitizeTelegramHandle("https://t.me/+abcDEF1234")).toBe("+abcDEF1234");
    expect(sanitizeTelegramHandle("https://t.me/joinchat/AAAAAEHbN-1Zw")).toBe(
      "joinchat/AAAAAEHbN-1Zw",
    );
  });

  it("rejects non-telegram hosts and non-http schemes", () => {
    expect(sanitizeTelegramHandle("https://t.me.evil.tld/alice")).toBe("");
    expect(sanitizeTelegramHandle("javascript:alert(1)")).toBe("");
    expect(sanitizeTelegramHandle("data:text/html,<script>")).toBe("");
  });

  it("rejects path traversal attempts inside invite links", () => {
    expect(sanitizeTelegramHandle("https://t.me/joinchat/../foo")).toBe("");
  });

  it("rejects usernames outside the 4-32 char alphanumeric range", () => {
    expect(sanitizeTelegramHandle("ab")).toBe("");
    expect(sanitizeTelegramHandle("a".repeat(33))).toBe("");
    expect(sanitizeTelegramHandle("hi.there")).toBe("");
  });
});

describe("sanitizeWebsiteUrl", () => {
  it("accepts and canonicalises plain http(s) URLs", () => {
    expect(sanitizeWebsiteUrl("https://example.com")).toBe("https://example.com/");
    expect(sanitizeWebsiteUrl("http://example.com/foo?a=1")).toBe("http://example.com/foo?a=1");
    expect(sanitizeWebsiteUrl("https://sub.example.com/")).toBe("https://sub.example.com/");
  });

  it("auto-prefixes bare hosts with https", () => {
    expect(sanitizeWebsiteUrl("example.com")).toBe("https://example.com/");
    expect(sanitizeWebsiteUrl("example.com/foo")).toBe("https://example.com/foo");
  });

  it("rejects javascript: / data: / file: schemes", () => {
    expect(sanitizeWebsiteUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeWebsiteUrl("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(sanitizeWebsiteUrl("file:///etc/passwd")).toBe("");
    expect(sanitizeWebsiteUrl("ftp://example.com")).toBe("");
  });

  it("rejects URLs with embedded userinfo (phishing vector)", () => {
    expect(sanitizeWebsiteUrl("https://user:pass@evil.com")).toBe("");
    expect(sanitizeWebsiteUrl("https://x.com@evil.com")).toBe("");
  });

  it("rejects single-label hosts", () => {
    expect(sanitizeWebsiteUrl("https://localhost")).toBe("");
    expect(sanitizeWebsiteUrl("https://intranet/admin")).toBe("");
  });

  it("rejects non-ASCII hostnames (force punycode)", () => {
    expect(sanitizeWebsiteUrl("https://х.com")).toBe("");
    expect(sanitizeWebsiteUrl("https://пример.com")).toBe("");
  });

  it("returns empty for empty / null / undefined input", () => {
    expect(sanitizeWebsiteUrl("")).toBe("");
    expect(sanitizeWebsiteUrl(null)).toBe("");
    expect(sanitizeWebsiteUrl(undefined)).toBe("");
  });
});

describe("buildTwitterUrl / buildTelegramUrl / buildWebsiteUrl", () => {
  it("builds canonical URLs for valid stored values", () => {
    expect(buildTwitterUrl("alice")).toBe("https://x.com/alice");
    expect(buildTwitterUrl("https://twitter.com/alice")).toBe("https://x.com/alice");
    expect(buildTelegramUrl("alice")).toBe("https://t.me/alice");
    expect(buildTelegramUrl("+abc1234")).toBe("https://t.me/+abc1234");
    expect(buildWebsiteUrl("example.com")).toBe("https://example.com/");
  });

  it("returns null when the stored value is unsafe / unparseable", () => {
    expect(buildTwitterUrl("javascript:alert(1)")).toBeNull();
    expect(buildTelegramUrl("https://evil.tld")).toBeNull();
    expect(buildWebsiteUrl("javascript:alert(1)")).toBeNull();
    expect(buildWebsiteUrl("")).toBeNull();
  });
});
