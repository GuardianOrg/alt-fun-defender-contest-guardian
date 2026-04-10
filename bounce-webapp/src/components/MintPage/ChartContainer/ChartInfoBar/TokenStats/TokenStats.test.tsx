import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";
import { vi, type Mock } from "vitest";

vi.mock("../../../../../hooks/useFetchTargetAssetsData", () => ({
  useFetchTargetAssetsData: vi.fn(),
}));

import TokenStats from "./TokenStats";
import { useFetchTargetAssetsData } from "../../../../../hooks/useFetchTargetAssetsData";

import type { Store } from "@reduxjs/toolkit";

const mockStore = configureMockStore([]);

describe("TokenStats", () => {
  const setLivePriceMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders correctly with valid data", () => {
    const store = mockStore({
      mint: {
        selected: {
          targetAsset: { symbol: "BTC" },
        },
      },
    }) as unknown as Store<unknown>; // <-- TS fix

    (useFetchTargetAssetsData as Mock).mockReturnValue([
      {
        symbol: "BTC",
        price: 100000,
        change24h: 100,
        change24hPct: 1,
        volume24h: 1000000,
        openInterest: 1000000000,
      },
    ]);

    render(
      <Provider store={store}>
        <TokenStats livePrice={null} setLivePrice={setLivePriceMock} />
      </Provider>,
    );

    expect(screen.getByText("Price")).toBeInTheDocument();
    expect(screen.getByText("24h Change")).toBeInTheDocument();
    expect(screen.getByText("24h Volume")).toBeInTheDocument();
    expect(screen.getByText("Open Interest")).toBeInTheDocument();
    expect(screen.getByText("100,000")).toBeInTheDocument();
    expect(screen.getByText("+100.00 / +1.00%")).toBeInTheDocument();
    expect(screen.getByText("$1,000,000.00")).toBeInTheDocument();
    expect(screen.getByText("$1,000,000,000.00")).toBeInTheDocument();
  });

  it("renders correctly with missing data", () => {
    const store = mockStore({
      mint: {
        selected: {
          targetAsset: { symbol: "BTC" },
        },
      },
    }) as unknown as Store<unknown>; // <-- TS fix

    (useFetchTargetAssetsData as Mock).mockReturnValue([
      {
        symbol: "BTC",
        price: undefined,
        change24h: undefined,
        change24hPct: undefined,
        volume24h: undefined,
        openInterest: undefined,
      },
    ]);

    render(
      <Provider store={store}>
        <TokenStats livePrice={null} setLivePrice={setLivePriceMock} />
      </Provider>,
    );

    expect(screen.getByText("Price")).toBeInTheDocument();
    expect(screen.getByText("24h Change")).toBeInTheDocument();
    expect(screen.getByText("24h Volume")).toBeInTheDocument();
    expect(screen.getByText("Open Interest")).toBeInTheDocument();

    expect(screen.getAllByText("--")).toHaveLength(3);
    expect(screen.getByText("-- / --")).toBeInTheDocument();
  });
});
