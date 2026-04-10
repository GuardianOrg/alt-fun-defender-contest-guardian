import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useEnsName } from "wagmi";

import useFormatAddress from "./useFormatAddress";

import type { Address } from "viem";

vi.mock("wagmi", () => ({
  useEnsName: vi.fn(),
}));

vi.mock("../utils/formatAddress.util", () => ({
  default: vi.fn(
    (address: Address | null, shorten?: boolean) =>
      address
        ? shorten
          ? address.slice(0, 4) + "..." + address.slice(-2)
          : address.slice(0, 6) + "..." + address.slice(-4)
        : "",
  ),
}));

const mockUseEnsName = vi.mocked(useEnsName);

const TEST_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as Address;

describe("useFormatAddress", () => {
  it("should return ENS name when available", () => {
    mockUseEnsName.mockReturnValue({
      data: "vitalik.eth",
    } as ReturnType<typeof useEnsName>);

    const { result } = renderHook(() => useFormatAddress(TEST_ADDRESS));
    expect(result.current).toBe("vitalik.eth");
  });

  it("should return formatted address when ENS name is not available", () => {
    mockUseEnsName.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useEnsName>);

    const { result } = renderHook(() => useFormatAddress(TEST_ADDRESS));
    expect(result.current).toBe("0x1234...5678");
  });

  it("should return formatted address when ENS name is null", () => {
    mockUseEnsName.mockReturnValue({
      data: null,
    } as ReturnType<typeof useEnsName>);

    const { result } = renderHook(() => useFormatAddress(TEST_ADDRESS));
    expect(result.current).toBe("0x1234...5678");
  });

  it("should return shortened formatted address when shorten is true", () => {
    mockUseEnsName.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useEnsName>);

    const { result } = renderHook(() => useFormatAddress(TEST_ADDRESS, true));
    expect(result.current).toBe("0x12...78");
  });

  it("should return empty string when address is null", () => {
    mockUseEnsName.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useEnsName>);

    const { result } = renderHook(() => useFormatAddress(null));
    expect(result.current).toBe("");
  });

  it("should pass mainnet chain ID to useEnsName", () => {
    mockUseEnsName.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useEnsName>);

    renderHook(() => useFormatAddress(TEST_ADDRESS));
    expect(mockUseEnsName).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      chainId: 1,
    });
  });

  it("should pass undefined address to useEnsName when address is null", () => {
    mockUseEnsName.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useEnsName>);

    renderHook(() => useFormatAddress(null));
    expect(mockUseEnsName).toHaveBeenCalledWith({
      address: undefined,
      chainId: 1,
    });
  });

  it("should prefer ENS name over formatted address regardless of shorten flag", () => {
    mockUseEnsName.mockReturnValue({
      data: "alice.eth",
    } as ReturnType<typeof useEnsName>);

    const { result } = renderHook(() => useFormatAddress(TEST_ADDRESS, true));
    expect(result.current).toBe("alice.eth");
  });
});
