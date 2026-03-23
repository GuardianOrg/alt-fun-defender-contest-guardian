import { render, screen, fireEvent } from "@testing-library/react";
import { useDispatch, useSelector } from "react-redux";
import { describe, it, beforeEach, vi, expect } from "vitest";

import RedeemButton from "./RedeemButton";
import { ETH3S } from "../../../../../../constants/testConstants";
import { setRedeemButtonState } from "../../../../../../state/mintSlice";

import type { LeveragedTokenPnl } from "../../../../../../hooks/Indexer/usePnl";

vi.mock("react-redux", () => ({
  useSelector: vi.fn(),
  useDispatch: vi.fn(),
}));

vi.mock("../../../../../Global/Buttons/Button", () => ({
  default: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("../../../../../../assets/JellyLoader", () => ({
  default: () => <span data-testid="loader" />,
}));

const dispatchMock = vi.fn();

const defaultProps = {
  redeemValueBigInt: 1n,
  leverageToken: ETH3S,
  redeemPendingFlowRequired: false,
  inputError: false,
  pnl: { unrealizedPercent: 0.5 } as LeveragedTokenPnl,
  redeemTokens: vi.fn().mockResolvedValue(undefined),
  prepareRedeemTokens: vi.fn().mockResolvedValue(undefined),
};

describe("RedeemButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useDispatch).mockReturnValue(dispatchMock);
    vi.mocked(useSelector).mockReturnValue("redeem");
  });

  it("renders Redeem label when state is 'redeem'", () => {
    render(<RedeemButton {...defaultProps} />);

    expect(screen.getByRole("button", { name: /redeem/i })).toBeInTheDocument();
  });

  it("disables button when inputError is true", () => {
    render(<RedeemButton {...defaultProps} inputError />);

    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("disables button when redeemValueBigInt is zero", () => {
    render(<RedeemButton {...defaultProps} redeemValueBigInt={0n} />);

    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows loader when state is 'loading'", () => {
    vi.mocked(useSelector).mockReturnValue("loading");

    render(<RedeemButton {...defaultProps} />);

    expect(screen.getByTestId("loader")).toBeInTheDocument();
  });

  it("dispatches pnl snapshot and sets loading on click", async () => {
    render(<RedeemButton {...defaultProps} />);

    fireEvent.click(screen.getByRole("button"));

    expect(dispatchMock).toHaveBeenCalledWith(setRedeemButtonState("loading"));
  });

  it("calls redeemTokens when redeemPendingFlowRequired is false", async () => {
    render(<RedeemButton {...defaultProps} />);

    fireEvent.click(screen.getByRole("button"));

    expect(defaultProps.redeemTokens).toHaveBeenCalled();
    expect(defaultProps.prepareRedeemTokens).not.toHaveBeenCalled();
  });

  it("calls prepareRedeemTokens when redeemPendingFlowRequired is true", async () => {
    render(<RedeemButton {...defaultProps} redeemPendingFlowRequired />);

    fireEvent.click(screen.getByRole("button"));

    expect(defaultProps.prepareRedeemTokens).toHaveBeenCalledWith(
      1n,
      ETH3S.address,
    );

    expect(defaultProps.redeemTokens).not.toHaveBeenCalled();
  });

  it("does nothing when redeemValueBigInt is zero", async () => {
    render(<RedeemButton {...defaultProps} redeemValueBigInt={0n} />);

    fireEvent.click(screen.getByRole("button"));

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(defaultProps.redeemTokens).not.toHaveBeenCalled();
    expect(defaultProps.prepareRedeemTokens).not.toHaveBeenCalled();
  });
});
