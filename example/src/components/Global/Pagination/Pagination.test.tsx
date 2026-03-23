import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import Pagination from "./Pagination";
import styles from "./Pagination.module.css";
import { getPaginationRange } from "./Pagination.utils";

vi.mock("./Pagination.utils", () => ({
  getPaginationRange: vi.fn(),
}));

describe("Pagination", () => {
  const onPageChange = vi.fn();

  const renderComponent = (currentPage = 2, totalPages = 5) => {
    render(
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when totalPages <= 1", () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} onPageChange={onPageChange} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders page buttons and navigation buttons", () => {
    vi.mocked(getPaginationRange).mockReturnValue([1, 2, 3]);

    renderComponent();

    expect(
      screen.getByRole("button", { name: /previous/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("disables previous button on first page", () => {
    vi.mocked(getPaginationRange).mockReturnValue([1, 2, 3]);

    renderComponent(1, 3);

    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("disables next button on last page", () => {
    vi.mocked(getPaginationRange).mockReturnValue([1, 2, 3]);

    renderComponent(3, 3);

    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("dispatches onPageChange when page button is clicked", () => {
    vi.mocked(getPaginationRange).mockReturnValue([1, 2, 3]);

    renderComponent();

    fireEvent.click(screen.getByText("3"));

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("dispatches onPageChange when clicking next", () => {
    vi.mocked(getPaginationRange).mockReturnValue([1, 2, 3]);

    renderComponent(2, 3);

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("dispatches onPageChange when clicking previous", () => {
    vi.mocked(getPaginationRange).mockReturnValue([1, 2, 3]);

    renderComponent(2, 3);

    fireEvent.click(screen.getByRole("button", { name: /previous/i }));

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("renders ellipsis when returned by pagination range", () => {
    vi.mocked(getPaginationRange).mockReturnValue([1, "...", 5]);

    renderComponent();

    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("applies active class to current page button", () => {
    vi.mocked(getPaginationRange).mockReturnValue([1, 2, 3]);

    renderComponent(2, 3);

    const activeButton = screen.getByText("2");
    expect(activeButton).toHaveClass(styles.activePageButton);
  });
});
