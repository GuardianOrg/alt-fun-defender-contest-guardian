import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore, { type MockStore } from "redux-mock-store";
import { vi } from "vitest";

import MintButton from "./MintButton";
import { setStepperStage } from "../../../../state/mintSlice";

import type { Store } from "@reduxjs/toolkit";

vi.mock("./MintButton.module.css", () => ({
  default: {
    submitButton: "submitButton",
    disabled: "disabled",
  },
}));

vi.mock("../../../../hooks/useIsUserBlocked", () => {
  return {
    useIsUserBlocked: () => ({ isUserBlocked: false }),
  };
});

vi.mock("../../../../web3/views/useBounceAccount", () => ({
  default: () => ({
    address: "0x1234567890123456789012345678901234567890" as const,
    isConnected: true,
  }),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ login: vi.fn() }),
}));

describe("MintButton", () => {
  const mockStore = configureMockStore([]);
  let store: MockStore;
  const setMintModalStage = vi.fn();

  const renderButton = (props = {}) => {
    store = mockStore({});
    store.dispatch = vi.fn();

    return render(
      <Provider store={store as Store}>
        <MintButton
          mintValueNumber={1}
          isConnected={true}
          inputError={false}
          leveragedTokenSelected={true}
          pendingTransactionWarning={false}
          leverageTokenSymbol="BTC2L"
          setMintModalStage={setMintModalStage}
          {...props}
        />
      </Provider>,
    );
  };

  it("is disabled when mintValueNumber is null", () => {
    renderButton({ mintValueNumber: null });

    const btn = screen.getByText("Mint BTC2L");
    expect(btn).toBeDisabled();
  });

  it("is disabled when inputError is true", () => {
    renderButton({ inputError: true });

    const btn = screen.getByText("Mint BTC2L");
    expect(btn).toBeDisabled();
  });

  it("is disabled when leveragedTokenSelected is false", () => {
    renderButton({ leveragedTokenSelected: false });

    const btn = screen.getByText("Mint BTC2L");
    expect(btn).toBeDisabled();
  });

  it("is disabled when pendingTransactionWarning is true", () => {
    renderButton({ pendingTransactionWarning: true });

    const btn = screen.getByText("Mint BTC2L");
    expect(btn).toBeDisabled();
  });

  it("is enabled when all conditions are met", () => {
    renderButton();

    const btn = screen.getByText("Mint BTC2L");
    expect(btn).not.toBeDisabled();
  });

  it("dispatches setStepperStage and triggers modal stage change on click", () => {
    renderButton();

    const btn = screen.getByText("Mint BTC2L");
    btn.click();

    expect(store.dispatch).toHaveBeenCalledWith(setStepperStage("initial"));
    expect(setMintModalStage).toHaveBeenCalledWith("confirm");
  });
});
