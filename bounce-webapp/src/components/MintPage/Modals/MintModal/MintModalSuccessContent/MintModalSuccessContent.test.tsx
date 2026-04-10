import { render, screen, fireEvent } from "@testing-library/react";
import { useSelector } from "react-redux";
import { describe, it, expect, vi } from "vitest";

import MintModalSuccessContent from "./MintModalSuccessContent";
import { blockExplorerTx } from "../../../../../app/constants";
import { ETH3S } from "../../../../../constants/testConstants";

import type { Address } from "viem";

vi.mock("react-redux", () => ({
  useSelector: vi.fn(),
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

const defaultProps = {
  leverageToken: ETH3S,
  leverageTokenSymbol: "ETH3S",
  hash: "0x123123123123" as Address,
  setMintModalStage: vi.fn(),
};

describe("MintModalSuccessContent", () => {
  beforeEach(() => {
    vi.mocked(useSelector).mockReturnValue(7589681690578736089n);
  });

  it("renders amount received from redux selector", () => {
    render(<MintModalSuccessContent {...defaultProps} />);

    expect(screen.getByText("Amount received")).toBeInTheDocument();
    expect(screen.getByText("7.59 ETH3S")).toBeInTheDocument();
  });

  it("renders formatted transaction hash with explorer link", () => {
    render(<MintModalSuccessContent {...defaultProps} />);

    const link = screen.getByRole("link");

    expect(link).toHaveAttribute("href", blockExplorerTx("0x123123123123"));

    expect(screen.getByText("0x1231...3123")).toBeInTheDocument();
    expect(screen.getByTestId("launch-icon")).toBeInTheDocument();
  });

  it("calls setMintModalStage('closed') when Close button is clicked", () => {
    render(<MintModalSuccessContent {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(defaultProps.setMintModalStage).toHaveBeenCalledWith("closed");
  });
});
