import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";
import { vi } from "vitest";

import LongShortToggle from "./LongShortToggle";
import { setLongOrShort } from "../../../../state/mintSlice";

import type { Store } from "@reduxjs/toolkit";

describe("LongShortToggle", () => {
  it("renders buttons and dispatches correct actions", () => {
    const mockStore = configureMockStore([]);
    const store = mockStore({});
    store.dispatch = vi.fn();

    render(
      <Provider store={store as Store}>
        <LongShortToggle selectedLongShort="long" />
      </Provider>,
    );

    const longButton = screen.getByText("Long");
    const shortButton = screen.getByText("Short");
    expect(longButton).toHaveClass(/selected/);
    expect(shortButton).not.toHaveClass(/selected/);
    fireEvent.click(shortButton);
    expect(store.dispatch).toHaveBeenCalledWith(setLongOrShort("short"));
    fireEvent.click(longButton);
    expect(store.dispatch).toHaveBeenCalledWith(setLongOrShort("long"));
  });
});
