import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";
import { vi } from "vitest";

import ShareModal from "./ShareModal";
import { ETH3S } from "../../../../constants/testConstants";

import type Popup from "../../../Global/Popup/Popup";
import type { Store } from "@reduxjs/toolkit";

const mockStore = configureMockStore([]);

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
  default: vi.fn(() => ({
    realized: 18.33204,
    unrealized: 2.627554913197992,
    unrealizedPercent: 0.102308,
  })),
}));

vi.mock("../../../Global/Buttons/Button", () => ({
  default: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock("../SharedComponents/ShareCard/ShareCard", () => ({
  default: ({ leveragedToken }: { leveragedToken: typeof ETH3S }) => (
    <div data-testid="share-card">{leveragedToken.symbol}</div>
  ),
}));

vi.mock("../SharedComponents/ShareCardControls/ShareCardControls", () => ({
  default: () => <div data-testid="share-controls" />,
}));

describe("ShareModal", () => {
  it("renders ShareModal when share modal is open", () => {
    const store = mockStore({
      mint: {
        shareModal: {
          isOpen: true,
          payload: {
            positionStatus: "open",
            token: ETH3S,
          },
        },
      },
    });

    render(
      <Provider store={store as Store}>
        <ShareModal />
      </Provider>,
    );

    expect(screen.getByTestId("popup")).toBeInTheDocument();
    expect(screen.getByTestId("share-card")).toBeInTheDocument();
    expect(screen.getByText("ETH3S")).toBeInTheDocument();
    expect(screen.getByText("Share to X")).toBeInTheDocument();
  });
});
