import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";
import { vi } from "vitest";

import Positions from "./Positions";
import { BTC2L, ETH3S } from "../../../constants/testConstants";
import { setGridOrListView } from "../../../state/mintSlice";
import useBounceAccount from "../../../web3/views/useBounceAccount";
import useUsersLeveragedTokens from "../../../web3/views/useUsersLeveragedTokens";

import type { LeveragedTokenData } from "../../../types/leverageTokenData";
import type { Store } from "@reduxjs/toolkit";

const mockStore = configureMockStore([]);

vi.mock("../../Global/PositionList/PositionList", () => ({
  default: () => <div data-testid="PositionList" />,
}));

vi.mock("./PositionGrid/PositionGrid", () => ({
  default: () => <div data-testid="PositionGrid" />,
}));

vi.mock("../Modals/RedeemModal/RedeemModalContainer", () => ({
  default: () => <div data-testid="RedeemModal" />,
}));

vi.mock("../../../web3/views/useBounceAccount");
vi.mock("../../../web3/views/useUsersLeveragedTokens");

const positionsMock: LeveragedTokenData[] = [ETH3S, BTC2L];

describe("Positions component", () => {
  it("renders zero state when no positions", () => {
    vi.mocked(useBounceAccount).mockReturnValue({
      isConnected: true,
      address: "0x000",
    });
    vi.mocked(useUsersLeveragedTokens).mockReturnValue([]);
    const store = mockStore({
      mint: {
        pageUi: {
          gridOrListView: "grid",
        },
      },
    });

    render(
      <Provider store={store as Store}>
        <Positions />
      </Provider>,
    );

    expect(screen.getByText(/You have no open positions/i)).toBeInTheDocument();
  });

  it("renders PositionGrid when connected and grid view with positions", () => {
    vi.mocked(useBounceAccount).mockReturnValue({
      isConnected: true,
      address: "0x000",
    });
    vi.mocked(useUsersLeveragedTokens).mockReturnValue(positionsMock);

    const store = mockStore({
      mint: {
        pageUi: {
          gridOrListView: "grid",
        },
      },
    });

    render(
      <Provider store={store as Store}>
        <Positions />
      </Provider>,
    );

    expect(screen.getByTestId("PositionGrid")).toBeInTheDocument();
    expect(screen.queryByTestId("PositionList")).not.toBeInTheDocument();
  });

  it("renders PositionList when connected and list view with positions", () => {
    vi.mocked(useBounceAccount).mockReturnValue({
      isConnected: true,
      address: "0x000",
    });
    vi.mocked(useUsersLeveragedTokens).mockReturnValue(positionsMock);

    const store = mockStore({
      mint: {
        pageUi: {
          gridOrListView: "list",
        },
      },
    });

    render(
      <Provider store={store as Store}>
        <Positions />
      </Provider>,
    );

    expect(screen.getByTestId("PositionList")).toBeInTheDocument();
    expect(screen.queryByTestId("PositionGrid")).not.toBeInTheDocument();
  });

  it("renders layout toggle buttons when positions exist", () => {
    vi.mocked(useBounceAccount).mockReturnValue({
      isConnected: true,
      address: "0x000",
    });
    vi.mocked(useUsersLeveragedTokens).mockReturnValue(positionsMock);

    const store = mockStore({
      mint: {
        pageUi: {
          gridOrListView: "grid",
        },
      },
    });
    store.dispatch = vi.fn();

    render(
      <Provider store={store as Store}>
        <Positions />
      </Provider>,
    );

    const gridButton = screen.getByText(/Grid/i);
    const listButton = screen.getByText(/List/i);

    fireEvent.click(listButton);
    expect(store.dispatch).toHaveBeenCalledWith(setGridOrListView("list"));

    fireEvent.click(gridButton);
    expect(store.dispatch).toHaveBeenCalledWith(setGridOrListView("grid"));
  });

  it("always renders RedeemModal", () => {
    vi.mocked(useBounceAccount).mockReturnValue({
      isConnected: true,
      address: "0x000",
    });
    const store = mockStore({
      mint: {
        pageUi: {
          gridOrListView: "grid",
        },
      },
    });

    render(
      <Provider store={store as Store}>
        <Positions />
      </Provider>,
    );

    expect(screen.getByTestId("RedeemModal")).toBeInTheDocument();
  });
});
