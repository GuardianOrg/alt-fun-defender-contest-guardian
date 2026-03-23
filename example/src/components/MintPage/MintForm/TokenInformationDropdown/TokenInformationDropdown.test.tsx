import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import TokenInformationDropdown from "./TokenInformationDropdown";
import { BTC2L } from "../../../../constants/testConstants";

/* ---------------- mocks ---------------- */

// AnimatePresenceHeight → render children immediately when open
vi.mock("../../../Global/AnimatePresenceHeight/AnimatePresenceHeight", () => ({
  default: ({
    shouldDisplay,
    children,
    className,
  }: {
    shouldDisplay: boolean;
    children: React.ReactNode;
    className?: string;
  }) => (shouldDisplay ? <div className={className}>{children}</div> : null),
}));

// DropdownHeader → make click target predictable
vi.mock("./DropdownHeader/DropdownHeader", () => ({
  default: ({
    leverageTokenSymbol,
    toggleOpen,
  }: {
    leverageTokenSymbol: string;
    toggleOpen: () => void;
  }) => <button onClick={toggleOpen}>{leverageTokenSymbol} Details</button>,
}));

// Leverage range → deterministic output
vi.mock("../../../../utils/getLeverageRange.util", () => ({
  getLeverageRange: vi.fn(() => "1.91 - 2.11x"),
}));

// Address formatting → deterministic
vi.mock("../../../../utils/formatAddress.util", () => ({
  default: vi.fn(() => "0x1Eef...28c1"),
}));

// Explorer URL → deterministic
vi.mock("../../../../app/constants", () => ({
  blockExplorerAddress: vi.fn(
    () =>
      "https://hyperevmscan.io/address/0x1EefbAcFeA06D786Ce012c6fc861bec6C7a828c1",
  ),
}));

/* ---------------- tests ---------------- */

describe("TokenInformationDropdown", () => {
  it("renders header with token symbol", () => {
    render(
      <TokenInformationDropdown
        leverageTokenSymbol="BTC"
        leverageToken={BTC2L}
      />,
    );

    expect(screen.getByText("BTC Details")).toBeInTheDocument();
  });

  it("does not render dropdown content when closed", () => {
    render(
      <TokenInformationDropdown
        leverageTokenSymbol="BTC"
        leverageToken={BTC2L}
      />,
    );

    expect(screen.queryByText("Address")).not.toBeInTheDocument();
  });

  it("toggles dropdown content on header click", () => {
    render(
      <TokenInformationDropdown
        leverageTokenSymbol="BTC"
        leverageToken={BTC2L}
      />,
    );

    fireEvent.click(screen.getByText("BTC Details"));

    expect(screen.getByText("Leverage Range")).toBeInTheDocument();
    expect(screen.getByText("Address")).toBeInTheDocument();
  });

  it("renders leverage range", () => {
    render(
      <TokenInformationDropdown
        leverageTokenSymbol="BTC"
        leverageToken={BTC2L}
      />,
    );

    fireEvent.click(screen.getByText("BTC Details"));

    expect(screen.getByText("1.91 - 2.11x")).toBeInTheDocument();
  });

  it("renders formatted address with explorer link", () => {
    render(
      <TokenInformationDropdown
        leverageTokenSymbol="BTC"
        leverageToken={BTC2L}
      />,
    );

    fireEvent.click(screen.getByText("BTC Details"));

    const link = screen.getByRole("link");

    expect(link).toHaveAttribute(
      "href",
      "https://hyperevmscan.io/address/0x1EefbAcFeA06D786Ce012c6fc861bec6C7a828c1",
    );

    expect(link).toHaveTextContent("0x1Eef...28c1");
  });

  it("does not render dropdown content when leverageToken is undefined", () => {
    render(<TokenInformationDropdown leverageTokenSymbol="BTC" />);

    fireEvent.click(screen.getByText("BTC Details"));

    expect(screen.queryByText("Leverage Range")).not.toBeInTheDocument();
    expect(screen.queryByText("Address")).not.toBeInTheDocument();
  });
});
