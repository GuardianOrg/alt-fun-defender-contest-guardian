import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

import MintModal from "./MintModalContainer";
import { ETH3S } from "../../../../constants/testConstants";
import useMintTokens from "../../../../web3/writes/useMintTokens";

import type MintModalContent from "./MintModalContent/MintModalContent";
import type MintModalSuccessContent from "./MintModalSuccessContent/MintModalSuccessContent";
import type Popup from "../../../Global/Popup/Popup";
import type { MintModalStates } from "../../MintForm/MintForm";

vi.mock("../../../../web3/writes/useMintTokens", () => ({
  default: vi.fn(),
}));

vi.mock("./MintModalContent/MintModalContent", () => ({
  default: (props: React.ComponentProps<typeof MintModalContent>) => (
    <div data-testid="mint-modal-content">
      <div data-testid="simulated-mint">{props.simulatedEstimatedMint}</div>
      <button onClick={props.mintTokens}>mint</button>
    </div>
  ),
}));

vi.mock("./MintModalSuccessContent/MintModalSuccessContent", () => ({
  default: (props: React.ComponentProps<typeof MintModalSuccessContent>) => (
    <div data-testid="mint-modal-success">
      <div data-testid="tx-hash">{props.hash}</div>
    </div>
  ),
}));

vi.mock("../../../Global/Popup/Popup", () => ({
  default: ({ show, close, children }: React.ComponentProps<typeof Popup>) =>
    show ? (
      <div data-testid="popup">
        <button onClick={close}>close</button>
        {children}
      </div>
    ) : null,
}));

const mockUseMintTokens = vi.mocked(useMintTokens);

const renderMintModal = (
  overrides?: Partial<{
    stage: MintModalStates;
  }>,
) => {
  const setMintModalStage = vi.fn();
  const setMintValue = vi.fn();
  const setMintValueBigInt = vi.fn();

  render(
    <MintModal
      leverageToken={ETH3S}
      leverageTokenSymbol="ETH3S"
      mintValueBigInt={100n}
      stage={overrides?.stage ?? "confirm"}
      selectedLeverage={2}
      setMintModalStage={setMintModalStage}
      setMintValue={setMintValue}
      setMintValueBigInt={setMintValueBigInt}
    />,
  );

  return { setMintModalStage };
};

describe("MintModal", () => {
  beforeEach(() => {
    mockUseMintTokens.mockReturnValue({
      hash: "0xabc",
      simulatedEstimatedMint: 100n,
      minimumMint: 90n,
      mintTokens: vi.fn(),
      refetch: vi.fn(),
    });
  });

  it("renders MintModalContent when stage is confirm", () => {
    renderMintModal();

    expect(screen.getByTestId("popup")).toBeInTheDocument();
    expect(screen.getByTestId("mint-modal-content")).toBeInTheDocument();
    expect(screen.queryByTestId("mint-modal-success")).not.toBeInTheDocument();
  });

  it("passes simulatedEstimatedMint to MintModalContent", () => {
    renderMintModal();

    expect(screen.getByTestId("simulated-mint")).toHaveTextContent("100");
  });

  it("renders MintModalSuccessContent when stage is success", () => {
    renderMintModal({ stage: "success" });

    expect(screen.getByTestId("popup")).toBeInTheDocument();
    expect(screen.getByTestId("mint-modal-success")).toBeInTheDocument();
    expect(screen.getByTestId("tx-hash")).toHaveTextContent("0xabc");
  });

  it("calls setMintModalStage('closed') when popup is closed", () => {
    const { setMintModalStage } = renderMintModal();

    fireEvent.click(screen.getByText("close"));

    expect(setMintModalStage).toHaveBeenCalledWith("closed");
  });

  it("calls refetch when exchangeRate changes", () => {
    const refetch = vi.fn();

    mockUseMintTokens.mockReturnValue({
      hash: undefined,
      simulatedEstimatedMint: undefined,
      minimumMint: 0n,
      mintTokens: vi.fn(),
      refetch,
    });

    const { rerender } = render(
      <MintModal
        leverageToken={ETH3S}
        leverageTokenSymbol="ETH3S"
        mintValueBigInt={100n}
        stage="confirm"
        selectedLeverage={2}
        setMintModalStage={vi.fn()}
        setMintValue={vi.fn()}
        setMintValueBigInt={vi.fn()}
      />,
    );

    rerender(
      <MintModal
        leverageToken={{ ...ETH3S, exchangeRate: 3n }}
        leverageTokenSymbol="ETH3S"
        mintValueBigInt={100n}
        stage="confirm"
        selectedLeverage={2}
        setMintModalStage={vi.fn()}
        setMintValue={vi.fn()}
        setMintValueBigInt={vi.fn()}
      />,
    );

    expect(refetch).toHaveBeenCalled();
  });
});
