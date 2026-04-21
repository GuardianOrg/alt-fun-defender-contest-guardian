import { describe, expect, it } from "vitest";

import { sortLtMovers } from "../lib/token-enrich.js";

interface Item {
  label: string;
  ltChange24h: number | null;
  change24h: number | null;
}

const item = (
  label: string,
  ltChange24h: number | null,
  change24h: number | null,
): Item => ({ label, ltChange24h, change24h });

describe("sortLtMovers", () => {
  it("sorts by ltChange24h descending", () => {
    const result = sortLtMovers([
      item("a", 5, 1),
      item("b", 20, 1),
      item("c", 10, 1),
    ]).map((t) => t.label);
    expect(result).toEqual(["b", "c", "a"]);
  });

  it("tie-breaks equal ltChange24h by token change24h descending", () => {
    const result = sortLtMovers([
      item("a", 10, 3),
      item("b", 10, 7),
      item("c", 10, 1),
      item("d", 10, 5),
    ]).map((t) => t.label);
    expect(result).toEqual(["b", "d", "a", "c"]);
  });

  it("orders by LT first, token as tiebreak only", () => {
    // `b` wins overall because its LT moved more, even though `a` has a
    // higher token change24h. Product intent: we're ranking LT movers,
    // not token movers.
    const result = sortLtMovers([
      item("a", 5, 100),
      item("b", 20, 1),
    ]).map((t) => t.label);
    expect(result).toEqual(["b", "a"]);
  });

  it("excludes tokens with non-positive change24h", () => {
    const result = sortLtMovers([
      item("a", 10, 5),
      item("b", 10, -3), // token down
      item("c", 10, 0),  // token flat
      item("d", 10, 2),
    ]).map((t) => t.label);
    expect(result).toEqual(["a", "d"]);
  });

  it("excludes tokens with non-positive ltChange24h", () => {
    const result = sortLtMovers([
      item("a", 10, 5),
      item("b", -5, 5),  // LT down
      item("c", 0, 5),   // LT flat
      item("d", 3, 5),
    ]).map((t) => t.label);
    expect(result).toEqual(["a", "d"]);
  });

  it("excludes tokens with null ltChange24h or change24h", () => {
    const result = sortLtMovers([
      item("a", null, 5),
      item("b", 10, null),
      item("c", null, null),
      item("d", 10, 5),
    ]).map((t) => t.label);
    expect(result).toEqual(["d"]);
  });

  it("returns empty when no items survive filtering", () => {
    const result = sortLtMovers([
      item("a", -1, 10),
      item("b", 10, -1),
      item("c", null, 5),
    ]);
    expect(result).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [
      item("a", 5, 1),
      item("b", 20, 1),
      item("c", 10, 1),
    ];
    const snapshot = input.map((t) => t.label);
    sortLtMovers(input);
    expect(input.map((t) => t.label)).toEqual(snapshot);
  });
});
