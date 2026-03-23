import { describe, it, expect } from "vitest";

import { getPaginationRange } from "./Pagination.utils";

describe("getPaginationRange", () => {
  it("returns all pages when totalPages is small", () => {
    const result = getPaginationRange(5, 1);

    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it("shows right ellipsis when current page is near the start", () => {
    const result = getPaginationRange(10, 2);

    expect(result).toEqual([1, 2, 3, "...", 10]);
  });

  it("shows left ellipsis when current page is near the end", () => {
    const result = getPaginationRange(10, 9);

    expect(result).toEqual([1, "...", 8, 9, 10]);
  });

  it("shows both ellipses when current page is in the middle", () => {
    const result = getPaginationRange(10, 5);

    expect(result).toEqual([1, "...", 4, 5, 6, "...", 10]);
  });

  it("respects siblingCount", () => {
    const result = getPaginationRange(15, 8, 2);

    expect(result).toEqual([1, "...", 6, 7, 8, 9, 10, "...", 15]);
  });

  it("does not duplicate pages near the start", () => {
    const result = getPaginationRange(10, 3);

    expect(result).toEqual([1, 2, 3, 4, "...", 10]);
  });

  it("does not duplicate pages near the end", () => {
    const result = getPaginationRange(10, 8);

    expect(result).toEqual([1, "...", 7, 8, 9, 10]);
  });

  it("always includes first and last page", () => {
    const result = getPaginationRange(20, 10);

    expect(result[0]).toBe(1);
    expect(result[result.length - 1]).toBe(20);
  });
});
