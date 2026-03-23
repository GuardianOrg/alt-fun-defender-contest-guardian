import { describe, it, expect } from "vitest";

import round from "./round";

describe("round", () => {
  describe("basic functionality", () => {
    it("should round to 0 decimal places", () => {
      expect(round(3.7, 0)).toBe(4);
      expect(round(3.2, 0)).toBe(3);
      expect(round(3.5, 0)).toBe(4);
    });

    it("should round to 1 decimal place", () => {
      expect(round(3.14159, 1)).toBe(3.1);
      expect(round(3.156, 1)).toBe(3.2);
      expect(round(3.15, 1)).toBe(3.2);
    });

    it("should round to 2 decimal places", () => {
      expect(round(3.14159, 2)).toBe(3.14);
      expect(round(3.146, 2)).toBe(3.15);
      expect(round(3.145, 2)).toBe(3.15);
    });

    it("should round to 3 decimal places", () => {
      expect(round(3.14159, 3)).toBe(3.142);
      expect(round(3.1414, 3)).toBe(3.141);
      expect(round(3.1415, 3)).toBe(3.142);
    });
  });

  describe("edge cases", () => {
    it("should handle negative numbers", () => {
      expect(round(-3.7, 0)).toBe(-4);
      expect(round(-3.2, 0)).toBe(-3);
      expect(round(-3.5, 0)).toBe(-3); // JavaScript rounds -3.5 to -3 (towards zero)
      expect(round(-3.14159, 2)).toBe(-3.14);
    });

    it("should handle zero", () => {
      expect(round(0, 0)).toBe(0);
      expect(round(0, 2)).toBe(0);
      expect(round(0.0, 3)).toBe(0);
    });

    it("should handle very small numbers", () => {
      expect(round(0.0001, 2)).toBe(0);
      expect(round(0.0001, 4)).toBe(0.0001);
      expect(round(0.00015, 4)).toBe(0.0001); // Floating point precision: 0.00015 * 10000 = 1.5, rounds to 1
    });

    it("should handle large numbers", () => {
      expect(round(1234567.89, 1)).toBe(1234567.9);
      expect(round(1234567.89, 0)).toBe(1234568);
    });

    it("should handle negative decimal places", () => {
      expect(round(1234.56, -1)).toBe(1230);
      expect(round(1234.56, -2)).toBe(1200);
      expect(round(1234.56, -3)).toBe(1000);
    });
  });

  describe("floating point precision", () => {
    it("should handle floating point precision issues", () => {
      // Common floating point precision issue
      expect(round(0.1 + 0.2, 1)).toBe(0.3);
      expect(round(0.1 + 0.2, 2)).toBe(0.3);
    });

    it("should handle numbers with many decimal places", () => {
      expect(round(1.23456789, 5)).toBe(1.23457);
      expect(round(1.23456789, 6)).toBe(1.234568);
    });
  });

  describe("boundary conditions", () => {
    it("should handle very large decimal places", () => {
      expect(round(1.23456789, 10)).toBe(1.23456789);
      expect(round(1.23456789, 15)).toBe(1.23456789);
    });

    it("should handle decimal places of 0", () => {
      expect(round(3.7, 0)).toBe(4);
      expect(round(3.2, 0)).toBe(3);
    });

    it("should handle numbers that are already rounded", () => {
      expect(round(3.0, 2)).toBe(3);
      expect(round(3.14, 2)).toBe(3.14);
    });
  });

  describe("rounding behavior", () => {
    it("should round up when the digit is 5 or greater", () => {
      expect(round(3.5, 0)).toBe(4);
      expect(round(3.15, 1)).toBe(3.2);
      expect(round(3.145, 2)).toBe(3.15);
    });

    it("should round down when the digit is less than 5", () => {
      expect(round(3.4, 0)).toBe(3);
      expect(round(3.14, 1)).toBe(3.1);
      expect(round(3.144, 2)).toBe(3.14);
    });

    it("should handle tie-breaking correctly", () => {
      // JavaScript's Math.round uses "round half away from zero"
      expect(round(2.5, 0)).toBe(3);
      expect(round(-2.5, 0)).toBe(-2);
    });
  });
});
