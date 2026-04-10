import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import PositionRow from "./PositionRow";
import { ETH3S, STANDBY_ETH3S } from "../../../constants/testConstants";
import useLeveragedTokenPnl from "../../../hooks/useLeveragedTokenPnl";
import { useSelectPositionAndNavigate } from "../../../pages/MintPage/useMintPageRouting";
import { openShareModal } from "../../../state/mintSlice";

const dispatchMock = vi.fn();
const navigateMock = vi.fn();
const selectPositionMock = vi.fn();

const onUnrealizedPnlMock = vi.fn();

vi.mock("react-redux", () => ({
  useDispatch: () => dispatchMock,
}));

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: "/portfolio" }),
  useNavigate: () => navigateMock,
}));

vi.mock("../../../pages/MintPage/useMintPageRouting", () => ({
  useSelectPositionAndNavigate: vi.fn(),
}));

vi.mock("../../../hooks/useLeveragedTokenPnl", () => ({
  default: vi.fn(),
}));

vi.mock("../../../assets/LeveragedToken/LeveragedToken", () => ({
  default: () => <div data-testid="leveraged-token" />,
}));

vi.mock("../StandbyModeLabel/StandbyModeLabel", () => ({
  default: () => <div data-testid="standby-label" />,
}));

vi.mock("../../MintPage/Positions/RedeemButton/RedeemButton", () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick}>Redeem</button>
  ),
}));

vi.mock("../../../state/mintSlice", () => ({
  setOpenRedeemModal: vi.fn((p) => ({
    type: "setOpenRedeemModal",
    payload: p,
  })),
  openShareModal: vi.fn((p) => ({
    type: "openShareModal",
    payload: p,
  })),
}));

const renderRow = (position = ETH3S) =>
  render(
    <table>
      <tbody>
        <PositionRow
          position={position}
          onUnrealizedPnl={onUnrealizedPnlMock}
        />
      </tbody>
    </table>,
  );

describe("PositionRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSelectPositionAndNavigate).mockReturnValue(selectPositionMock);
  });

  it("renders token symbol and position value", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    renderRow();

    expect(screen.getByText("ETH3S")).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
  });

  it("renders positive PnL correctly", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue({
      unrealized: 12.345,
      unrealizedPercent: 0.1234,
      realized: 0,
    });

    renderRow();

    expect(screen.getByText("+$12.35 (+12.34%)")).toBeInTheDocument();
  });

  it("renders negative PnL correctly", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue({
      unrealized: -5,
      unrealizedPercent: -0.05,
      realized: 0,
    });

    renderRow();

    expect(screen.getByText("-$5.00 (-5.00%)")).toBeInTheDocument();
  });

  it("renders standby label when in standby mode", () => {
    renderRow(STANDBY_ETH3S);

    expect(screen.getByTestId("standby-label")).toBeInTheDocument();
  });

  it("selects position and navigates when token is clicked", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    renderRow();

    fireEvent.click(screen.getByText("ETH3S"));

    expect(selectPositionMock).toHaveBeenCalledWith(ETH3S);
  });

  it("dispatches redeem action when Redeem is clicked", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    renderRow();

    fireEvent.click(screen.getByText("Redeem"));

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "setOpenRedeemModal" }),
    );
  });

  it("dispatches openShareModal when share button is clicked", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue({
      unrealized: -5,
      unrealizedPercent: -0.05,
      realized: 0,
    });

    renderRow();

    fireEvent.click(screen.getByTestId("share-button"));

    expect(dispatchMock).toHaveBeenCalledWith(
      openShareModal({ positionStatus: "open", token: ETH3S }),
    );
  });
});
