import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";
import { vi } from "vitest";

import RedeemModalContainer from "./RedeemModalContainer";
import { ETH3S } from "../../../../constants/testConstants";

import type Popup from "../../../Global/Popup/Popup";
import type { Store } from "@reduxjs/toolkit";

vi.mock("./RedeemModalContent/RedeemModalContent", () => ({
  default: () => <div data-testid="redeem-modal-content"></div>,
}));

vi.mock("./RedeemModalSuccessContent/RedeemModalSuccessContent", () => ({
  default: () => <div data-testid="redeem-modal-success-content"></div>,
}));

vi.mock("../../../Global/Popup/Popup", () => ({
  default: ({ show, close, children }: React.ComponentProps<typeof Popup>) =>
    show ? (
      <div data-testid="popup">
        <button onClick={close}>close</button>
        {children}
      </div>
    ) : null,
}));

vi.mock("../../../../hooks/useLeveragedTokenPnl", () => ({
  default: vi.fn(),
}));

const mockStore = configureMockStore([]);

describe("RedeemModal", () => {
  it("renders RedeemModalContent when stage is redeem", () => {
    const store = mockStore({
      mint: {
        redeemModal: {
          redeemModalStage: "redeem",
          leveragedTokenForRedeem: ETH3S,
        },
      },
    });

    render(
      <Provider store={store as Store}>
        <RedeemModalContainer />
      </Provider>,
    );

    expect(screen.getByTestId("redeem-modal-content")).toBeInTheDocument();
    expect(
      screen.queryByTestId("redeem-modal-success"),
    ).not.toBeInTheDocument();
  });

  it("renders RedeemModalSuccessContent when stage is success", () => {
    const store = mockStore({
      mint: {
        redeemModal: {
          redeemModalStage: "success",
          leveragedTokenForRedeem: ETH3S,
        },
      },
    });

    render(
      <Provider store={store as Store}>
        <RedeemModalContainer />
      </Provider>,
    );

    expect(
      screen.getByTestId("redeem-modal-success-content"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("redeem-modal-success"),
    ).not.toBeInTheDocument();
  });
});
