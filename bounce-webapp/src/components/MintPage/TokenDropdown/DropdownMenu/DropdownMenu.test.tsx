import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";
import { vi, type Mock } from "vitest";

import DropdownMenu from "./DropdownMenu";
import { TARGET_ASSETS } from "../../../../constants/targetAssets";
import { useFetchTargetAssetsData } from "../../../../hooks/useFetchTargetAssetsData";
import { useIsMobile } from "../../../../hooks/useIsMobile";
import {
  setIsTokenDropdownOpen,
  setSelectedTargetAsset,
} from "../../../../state/mintSlice";

import type { Store } from "@reduxjs/toolkit";

const navigateMock = vi.fn();

vi.mock("react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../../hooks/useIsMobile", () => ({
  useIsMobile: vi.fn(),
}));

vi.mock("../../../../hooks/useFetchTargetAssetsData", () => ({
  useFetchTargetAssetsData: vi.fn(),
}));

const mockStore = configureMockStore([]);

const baseStoreState = {
  mint: {
    selected: {
      targetAsset: TARGET_ASSETS[0],
      leverage: 5,
      longOrShort: "long",
    },
    pageUi: {
      isTokenDropdownOpen: true,
    },
  },
};

const store = mockStore(baseStoreState);

/* ---------------- test data ---------------- */

const mockMarketData = TARGET_ASSETS.map((token) => ({
  symbol: token.symbol,
  price: 100,
  change24h: 200,
  change24hPct: 30,
  volume24h: 400,
  openInterest: 0,
}));

/* ---------------- tests ---------------- */

describe("DropdownMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clearActions();

    (useIsMobile as Mock).mockReturnValue(false);
    (useFetchTargetAssetsData as Mock).mockReturnValue(mockMarketData);
  });

  it("renders correctly when no token data is available", () => {
    (useFetchTargetAssetsData as Mock).mockReturnValue([]);

    render(
      <Provider store={store as Store}>
        <DropdownMenu />
      </Provider>,
    );

    for (const token of TARGET_ASSETS) {
      expect(screen.getByText(token.symbol)).toBeInTheDocument();
    }

    expect(screen.getAllByText("--")).toHaveLength(TARGET_ASSETS.length * 2);
    expect(screen.getByTestId("dropdown-menu-background")).toBeInTheDocument();
  });

  it("renders correctly with data", () => {
    render(
      <Provider store={store as Store}>
        <DropdownMenu />
      </Provider>,
    );

    for (const token of TARGET_ASSETS) {
      expect(screen.getByText(token.symbol)).toBeInTheDocument();
      expect(screen.getByAltText(`${token.symbol} logo`)).toBeInTheDocument();
    }

    expect(screen.getAllByText(/100/)).toHaveLength(TARGET_ASSETS.length);
    expect(screen.getAllByText(/200/)).toHaveLength(TARGET_ASSETS.length);
    expect(screen.getAllByText(/30.00%/)).toHaveLength(TARGET_ASSETS.length);
    expect(screen.getAllByText(/400/)).toHaveLength(TARGET_ASSETS.length);
  });

  it("selecting a token dispatches correct actions and navigates", () => {
    render(
      <Provider store={store as Store}>
        <DropdownMenu />
      </Provider>,
    );

    const token = TARGET_ASSETS[0];
    const row = screen.getByText(token.symbol).closest("tr");
    expect(row).toBeInTheDocument();

    if (row) fireEvent.click(row);

    const actions = store.getActions();

    expect(actions).toContainEqual(setIsTokenDropdownOpen(false));
    expect(actions).toContainEqual(setSelectedTargetAsset(token));
    expect(navigateMock).toHaveBeenCalledWith(`/mint/${token.symbol}5L`);
  });

  it("clicking background closes dropdown", () => {
    render(
      <Provider store={store as Store}>
        <DropdownMenu />
      </Provider>,
    );

    const background = screen.getByTestId("dropdown-menu-background");
    fireEvent.click(background);

    const actions = store.getActions();
    expect(actions).toContainEqual(setIsTokenDropdownOpen(false));
  });

  it("clicking close button closes dropdown", () => {
    render(
      <Provider store={store as Store}>
        <DropdownMenu />
      </Provider>,
    );

    const closeBtn = screen.getByTestId("close-button");
    fireEvent.click(closeBtn);

    const actions = store.getActions();
    expect(actions).toContainEqual(setIsTokenDropdownOpen(false));
  });

  it("volume column is hidden on mobile", () => {
    (useIsMobile as Mock).mockReturnValue(true);

    render(
      <Provider store={store as Store}>
        <DropdownMenu />
      </Provider>,
    );

    expect(screen.queryByText(/Volume/)).not.toBeInTheDocument();
  });

  describe("DropdownMenu search", () => {
    it("filters rows based on search input", () => {
      render(
        <Provider store={store as Store}>
          <DropdownMenu />
        </Provider>,
      );

      const searchInput = screen.getByPlaceholderText("Search by symbol");
      expect(searchInput).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: "BTC" } });

      const rows = screen.getAllByRole("row");
      const dataRows = rows.slice(1);

      expect(dataRows).toHaveLength(1);
      expect(screen.getByText("BTC")).toBeInTheDocument();

      fireEvent.change(searchInput, {
        target: { value: "randomsearchinput" },
      });

      const invalidSearchRows = screen.getAllByRole("row");
      expect(invalidSearchRows).toHaveLength(2); // header + "no results"
    });
  });
});
