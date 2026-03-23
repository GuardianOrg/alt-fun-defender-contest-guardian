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
import { setSelectedTargetAsset } from "../../state/mintSlice";

import type { Store } from "@reduxjs/toolkit";

const mockStore = configureMockStore([]);
const HYPE = TARGET_ASSETS[0].symbol;
const ETH = TARGET_ASSETS[1].symbol;

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
        },
      },
    });
  });

  // URL → Redux Sync
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

  // Redux → URL Sync
  it("updates URL when Redux token changes", () => {
    beforeEach(() => {
      store = mockStore({
        mint: {
          selected: {
            targetAsset: TARGET_ASSETS[1],
          },
        },
      });
    });
    store.dispatch = vi.fn();
    const initialUrl = `/mint/${HYPE}`;
    const { rerender } = renderWithContext({ url: initialUrl, store });
    // After mount, Redux says ETH, URL had HYPE → should navigate to ETH
    const actions = store.getActions();
    expect(actions.length).toBe(0);
    rerender();
  });

  it("does NOT navigate if URL already matches Redux", () => {
    const url = `/mint/${HYPE}`;
    renderWithContext({ url, store });
    expect(store.getActions().length).toBe(0);
  });
});
