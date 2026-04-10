import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { vi } from "vitest";

import Header from "./Header";
import { type FeatureFlags } from "../../../config/featureFlags";
import * as featureFlags from "../../../config/featureFlags";
import { ThemeProvider } from "../../../contexts/ThemeContext";

const getFalseFlags = (overrides: Partial<FeatureFlags> = {}): FeatureFlags => {
  const keys = Object.keys(overrides) as (keyof FeatureFlags)[];
  const allFalse = {} as FeatureFlags;
  for (const key of keys) allFalse[key] = false;
  return { ...allFalse, ...overrides };
};

const mockDispatch = vi.fn();

vi.mock("react-redux", async () => {
  const actual =
    await vi.importActual<typeof import("react-redux")>("react-redux");

  return {
    ...actual,
    useDispatch: () => mockDispatch,
  };
});

vi.mock("../../../web3/views/useBounceAccount", () => ({
  default: () => ({ isConnected: true }),
}));

vi.mock("../../../hooks/useUserHasRegistered", () => ({
  useUserHasRegistered: () => ({ hasRegistered: true }),
}));

vi.mock("../Connector/Connector", () => ({
  default: () => <div>Connector</div>,
}));

vi.mock("../Buttons/Button", () => ({
  default: () => <div>Button</div>,
}));

describe("Header, protocol links on", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Logo, Connector, ThemeToggle, Hamburger and nav links", () => {
    vi.spyOn(featureFlags, "useFeatureFlags").mockImplementation(() =>
      getFalseFlags({
        protocolLive: true,
        mintRoute: true,
        portfolioRoute: true,
        rewardsRoute: true,
        lockRoute: true,
        stakeRoute: true,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/"]}>
        <ThemeProvider>
          <Header />
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("logoLink")).toBeInTheDocument();
    expect(screen.getByTestId("themeToggle")).toBeInTheDocument();
    expect(screen.getByTestId("hamburger")).toBeInTheDocument();
    expect(screen.getByText("Connector")).toBeInTheDocument();

    expect(screen.getByText("Mint")).toBeInTheDocument();
    expect(screen.getByText("Lock")).toBeInTheDocument();
    expect(screen.getByText("Stake")).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    expect(screen.getByText("Rewards")).toBeInTheDocument();
  });

  it("renders routes to the correct page when active link clicked, disabled links do nothing", async () => {
    vi.spyOn(featureFlags, "useFeatureFlags").mockImplementation(() =>
      getFalseFlags({
        protocolLive: true,
        mintRoute: true,
        portfolioRoute: true,
        rewardsRoute: false, // Disabled to test disabled link behavior
        stakeRoute: true, // Enabled so Stake link shows
      }),
    );

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <ThemeProvider>
          <Header />
          <Routes>
            <Route path="/" element={<div>Home Page</div>} />
            <Route path="/portfolio" element={<div>Portfolio Page</div>} />
            <Route path="/mint" element={<div>Mint Page</div>} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const portfolioLink = screen.getByText("Portfolio");
    expect(portfolioLink).toHaveAttribute("href", "/portfolio");
    await user.click(portfolioLink);
    expect(screen.getByText("Portfolio Page")).toBeInTheDocument();

    // Click a disabled link (Rewards - it shows but is disabled)
    const rewardsLink = screen.getByText("Rewards");
    expect(rewardsLink.tagName.toLowerCase()).toBe("div");
    await user.click(rewardsLink);
    expect(screen.getByText("Portfolio Page")).toBeInTheDocument();
  });

  it("initially doesn't show the dropdown, then does when the hamburger is clicked", async () => {
    vi.spyOn(featureFlags, "useFeatureFlags").mockImplementation(() =>
      getFalseFlags({
        protocolLive: true,
        mintRoute: true,
        portfolioRoute: true,
        rewardsRoute: true,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/"]}>
        <ThemeProvider>
          <Header />
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("dropdownNav")).toBeNull();
    const hamburger = screen.getByTestId("hamburger");
    expect(hamburger).toBeInTheDocument();
    await userEvent.click(hamburger);
    const dropdown = await screen.findByTestId("dropdownNav");
    expect(dropdown).toBeInTheDocument();
    expect(screen.getByTestId("dropdownBackground").className).toMatch(
      /openBackground/,
    );
    await userEvent.click(screen.getByTestId("dropdownBackground"));
    await waitFor(() => {
      expect(screen.queryByTestId("dropdownNav")).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("dropdownNav")).toBeNull();
    expect(screen.getByTestId("dropdownBackground").className).not.toMatch(
      /openBackground/,
    );
  });
});

describe("Header, protocol links off", () => {
  it("renders Logo, Connector, ThemeToggle, Hamburger and nav links", () => {
    vi.spyOn(featureFlags, "useFeatureFlags").mockImplementation(() =>
      getFalseFlags({
        mintRoute: true,
        portfolioRoute: true,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/"]}>
        <ThemeProvider>
          <Header />
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("logoLink")).toBeInTheDocument();
    expect(screen.getByTestId("themeToggle")).toBeInTheDocument();
    expect(screen.getByText("Connector")).toBeInTheDocument();

    expect(screen.queryByTestId("hamburger")).not.toBeInTheDocument();

    expect(screen.queryByText("Mint")).not.toBeInTheDocument();
    expect(screen.queryByText("Lock")).not.toBeInTheDocument();
    expect(screen.queryByText("Stake")).not.toBeInTheDocument();
    expect(screen.queryByText("Portfolio")).not.toBeInTheDocument();
    expect(screen.queryByText("Rewards")).not.toBeInTheDocument();
  });
});
