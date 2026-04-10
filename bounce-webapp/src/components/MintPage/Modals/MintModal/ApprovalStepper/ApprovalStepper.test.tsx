import { render, screen, fireEvent } from "@testing-library/react";
import { useSelector, type Selector } from "react-redux";
import { describe, it, expect, vi, beforeEach } from "vitest";

import ApprovalStepper from "./ApprovalStepper";
import { useMintFlow } from "./useMintFlow";
import { ETH3S } from "../../../../../constants/testConstants";
import {
  selectMintedAmountBigInt,
  selectStepperStage,
  type StepperStage,
} from "../../../../../state/mintSlice";

vi.mock("react-redux", () => ({
  useDispatch: () => vi.fn(),
  useSelector: vi.fn(),
}));

vi.mock("./useMintFlow", () => ({
  useMintFlow: vi.fn(),
}));

vi.mock(
  "../../../../Global/AnimatePresenceHeight/AnimatePresenceHeight",
  () => ({
    default: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  }),
);

vi.mock("../../../../Global/Buttons/Button", () => ({
  default: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

const setupSelectors = (
  stepperStage: StepperStage,
  mintedAmountBigInt: bigint | null = null,
) => {
  vi.mocked(useSelector).mockImplementation(
    (selector: Selector<unknown, unknown>) => {
      if (selector === selectStepperStage) return stepperStage;
      if (selector === selectMintedAmountBigInt) return mintedAmountBigInt;
      return null;
    },
  );
};

const defaultProps = {
  mintAmount: 1000n,
  leverageToken: ETH3S,
  mintTokens: vi.fn(),
  setMintModalStage: vi.fn(),
  setMintValue: vi.fn(),
  setMintValueBigInt: vi.fn(),
};

describe("ApprovalStepper", () => {
  const handleMintFlow = vi.fn();

  beforeEach(() => {
    vi.mocked(useMintFlow).mockReturnValue({ handleMintFlow });
    vi.clearAllMocks();
  });

  it("renders Mint CTA in initial state", () => {
    setupSelectors("initial");

    render(<ApprovalStepper {...defaultProps} />);

    expect(screen.getByRole("button", { name: /mint/i })).toBeInTheDocument();
  });

  it("calls handleMintFlow when CTA is clicked", () => {
    setupSelectors("initial");

    render(<ApprovalStepper {...defaultProps} />);

    fireEvent.click(screen.getByRole("button"));

    expect(handleMintFlow).toHaveBeenCalled();
  });

  it("disables button and shows loader during approvalPending", () => {
    setupSelectors("approvalPending");

    render(<ApprovalStepper {...defaultProps} />);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(screen.getByTestId("jellyLoader")).toBeInTheDocument();
    expect(screen.getByText("Approve transaction")).toBeInTheDocument();
    expect(screen.getByText("Signing")).toBeInTheDocument();
  });

  it("shows error label when approval fails", () => {
    setupSelectors("approvalError");

    render(<ApprovalStepper {...defaultProps} />);

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.queryByText("Success")).not.toBeInTheDocument();
    expect(screen.queryByText("Signing")).not.toBeInTheDocument();
  });

  it("shows approval success when minting starts", () => {
    setupSelectors("mintPending");

    render(<ApprovalStepper {...defaultProps} />);

    expect(screen.getByText("Approve transaction")).toBeInTheDocument();
    expect(screen.getByText("Signing")).toBeInTheDocument();
    expect(screen.getByText("Success")).toBeInTheDocument();
  });

  it("advances to success stage and clears mint state on mint success", () => {
    setupSelectors("mintSuccess", 100n);

    render(<ApprovalStepper {...defaultProps} />);

    expect(defaultProps.setMintModalStage).toHaveBeenCalledWith("success");
    expect(defaultProps.setMintValue).toHaveBeenCalledWith("");
    expect(defaultProps.setMintValueBigInt).toHaveBeenCalledWith(null);
  });
});
