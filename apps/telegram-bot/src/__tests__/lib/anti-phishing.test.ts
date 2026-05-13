import { describe, it, expect } from "vitest";

import {
  ANTI_PHISHING_HEADER,
  resolveAntiPhishingHeader,
  withAntiPhishing,
} from "../../lib/anti-phishing.js";

describe("resolveAntiPhishingHeader", () => {
  it("returns the user phrase when set", () => {
    expect(resolveAntiPhishingHeader("purple-otter-42")).toBe(
      "purple-otter-42",
    );
  });

  it("falls back to the static header when the phrase is null", () => {
    expect(resolveAntiPhishingHeader(null)).toBe(ANTI_PHISHING_HEADER);
  });

  it("falls back to the static header when the phrase is undefined", () => {
    expect(resolveAntiPhishingHeader(undefined)).toBe(ANTI_PHISHING_HEADER);
  });
});

describe("withAntiPhishing", () => {
  it("prepends the user phrase followed by a blank line", () => {
    const out = withAntiPhishing("Body text", "purple-otter-42");
    expect(out).toBe("purple-otter-42\n\nBody text");
  });

  it("prepends the static header when no phrase is supplied", () => {
    const out = withAntiPhishing("Body text");
    expect(out).toBe(`${ANTI_PHISHING_HEADER}\n\nBody text`);
  });

  it("prepends the static header when phrase is null", () => {
    expect(withAntiPhishing("Body text", null)).toBe(
      `${ANTI_PHISHING_HEADER}\n\nBody text`,
    );
  });

  it("prepends the static header when phrase is undefined", () => {
    expect(withAntiPhishing("Body text", undefined)).toBe(
      `${ANTI_PHISHING_HEADER}\n\nBody text`,
    );
  });
});
