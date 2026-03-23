import { render, screen } from "@testing-library/react";
import { useSelector, type Selector } from "react-redux";
import { vi } from "vitest";

import MintForm from "./MintForm";
import { ETH3S, globalStorageDataMock } from "../../../constants/testConstants";
import {
  selectSelectedTargetAsset,
  selectLeverage,
  selectLongOrShort,
  selectPendingTransactionWarning,
  selectLeverageTokenSymbol,
} from "../../../state/mintSlice";

vi.mock("react-redux", async () => {
  const actual =
    await vi.importActual<typeof import("react-redux")>("react-redux");

  return {
    ...actual,
    useDispatch: () => vi.fn(),
    useSelector: vi.fn(),
  };
});

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x123",
    isConnected: true,
  }),
}));

vi.mock("../../../hooks/useIsUserBlocked", () => {
  return {
    useIsUserBlocked: () => ({ isUserBlocked: false }),
  };
});

vi.mock("../../../web3/views/useBounceAccount", () => ({
  default: () => ({ isConnected: true }),
}));

vi.mock("../../../web3/views/useBaseAssetBalance", () => ({
  useBaseAssetBalance: () => BigInt(20_000_000),
}));

vi.mock("../../../web3/views/useLeveragedTokens", () => ({
  default: () => [ETH3S],
}));

vi.mock("./ReferralNotice/ReferralNotice", () => ({
  default: () => <div data-testid="referral-notice" />,
}));

vi.mock("./MintButton/MintButton", () => ({
  default: () => <div data-testid="mint-button" />,
}));

vi.mock("../Modals/MintModal/MintModalContainer", () => ({
  default: () => <div data-testid="mint-modal" />,
}));

vi.mock("../../Global/LifiWidget/LifiModal", () => ({
  LifiModal: () => <div data-testid="lifi-modal" />,
}));
vi.mock("../../../hooks/Indexer/useGlobalStorage", () => {
  const actual = vi.importActual<
    typeof import("../../../hooks/Indexer/useGlobalStorage")
  >("../../../hooks/Indexer/useGlobalStorage");
  return {
    ...actual,
    useGlobalStorageData: () => globalStorageDataMock,
  };
});

const setupSelectors = ({
  targetAsset = {
    id: "ethereum",
    symbol: "ETH",
    image: "ethereum.svg",
    leverageOptions: [2, 3, 5],
    accentColor: "#6882EB",
  },
  leverage = 3,
  longOrShort = "short",
  pendingWarning = false,
  tokenSymbol = "ETH3S",
} = {}) => {
  vi.mocked(useSelector).mockImplementation(
    (selector: Selector<unknown, unknown>) => {
      if (selector === selectSelectedTargetAsset) return targetAsset;
      if (selector === selectLeverage) return leverage;
      if (selector === selectLongOrShort) return longOrShort;
      if (selector === selectPendingTransactionWarning) return pendingWarning;
      if (selector === selectLeverageTokenSymbol) return tokenSymbol;
      return null;
    },
  );
};

describe("<MintForm />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSelectors();
  });

  it("renders mint form core components", () => {
    render(<MintForm />);

    expect(screen.getByText(/Mint Leveraged Tokens/i)).toBeInTheDocument();
    expect(screen.getByTestId("long-short-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("leverage-buttons")).toBeInTheDocument();
    expect(screen.getByTestId("input-container")).toBeInTheDocument();
    expect(screen.getByTestId("mint-button")).toBeInTheDocument();
    expect(
      screen.getByTestId("token-information-dropdown"),
    ).toBeInTheDocument();
  });

  it("respects allMintsPaused from globalStorageData", () => {
    render(<MintForm />);
    if (globalStorageDataMock.allMintsPaused) {
      expect(screen.getByTestId("paused-mode-label")).toBeInTheDocument();
    }
  });

  it("shows pending transaction warning when enabled", () => {
    setupSelectors({ pendingWarning: true });

    render(<MintForm />);

    expect(
      screen.getByText(/you didn't complete your last transaction/i),
    ).toBeInTheDocument();
  });
});
