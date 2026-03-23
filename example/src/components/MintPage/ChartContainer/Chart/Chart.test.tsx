import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";
import { vi } from "vitest";

import { TARGET_ASSETS } from "../../../../constants/targetAssets";

import type { Store } from "@reduxjs/toolkit";

const mockStore = configureMockStore([]);
const store = mockStore({
  mint: {
    selected: {
      targetAsset: TARGET_ASSETS[0],
      interval: "1m",
      leverage: 2,
      leveragedTokenAddress: "0xTokenAddress",
      toggleMarkers: true,
      longOrShort: "long",
    },
  },
});

vi.mock("../../../../contexts/ThemeContextDef", () => ({
  useThemeContext: () => ({ theme: "light" }),
}));

vi.mock("../../../../hooks/useLiveTrades", () => ({
  useLiveTrades: () => null,
}));

const mockSetData = vi.fn();
const mockUpdate = vi.fn();

const mockAddSeries = vi.fn(() => ({
  setData: mockSetData,
  update: mockUpdate,
  attachPrimitive: vi.fn(),
}));

const mockCreateChart = vi.fn(() => ({
  addSeries: mockAddSeries,
  remove: vi.fn(),
  applyOptions: vi.fn(),
  timeScale: () => ({
    setVisibleRange: vi.fn(),
    applyOptions: vi.fn(),
  }),
}));

vi.mock("lightweight-charts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lightweight-charts")>();
  return {
    ...actual,
    createChart: mockCreateChart,
  };
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: () => void = () => {};
  onmessage: (event: unknown) => void = () => {};
  send = vi.fn();
  close = vi.fn();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

describe("Chart Component", () => {
  afterEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
  });

  it("renders JellyLoader while loading", async () => {
    vi.doMock("../../../../hooks/Hyperliquid/useHyperliquidCandles", () => ({
      useHyperliquidCandles: () => ({ candles: [], loading: true }),
    }));

    const Chart = (await import("./Chart")).default;

    render(
      <Provider store={store as Store}>
        <Chart setLivePrice={vi.fn()} />
      </Provider>,
    );

    expect(screen.getByTestId("jelly-loader")).toBeInTheDocument();
  });

  it("initialises chart and sets historical candles", async () => {
    vi.resetModules();

    vi.doMock("../../../../hooks/Hyperliquid/useHyperliquidCandles", () => ({
      useHyperliquidCandles: () => ({
        candles: [{ time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5 }],
        loading: false,
      }),
    }));

    const Chart = (await import("./Chart")).default;

    render(
      <Provider store={store as Store}>
        <Chart setLivePrice={vi.fn()} />
      </Provider>,
    );

    const chartDiv = screen.getByTestId("chart-container");
    expect(chartDiv).toBeInTheDocument();

    expect(mockSetData).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ open: 1, close: 1.5 }),
      ]),
    );

    expect(mockAddSeries).toHaveBeenCalled();
    expect(mockCreateChart).toHaveBeenCalled();
  });

  it("subscribes to WebSocket and updates on new candle", async () => {
    vi.resetModules();

    vi.doMock("../../../../hooks/Hyperliquid/useHyperliquidCandles", () => ({
      useHyperliquidCandles: () => ({
        candles: [{ time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5 }],
        loading: false,
      }),
    }));

    const Chart = (await import("./Chart")).default;

    render(
      <Provider store={store as Store}>
        <Chart setLivePrice={vi.fn()} />
      </Provider>,
    );

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const wsInstance = MockWebSocket.instances[0];

    wsInstance.onopen();
    expect(wsInstance.send).toHaveBeenCalledWith(
      expect.stringContaining('"method":"subscribe"'),
    );

    wsInstance.onmessage({
      data: JSON.stringify({
        channel: "candle",
        data: { t: 1700000000 * 1000, o: "1", h: "2", l: "0.5", c: "1.5" },
      }),
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ open: 1, close: 1.5 }),
    );
  });
});
