import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import PositionList from "./PositionList";

import type { LeveragedTokenData } from "../../../types/leverageTokenData";

vi.mock("./PositionRow", () => ({
  default: ({ position }: { position: LeveragedTokenData }) => (
    <tr data-testid="position-row">
      <td>{position.symbol}</td>
    </tr>
  ),
}));

vi.mock("../../MintPage/Modals/ShareModal/ShareModal", () => ({
  default: () => <>share modal</>,
}));

const createPositions = (count: number): LeveragedTokenData[] =>
  Array.from({ length: count }, (_, i) => ({
    symbol: `TOKEN_${i}`,
  })) as LeveragedTokenData[];

describe("PositionList", () => {
  it("renders table headers", () => {
    render(<PositionList positions={createPositions(1)} />);

    expect(screen.getByText("Asset")).toBeInTheDocument();
    expect(screen.getByText("Nominal Value")).toBeInTheDocument();
    expect(screen.getByText("uPnL")).toBeInTheDocument();
  });

  it("renders only ITEMS_PER_PAGE positions on first page", () => {
    render(<PositionList positions={createPositions(10)} />);

    const rows = screen.getAllByTestId("position-row");
    expect(rows).toHaveLength(8);
  });

  it("shows correct pagination info", () => {
    render(<PositionList positions={createPositions(10)} />);

    expect(screen.getByText("Previous")).toBeInTheDocument();
  });

  it("changes page when pagination triggers onPageChange", () => {
    render(<PositionList positions={createPositions(10)} />);

    // Page 1 → 8 items
    expect(screen.getAllByTestId("position-row")).toHaveLength(8);

    fireEvent.click(screen.getByText("Next"));

    // Page 2 → remaining 2 items
    expect(screen.getAllByTestId("position-row")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });
});
