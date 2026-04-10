import { render, screen, fireEvent } from "@testing-library/react";
import * as redux from "react-redux";
import { describe, it, expect, vi, beforeEach } from "vitest";

import PositionGrid from "./PositionGrid";
import { setOpenRedeemModal } from "../../../../state/mintSlice";

import type { LeveragedTokenData } from "../../../../types/leverageTokenData";

const dispatchMock = vi.fn();
vi.mock("react-redux", () => ({
  useDispatch: () => dispatchMock,
}));

const mockSelectPositionAndNavigate = vi.fn();

vi.mock("../../../../pages/MintPage/useMintPageRouting", () => ({
  useSelectPositionAndNavigate: () => mockSelectPositionAndNavigate,
}));

vi.mock("../../Modals/ShareModal/ShareModal", () => ({
  default: () => <>share modal</>,
}));

vi.mock("./PositionCard/PositionCard", () => ({
  default: ({
    position,
    onSelect,
    onRedeem,
  }: {
    position: LeveragedTokenData;
    onSelect: () => void;
    onRedeem: () => void;
  }) => (
    <div data-testid="position-card">
      <span>{position.symbol}</span>
      <button onClick={onSelect}>select</button>
      <button data-testid="redeem-button" onClick={onRedeem}>
        redeem
      </button>
    </div>
  ),
}));

const createPositions = (count: number): LeveragedTokenData[] =>
  Array.from({ length: count }, (_, i) => ({
    symbol: `TOKEN_${i}`,
  })) as LeveragedTokenData[];

describe("PositionGrid", () => {
  const dispatch = vi.fn();

  beforeEach(() => {
    vi.spyOn(redux, "useDispatch").mockReturnValue(dispatch);
    dispatch.mockClear();
  });

  it("renders one PositionCard per position", () => {
    render(<PositionGrid positions={createPositions(3)} />);

    expect(screen.getAllByTestId("position-card")).toHaveLength(3);
  });

  it("passes correct position data to PositionCard", () => {
    render(<PositionGrid positions={createPositions(2)} />);

    expect(screen.getByText("TOKEN_0")).toBeInTheDocument();
    expect(screen.getByText("TOKEN_1")).toBeInTheDocument();
  });

  it("dispatches setSelectedPosition when a position is selected", () => {
    const positions = createPositions(1);

    render(<PositionGrid positions={positions} />);

    fireEvent.click(screen.getByText("select"));

    expect(mockSelectPositionAndNavigate).toHaveBeenCalledTimes(1);
    expect(mockSelectPositionAndNavigate).toHaveBeenCalledWith(positions[0]);
  });

  it("dispatches redeem actions when redeem is clicked", () => {
    const positions = createPositions(1);

    render(<PositionGrid positions={positions} />);

    fireEvent.click(screen.getByTestId("redeem-button"));

    expect(dispatch).toHaveBeenCalledWith(setOpenRedeemModal(positions[0]));
  });

  it("renders no PositionCards when positions is empty", () => {
    render(<PositionGrid positions={[]} />);

    expect(screen.queryByTestId("position-card")).not.toBeInTheDocument();
  });
});
