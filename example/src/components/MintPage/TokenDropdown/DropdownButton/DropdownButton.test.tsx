import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";

import DropdownButton from "./DropdownButton";
import { TARGET_ASSETS } from "../../../../constants/targetAssets";
import { setIsTokenDropdownOpen } from "../../../../state/mintSlice";

import type { Store } from "@reduxjs/toolkit";

const mockStore = configureMockStore([]);

describe("DropdownButton", () => {
  it.each(TARGET_ASSETS)("renders correctly for token %s", (token) => {
    const store = mockStore({
      mint: {
        selected: {
          targetAsset: token,
        },
        pageUi: {
          isTokenDropdownOpen: false,
        },
      },
    });

    render(
      <Provider store={store as Store}>
        <DropdownButton />
      </Provider>,
    );

    expect(screen.getByText(token.symbol)).toBeInTheDocument();
    const img = screen.getByAltText(`${token.symbol} logo`);
    expect(img).toBeInTheDocument();
  });

  it("clicking button toggles dropdown", () => {
    const store = mockStore({
      mint: {
        selected: {
          targetAsset: TARGET_ASSETS[0],
        },
        pageUi: {
          isTokenDropdownOpen: false,
        },
      },
    });

    render(
      <Provider store={store as Store}>
        <DropdownButton />
      </Provider>,
    );

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    const actions = store.getActions();
    expect(actions).toContainEqual(setIsTokenDropdownOpen(true));
  });
});
