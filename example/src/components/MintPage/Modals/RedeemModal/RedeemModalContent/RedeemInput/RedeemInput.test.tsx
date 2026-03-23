import { render, screen, fireEvent } from "@testing-library/react";
import { useSelector } from "react-redux";
import { describe, it, beforeEach, vi, expect } from "vitest";

import RedeemInput from "./RedeemInput";
import { ETH3S } from "../../../../../../constants/testConstants";
import { bigIntToString } from "../../../../../../utils/bigIntToString.util";

vi.mock("react-redux", () => ({
  useSelector: vi.fn(),
}));

vi.mock("../../../../../Global/Tooltip/InfoTooltip", () => ({
  default: ({ content }: { content: string }) => (
    <span data-testid="tooltip">{content}</span>
  ),
}));

const setRedeemValueBigInt = vi.fn();

const defaultProps = {
  leverageToken: ETH3S,
  minLeveragedTokenAmountBuffer: 1,
  inputError: false,
  errorMessage: undefined,
  setRedeemValueBigInt,
};

describe("RedeemInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSelector).mockReturnValue("redeem");
  });

  it("renders header and tooltip text", () => {
    render(<RedeemInput {...defaultProps} />);

    expect(screen.getByText("Redeem Amount")).toBeInTheDocument();
    expect(screen.getByTestId("tooltip")).toHaveTextContent(
      `The amount of ${ETH3S.symbol} to redeem.`,
    );
  });

  it("allows typing value and converts to bigint", () => {
    render(<RedeemInput {...defaultProps} />);

    fireEvent.change(screen.getByTestId("asset-input"), {
      target: { value: "1.5" },
    });

    expect(setRedeemValueBigInt).toHaveBeenCalledWith(
      BigInt("1500000000000000000"),
    );
  });

  it("sets bigint to 0 when input is cleared", () => {
    render(<RedeemInput {...defaultProps} />);

    const input = screen.getByTestId("asset-input");

    fireEvent.change(input, {
      target: { value: "1" },
    });

    fireEvent.change(input, {
      target: { value: "" },
    });

    expect(setRedeemValueBigInt).toHaveBeenLastCalledWith(BigInt(0));
  });
  it("fills max value when Max button is clicked", () => {
    render(<RedeemInput {...defaultProps} />);

    fireEvent.click(screen.getByTestId("max-button"));

    expect(setRedeemValueBigInt).toHaveBeenCalledWith(BigInt(ETH3S.balanceOf));

    expect(screen.getByTestId("asset-input")).toHaveValue(
      bigIntToString(ETH3S.balanceOf, 18),
    );
  });

  it("disables input and max button when redeem state is loading", () => {
    vi.mocked(useSelector).mockReturnValue("loading");

    render(<RedeemInput {...defaultProps} />);

    expect(screen.getByTestId("asset-input")).toBeDisabled();
    expect(screen.getByTestId("max-button")).toBeDisabled();
  });

  it("shows error message when provided", () => {
    render(
      <RedeemInput
        {...defaultProps}
        inputError
        errorMessage="Invalid amount"
      />,
    );

    expect(screen.getByText("Invalid amount")).toBeInTheDocument();
  });
});
