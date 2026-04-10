import { configureStore } from "@reduxjs/toolkit";
import { render, screen, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { Provider } from "react-redux";
import { vi, type Mock } from "vitest";

import VestingPage from "./VestingPage";
import errorReducer from "../../state/errorSlice";
import useBounceAccount from "../../web3/views/useBounceAccount";
import useVesting from "../../web3/views/useVesting";
import useClaimVesting from "../../web3/writes/useClaimVesting";

vi.mock("../../components/Global/Connector/Connector", () => ({
  default: () => <div>Connector MOCK</div>,
}));

vi.mock("../../web3/views/useVesting", () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock("../../web3/views/useBounceAccount", () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock("../../web3/writes/useClaimVesting", () => ({
  __esModule: true,
  default: vi.fn(),
}));

describe("VestingPage", () => {
  const store = configureStore({
    reducer: {
      error: errorReducer,
    },
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it("renders zero state when not connected", () => {
    (useBounceAccount as Mock).mockReturnValue({
      isConnected: false,
      address: null,
    });

    (useVesting as Mock).mockReturnValue(null);

    (useClaimVesting as Mock).mockReturnValue({
      claimVesting: vi.fn(),
      isConnecting: false,
      isPending: false,
      isSuccess: false,
    });

    render(
      <Provider store={store}>
        <HelmetProvider>
          <VestingPage />
        </HelmetProvider>
      </Provider>,
    );
    expect(
      screen.getByText("Connect your wallet to view your vesting"),
    ).toBeInTheDocument();
    expect(screen.getByText("Connector MOCK")).toBeInTheDocument();
  });

  it("renders temporary state when connected and data not yet available", () => {
    (useBounceAccount as Mock).mockReturnValue({
      isConnected: true,
      address: "0x123",
    });

    (useVesting as Mock).mockReturnValue(null);

    (useClaimVesting as Mock).mockReturnValue({
      claimVesting: vi.fn(),
      isConnecting: false,
      isPending: false,
      isSuccess: false,
    });

    render(
      <Provider store={store}>
        <HelmetProvider>
          <VestingPage />
        </HelmetProvider>
      </Provider>,
    );

    const dashes = screen.getAllByText("--");
    expect(dashes).toHaveLength(7);

    const button = screen.getByRole("button", {
      name: /Claim available BOUNCE/i,
    });
    expect(button).toBeDisabled();
  });

  it("renders vesting data when connected and data available", () => {
    (useBounceAccount as Mock).mockReturnValue({
      isConnected: true,
      address: "0x123",
    });

    (useVesting as Mock).mockReturnValue({
      amount: 50000000000000000000000000n,
      claimable: 558325405885337350000000n,
      claimed: 0n,
      end: 1788600720n,
      revokedAt: 0n,
      start: 1757064720n,
      vested: 558325405885337350000000n,
    });

    (useClaimVesting as Mock).mockReturnValue({
      claimVesting: vi.fn(),
      isConnecting: false,
      isPending: false,
      isSuccess: true,
    });

    render(
      <Provider store={store}>
        <HelmetProvider>
          <VestingPage />
        </HelmetProvider>
      </Provider>,
    );

    expect(screen.getByText("Your tokens")).toBeInTheDocument();
    expect(screen.getByText("Available to claim")).toBeInTheDocument();

    expect(screen.getByText("Total token allocation")).toBeInTheDocument();
    expect(screen.getByText("50,000,000")).toBeInTheDocument();
    expect(screen.getByText("Vested tokens")).toBeInTheDocument();
    const vestedRow = screen.getByText("Vested tokens").closest("tr");
    expect(vestedRow).not.toBeNull();
    expect(within(vestedRow!).getByText("558,325.41")).toBeInTheDocument();
    expect(screen.getByText("Amount claimed so far")).toBeInTheDocument();
    const claimedRow = screen.getByText("Amount claimed so far").closest("tr");
    expect(claimedRow).not.toBeNull();
    expect(within(claimedRow!).getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Amount claimable")).toBeInTheDocument();
    const claimableRow = screen.getByText("Amount claimable").closest("tr");
    expect(claimableRow).not.toBeNull();
    expect(within(claimableRow!).getByText("558,325.41")).toBeInTheDocument();
    expect(screen.getByText("Vesting start date")).toBeInTheDocument();
    expect(
      screen.getByText(
        new Date(Number(1757064720n) * 1000).toLocaleDateString(),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Vesting end date")).toBeInTheDocument();
    expect(
      screen.getByText(
        new Date(Number(1788600720n) * 1000).toLocaleDateString(),
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("Claim available BOUNCE")).toBeInTheDocument();
  });

  it("renders claimable tokens = 0 state", () => {
    (useBounceAccount as Mock).mockReturnValue({
      isConnected: true,
      address: "0x123",
    });

    (useVesting as Mock).mockReturnValue({
      amount: 50000000000000000000000000n,
      claimable: 0n,
      claimed: 558325405885337350000000n,
      end: 1788600720n,
      revokedAt: 0n,
      start: 1757064720n,
      vested: 558325405885337350000000n,
    });

    (useClaimVesting as Mock).mockReturnValue({
      claimVesting: vi.fn(),
      isConnecting: false,
      isPending: false,
      isSuccess: false,
    });

    render(
      <Provider store={store}>
        <HelmetProvider>
          <VestingPage />
        </HelmetProvider>
      </Provider>,
    );

    expect(screen.getByText("Vesting claimed!")).toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: /Vesting claimed!/i,
    });
    expect(button).toBeDisabled();
  });

  it("renders correctly during isLoading (Wallet connection)", () => {
    (useBounceAccount as Mock).mockReturnValue({
      isConnected: true,
      address: "0x123",
    });

    (useVesting as Mock).mockReturnValue({
      amount: 50000000000000000000000000n,
      claimable: 558325405885337350000000n,
      claimed: 0n,
      end: 1788600720n,
      revokedAt: 0n,
      start: 1757064720n,
      vested: 558325405885337350000000n,
    });

    (useClaimVesting as Mock).mockReturnValue({
      claimVesting: vi.fn(),
      isConnecting: true,
      isPending: false,
      isSuccess: false,
    });

    render(
      <Provider store={store}>
        <HelmetProvider>
          <VestingPage />
        </HelmetProvider>
      </Provider>,
    );

    expect(screen.getByTestId("jellyLoader")).toBeInTheDocument();
  });

  it("renders correctly during isPending", () => {
    (useBounceAccount as Mock).mockReturnValue({
      isConnected: true,
      address: "0x123",
    });

    (useVesting as Mock).mockReturnValue({
      amount: 50000000000000000000000000n,
      claimable: 558325405885337350000000n,
      claimed: 0n,
      end: 1788600720n,
      revokedAt: 0n,
      start: 1757064720n,
      vested: 558325405885337350000000n,
    });

    (useClaimVesting as Mock).mockReturnValue({
      claimVesting: vi.fn(),
      isConnecting: false,
      isPending: true,
      isSuccess: false,
    });

    render(
      <Provider store={store}>
        <HelmetProvider>
          <VestingPage />
        </HelmetProvider>
      </Provider>,
    );

    expect(screen.getByText("Claim pending")).toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: /Claim pending/i,
    });
    expect(button).toBeDisabled();
  });
});
