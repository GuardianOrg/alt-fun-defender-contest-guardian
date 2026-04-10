import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import MintModalContent from "./MintModalContent";
import { BTC2L, STANDBY_ETH3S } from "../../../../../constants/testConstants";

vi.mock("../../../../../assets/LeveragedToken/LeveragedToken", () => ({
  default: () => <div data-testid="leveraged-token" />,
}));

vi.mock("../ApprovalStepper/ApprovalStepper", () => ({
  default: () => <div data-testid="approval-stepper" />,
}));

const defaultProps = {
  leverageToken: BTC2L,
  leverageTokenSymbol: "BTC2L",
  mintValueBigInt: 30000000n,
  simulatedEstimatedMint: 18288359976873945459n,
  minimumMint: 18123764737082079949n,
  setMintModalStage: vi.fn(),
  setMintValue: vi.fn(),
  setMintValueBigInt: vi.fn(),
  mintTokens: vi.fn(),
};

describe("MintModalContent", () => {
  it("renders heading and token symbol", () => {
    render(<MintModalContent {...defaultProps} />);

    expect(
      screen.getByRole("heading", { name: /you are about to mint/i }),
    ).toBeInTheDocument();

    expect(screen.getByText("BTC2L")).toBeInTheDocument();
    expect(screen.getByTestId("leveraged-token")).toBeInTheDocument();
  });

  it("shows estimated output using simulatedEstimatedMint when provided", () => {
    render(<MintModalContent {...defaultProps} />);

    expect(screen.getByText("18.29 BTC2L")).toBeInTheDocument();
  });

  it("falls back to calculated output when simulatedEstimatedMint is undefined", () => {
    render(
      <MintModalContent {...defaultProps} simulatedEstimatedMint={undefined} />,
    );

    expect(screen.getByText("18.12 BTC2L")).toBeInTheDocument();
  });

  it("renders standby mode label when totalAssets is below threshold", () => {
    render(
      <MintModalContent
        {...defaultProps}
        leverageToken={STANDBY_ETH3S}
        leverageTokenSymbol="ETH3S"
      />,
    );

    expect(screen.getByTestId("standby-label")).toBeInTheDocument();
  });

  it("does not render standby mode label when above threshold", () => {
    render(<MintModalContent {...defaultProps} />);

    expect(screen.queryByTestId("standby-label")).not.toBeInTheDocument();
  });

  it("renders ApprovalStepper", () => {
    render(<MintModalContent {...defaultProps} />);

    expect(screen.getByTestId("approval-stepper")).toBeInTheDocument();
  });
});
