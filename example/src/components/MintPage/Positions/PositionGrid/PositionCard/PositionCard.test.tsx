import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import PositionCard from "./PositionCard";
import { BTC2L, STANDBY_ETH3S } from "../../../../../constants/testConstants";
import useLeveragedTokenPnl from "../../../../../hooks/useLeveragedTokenPnl";

const dispatchMock = vi.fn();
vi.mock("react-redux", () => ({
  useDispatch: () => dispatchMock,
}));

vi.mock("../../../../../hooks/useLeveragedTokenPnl", () => ({
  default: vi.fn(),
}));

vi.mock("../../../../../assets/LeveragedToken/LeveragedToken", () => ({
  default: () => <div data-testid="leveraged-token" />,
}));

vi.mock("../../../LineChart/LineChart", () => ({
  default: () => <div data-testid="line-chart" />,
}));

vi.mock("../../RedeemButton/RedeemButton", () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button data-testid="redeem-button" onClick={onClick}>
      Redeem
    </button>
  ),
}));

describe("PositionCard", () => {
  const onSelect = vi.fn();
  const onRedeem = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders basic position information", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    render(
      <PositionCard position={BTC2L} onSelect={onSelect} onRedeem={onRedeem} />,
    );

    expect(screen.getByText("BTC2L")).toBeInTheDocument();
    expect(screen.getByText("Nominal Value")).toBeInTheDocument();
    expect(screen.getByText("ROE")).toBeInTheDocument();
    expect(screen.getByText("uPnL")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  it("calls onSelect when token header is clicked", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    render(
      <PositionCard position={BTC2L} onSelect={onSelect} onRedeem={onRedeem} />,
    );

    fireEvent.click(screen.getByText("BTC2L"));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onRedeem when redeem button is clicked", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    render(
      <PositionCard position={BTC2L} onSelect={onSelect} onRedeem={onRedeem} />,
    );

    fireEvent.click(screen.getByTestId("redeem-button"));

    expect(onRedeem).toHaveBeenCalledTimes(1);
  });

  it("renders positive pnl values correctly", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue({
      unrealized: 12.34,
      unrealizedPercent: 0.1234,
      realized: 0,
    });

    render(
      <PositionCard position={BTC2L} onSelect={onSelect} onRedeem={onRedeem} />,
    );

    const roe = screen.getByTestId("roe");
    expect(roe).toBeInTheDocument();
    expect(roe).toHaveClass("positive");
    expect(roe).toHaveTextContent("+12.34%");

    const uPnl = screen.getByTestId("upnl");
    expect(uPnl).toBeInTheDocument();
    expect(uPnl).toHaveClass("positive");
    expect(uPnl).toHaveTextContent("+$12.34");
  });

  it("renders fallback when pnl data is missing", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    render(
      <PositionCard position={BTC2L} onSelect={onSelect} onRedeem={onRedeem} />,
    );

    expect(screen.getAllByText("--")).toHaveLength(2);
  });

  it("shows StandbyModeLabel when below standby threshold", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    render(
      <PositionCard
        position={STANDBY_ETH3S}
        onSelect={onSelect}
        onRedeem={onRedeem}
      />,
    );

    expect(screen.getByTestId("standby-label")).toBeInTheDocument();
  });

  it("does not show StandbyModeLabel when above threshold", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    render(
      <PositionCard position={BTC2L} onSelect={onSelect} onRedeem={onRedeem} />,
    );

    expect(screen.queryByTestId("standby-label")).not.toBeInTheDocument();
  });

  it("calls dispatch once on share-button click", () => {
    vi.mocked(useLeveragedTokenPnl).mockReturnValue(null);

    render(
      <PositionCard position={BTC2L} onSelect={onSelect} onRedeem={onRedeem} />,
    );

    fireEvent.click(screen.getByTestId("share-button"));

    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });
});
