import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import InputContainer from "./InputContainer";

vi.mock("./InputContainer.module.css", () => ({
  default: {
    inputContainer: "inputContainer",
    inputHeader: "inputHeader",
    mintAmountLabel: "mintAmountLabel",
    userBalance: "userBalance",
    error: "error",
  },
}));

describe("InputContainer - balance display", () => {
  const defaultProps = {
    inputError: false,
    errorMessage: undefined,
    minTransactionSize: "1",
    baseBalanceBigInt: BigInt(123456000), // becomes 123.46 after formatting
    isConnected: true,
    mintValue: "",
    setMintValue: vi.fn(),
    setMintValueBigInt: vi.fn(),
  };

  it("shows formatted balance when connected and balance exists", () => {
    render(<InputContainer {...defaultProps} />);

    expect(screen.getByText(/Your balance/i)).toHaveTextContent("123.46");
  });

  it("shows '--' when not connected", () => {
    render(<InputContainer {...defaultProps} isConnected={false} />);

    expect(screen.getByText(/Your balance/i)).toHaveTextContent("--");
  });

  it("shows '0' when balance is zero", () => {
    render(<InputContainer {...defaultProps} baseBalanceBigInt={BigInt(0)} />);

    expect(screen.getByText(/Your balance/i)).toHaveTextContent("0");
  });

  it("applies error class when inputError is true", () => {
    render(<InputContainer {...defaultProps} inputError={true} />);

    const el = screen.getByText(/Your balance/i);
    expect(el.className).toMatch(/error/);
  });
});
