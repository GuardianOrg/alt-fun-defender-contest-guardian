import { render, screen, fireEvent } from "@testing-library/react";
import { useSelector, type Selector } from "react-redux";
import { describe, it, expect, vi, beforeEach } from "vitest";

import Toast from "./Toast";
import { clearToast, selectToast } from "../../../state/toastSlice";

vi.mock("react-redux", async () => {
  const actual =
    await vi.importActual<typeof import("react-redux")>("react-redux");

  return {
    ...actual,
    useDispatch: () => vi.fn(),
    useSelector: vi.fn(),
  };
});

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  motion: {
    div: ({ children, ...rest }: React.ComponentPropsWithoutRef<"div">) => (
      <div {...rest}>{children}</div>
    ),
  },
}));

vi.mock("../../../state/toastSlice", async () => {
  const actual = await vi.importActual<
    typeof import("../../../state/toastSlice")
  >("../../../state/toastSlice");
  return {
    ...actual,
    clearToast: vi.fn(() => ({ type: "toast/clearToast" })),
  };
});

const setupSelectors = (toastState: {
  isOpen: boolean;
  content: string | null;
  variant: "success" | "error" | "warning" | "info";
  loadingIcon: boolean;
  id: string;
}) => {
  vi.mocked(useSelector).mockImplementation(
    (selector: Selector<unknown, unknown>) => {
      if (selector === selectToast) return toastState;
      return null;
    },
  );
};

describe("Toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders toast content when open", () => {
    setupSelectors({
      isOpen: true,
      content: "Test notification",
      variant: "info",
      loadingIcon: false,
      id: "123",
    });

    render(<Toast />);

    expect(screen.getByText("Test notification")).toBeInTheDocument();
  });

  it("dispatches clearToast when close button is clicked", () => {
    setupSelectors({
      isOpen: true,
      content: "Test notification",
      variant: "info",
      loadingIcon: false,
      id: "123",
    });

    render(<Toast />);

    fireEvent.click(
      screen.getByRole("button", { name: /close notification/i }),
    );

    expect(clearToast).toHaveBeenCalled();
  });

  it("does not render when toast is closed", () => {
    setupSelectors({
      isOpen: false,
      content: null,
      variant: "info",
      loadingIcon: false,
      id: "123",
    });

    render(<Toast />);

    expect(screen.queryByText("Test notification")).not.toBeInTheDocument();
  });
});
