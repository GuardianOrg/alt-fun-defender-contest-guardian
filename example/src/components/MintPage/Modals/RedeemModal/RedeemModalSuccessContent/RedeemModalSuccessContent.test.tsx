import { render, screen, fireEvent } from "@testing-library/react";
import { useSelector, useDispatch } from "react-redux";
import { describe, it, beforeEach, vi, expect } from "vitest";

import RedeemModalSuccessContent from "./RedeemModalSuccessContent";
import { blockExplorerTx } from "../../../../../app/constants";
import { ETH3S } from "../../../../../constants/testConstants";

import type { Address } from "viem";

vi.mock("react-redux", () => ({
  useSelector: vi.fn(),
  useDispatch: vi.fn(),
}));

vi.mock("../../../../Global/Buttons/Button", () => ({
  default: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock("../../../../../assets/LaunchIcon", () => ({
  LaunchIcon: () => <span data-testid="launch-icon" />,
}));

vi.mock("../../../../Global/Toggle/Toggle", () => ({
  default: ({
    checked,
    onChange,
    ariaLabel,
  }: {
    checked: boolean;
    onChange: () => void;
    ariaLabel: string;
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={onChange}
    />
  ),
}));

const defaultProps = {
  leverageToken: ETH3S,
  handleCloseSuccessModal: vi.fn(),
};

describe("RedeemModalSuccessContent", () => {
  const dispatchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useDispatch).mockReturnValue(dispatchMock);

    vi.mocked(useSelector).mockImplementation((selector) => {
      switch (selector.name) {
        case "selectLatestRedeemHash":
          return "0x123123123123" as Address;
        case "selectRecievedPnl":
          return { profitPercent: 0.05, profitAmount: 10.02 };
        case "selectRecievedBaseAmount":
          return 19818628n;
        default:
          return null;
      }
    });
  });

  /* -------------------- tests -------------------- */

  it("renders amount received from redux selector", () => {
    render(<RedeemModalSuccessContent {...defaultProps} />);

    expect(screen.getByText("Amount received")).toBeInTheDocument();
    expect(screen.getByText("19.82 USDC")).toBeInTheDocument();
  });

  it("renders formatted transaction hash with explorer link", () => {
    render(<RedeemModalSuccessContent {...defaultProps} />);

    const links = screen.getAllByRole("link");
    const txLink = links.find((link) =>
      link.getAttribute("href")?.includes(blockExplorerTx("0x123123123123")),
    );

    expect(txLink).toBeDefined();
    expect(screen.getByText("0x1231...3123")).toBeInTheDocument();
    expect(screen.getByTestId("launch-icon")).toBeInTheDocument();
  });

  it("calls handleCloseSuccessModal when Close button is clicked", () => {
    render(<RedeemModalSuccessContent {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(defaultProps.handleCloseSuccessModal).toHaveBeenCalled();
  });

  it("toggles price visibility", () => {
    render(<RedeemModalSuccessContent {...defaultProps} />);

    expect(screen.queryByText("($10.02)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Sharecard display price toggle"));
    expect(screen.getByText("($10.02)")).toBeInTheDocument();
  });
});
