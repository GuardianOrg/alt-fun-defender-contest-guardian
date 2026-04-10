import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";
import { vi } from "vitest";

import LeverageButtons from "./LeverageButtons";
import { TARGET_ASSETS } from "../../../../constants/targetAssets";

import type { Store } from "@reduxjs/toolkit";

describe("LeverageButtons", () => {
  it("renders buttons and dispatches correct actions", () => {
    const mockStore = configureMockStore([]);
    const store = mockStore({});
    store.dispatch = vi.fn();

    render(
      <Provider store={store as Store}>
        <LeverageButtons
          selectedLeverage={2}
          selectedTargetAsset={TARGET_ASSETS[0]}
          selectedLongOrShort="long"
        />
      </Provider>,
    );

    const button2x = screen.getByText("2x");
    const button3x = screen.getByText("3x");
    const button5x = screen.getByText("5x");
    expect(button2x).toHaveClass(/selected/);
    expect(button3x).not.toHaveClass(/selected/);
    expect(button5x).not.toHaveClass(/selected/);
    button3x.click();
    expect(store.dispatch).toHaveBeenCalledWith({
      type: "mint/setLeverage",
      payload: 3,
    });
    button5x.click();
    expect(store.dispatch).toHaveBeenCalledWith({
      type: "mint/setLeverage",
      payload: 5,
    });
    button2x.click();
    expect(store.dispatch).toHaveBeenCalledWith({
      type: "mint/setLeverage",
      payload: 2,
    });
  });
});
