import { renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router";
import configureMockStore from "redux-mock-store";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  useSyncTokenFromURL,
  useSelectPositionAndNavigate,
} from "./useMintPageRouting";
import { TARGET_ASSETS } from "../../constants/targetAssets";
import {
  setSelectedTargetAsset,
  setLeverage,
  setLongOrShort,
} from "../../state/mintSlice";

import type { Store } from "@reduxjs/toolkit";

const mockStore = configureMockStore([]);
const HYPE = TARGET_ASSETS[0].symbol;
const ETH = TARGET_ASSETS.find((a) => a.symbol === "ETH")!.symbol;

// Helper to render the hook within Redux + Router
function renderWithContext({
  url = "/mint/HYPE",
  store,
}: {
  url: string;
  store: ReturnType<typeof mockStore>;
}) {
  return renderHook(
    () => {
      useSyncTokenFromURL();
      useSelectPositionAndNavigate();
    },
    {
      wrapper: ({ children }) => (
        <Provider store={store as Store}>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route path="/mint/:targetAssetParam" element={children} />
              <Route path="*" element={children} />
            </Routes>
          </MemoryRouter>
        </Provider>
      ),
    },
  );
}

describe("useSyncToken hooks", () => {
  let store: ReturnType<typeof mockStore>;

  beforeEach(() => {
    store = mockStore({
      mint: {
        selected: {
          targetAsset: TARGET_ASSETS[0],
          leverage: 5,
          longOrShort: "long",
        },
      },
    });
  });

  // URL → Redux Sync (plain asset)
  it("syncs valid URL token into Redux", () => {
    const url = `/mint/${ETH}`;
    renderWithContext({ url, store });
    const actions = store.getActions();
    expect(actions).toContainEqual(
      setSelectedTargetAsset(TARGET_ASSETS.find((a) => a.symbol === ETH)!),
    );
  });

  it("redirects to last valid Redux token when URL token is invalid", () => {
    const url = "/mint/INVALID";
    store.dispatch = vi.fn();
    renderWithContext({ url, store });
    expect(store.getActions().length).toBe(0); // no dispatches called
  });

  it("does nothing when URL contains no param", () => {
    const url = "/mint";
    store.dispatch = vi.fn();
    renderWithContext({ url, store });
    expect(store.getActions().length).toBe(0);
  });

  // URL → Redux Sync (leveraged token symbols)
  it("syncs leveraged token URL (ETH5L) into Redux with asset, leverage, and direction", () => {
    const url = "/mint/ETH5L";
    const testStore = mockStore({
      mint: {
        selected: {
          targetAsset: TARGET_ASSETS[0],
          leverage: 2,
          longOrShort: "short",
        },
      },
    });
    renderWithContext({ url, store: testStore });
    const actions = testStore.getActions();
    expect(actions).toContainEqual(
      setSelectedTargetAsset(TARGET_ASSETS.find((a) => a.symbol === "ETH")!),
    );
    expect(actions).toContainEqual(setLeverage(5));
    expect(actions).toContainEqual(setLongOrShort("long"));
  });

  it("syncs leveraged token URL (BTC3S) into Redux with asset, leverage, and direction", () => {
    const url = "/mint/BTC3S";
    renderWithContext({ url, store });
    const actions = store.getActions();
    expect(actions).toContainEqual(
      setSelectedTargetAsset(TARGET_ASSETS.find((a) => a.symbol === "BTC")!),
    );
    expect(actions).toContainEqual(setLeverage(3));
    expect(actions).toContainEqual(setLongOrShort("short"));
  });

  it("syncs leveraged token URL case-insensitively", () => {
    const url = "/mint/eth2l";
    const testStore = mockStore({
      mint: {
        selected: {
          targetAsset: TARGET_ASSETS[0],
          leverage: 5,
          longOrShort: "short",
        },
      },
    });
    renderWithContext({ url, store: testStore });
    const actions = testStore.getActions();
    expect(actions).toContainEqual(
      setSelectedTargetAsset(TARGET_ASSETS.find((a) => a.symbol === "ETH")!),
    );
    expect(actions).toContainEqual(setLeverage(2));
    expect(actions).toContainEqual(setLongOrShort("long"));
  });

  it("does not dispatch leverage/direction for plain asset URL", () => {
    const url = `/mint/${ETH}`;
    renderWithContext({ url, store });
    const actions = store.getActions();
    expect(actions).toContainEqual(
      setSelectedTargetAsset(TARGET_ASSETS.find((a) => a.symbol === ETH)!),
    );
    expect(actions).not.toContainEqual(expect.objectContaining({ type: setLeverage.type }));
    expect(actions).not.toContainEqual(expect.objectContaining({ type: setLongOrShort.type }));
  });

  // Redux → URL Sync
  it("does not dispatch when URL asset matches Redux and no leverage in URL", () => {
    const testStore = mockStore({
      mint: {
        selected: {
          targetAsset: TARGET_ASSETS[1],
          leverage: 5,
          longOrShort: "long",
        },
      },
    });
    testStore.dispatch = vi.fn();
    const initialUrl = `/mint/${TARGET_ASSETS[1].symbol}`;
    renderWithContext({ url: initialUrl, store: testStore });
    const actions = testStore.getActions();
    expect(actions.length).toBe(0);
  });

  it("does NOT navigate if URL already matches Redux", () => {
    const url = `/mint/${HYPE}`;
    renderWithContext({ url, store });
    expect(store.getActions().length).toBe(0);
  });

  // Direction validation for short-only leverages
  it("redirects HYPE1L to HYPE1S and syncs correct leverage/direction", () => {
    const url = "/mint/HYPE1L";
    const testStore = mockStore({
      mint: {
        selected: {
          targetAsset: TARGET_ASSETS[0],
          leverage: 5,
          longOrShort: "long",
        },
      },
    });
    renderWithContext({ url, store: testStore });
    const actions = testStore.getActions();
    expect(actions).toContainEqual(setLeverage(1));
    expect(actions).toContainEqual(setLongOrShort("short"));
  });

  it("syncs HYPE1S into Redux correctly", () => {
    const url = "/mint/HYPE1S";
    const testStore = mockStore({
      mint: {
        selected: {
          targetAsset: TARGET_ASSETS[0],
          leverage: 5,
          longOrShort: "long",
        },
      },
    });
    renderWithContext({ url, store: testStore });
    const actions = testStore.getActions();
    expect(actions).toContainEqual(setLeverage(1));
    expect(actions).toContainEqual(setLongOrShort("short"));
  });

  it("does not dispatch leverage/direction for plain asset URL when Redux has short-only leverage", () => {
    const testStore = mockStore({
      mint: {
        selected: {
          targetAsset: TARGET_ASSETS.find((a) => a.symbol === "ETH")!,
          leverage: 1,
          longOrShort: "short",
        },
      },
    });
    const url = "/mint/ETH";
    renderWithContext({ url, store: testStore });
    const actions = testStore.getActions();
    expect(actions).not.toContainEqual(
      expect.objectContaining({ type: setLeverage.type }),
    );
    expect(actions).not.toContainEqual(
      expect.objectContaining({ type: setLongOrShort.type }),
    );
  });
});
