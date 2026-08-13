import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchTokenValidity } from "./api";
import {
  _resetTokenValidityCache,
  isTokenValid,
} from "./tokenValidity";

vi.mock("./api", () => ({
  fetchTokenValidity: vi.fn(),
}));

const fetchTokenValidityMock = vi.mocked(fetchTokenValidity);

describe("isTokenValid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    _resetTokenValidityCache();
    fetchTokenValidityMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches a positive result and re-fetches after the TTL", async () => {
    fetchTokenValidityMock.mockResolvedValue(true);

    await expect(isTokenValid("0xabc")).resolves.toBe(true);
    await expect(isTokenValid("0xabc")).resolves.toBe(true);
    expect(fetchTokenValidityMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    await expect(isTokenValid("0xabc")).resolves.toBe(true);
    expect(fetchTokenValidityMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a negative result cached for the page lifetime", async () => {
    fetchTokenValidityMock.mockResolvedValue(false);

    await expect(isTokenValid("0xabc")).resolves.toBe(false);
    vi.advanceTimersByTime(60_000);
    await expect(isTokenValid("0xabc")).resolves.toBe(false);
    expect(fetchTokenValidityMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a transient fetch failure", async () => {
    fetchTokenValidityMock.mockRejectedValueOnce(new Error("503"));
    fetchTokenValidityMock.mockResolvedValueOnce(true);

    await expect(isTokenValid("0xabc")).resolves.toBe(false);
    await expect(isTokenValid("0xabc")).resolves.toBe(true);
    expect(fetchTokenValidityMock).toHaveBeenCalledTimes(2);
  });
});
