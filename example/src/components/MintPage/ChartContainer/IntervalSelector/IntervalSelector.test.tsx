import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import configureMockStore from "redux-mock-store";
import { vi } from "vitest";

import IntervalSelector from "./IntervalSelector";
import styles from "./IntervalSelector.module.css";
import { chartTimeIntervals } from "../../../../constants/chartTimeIntervals";
import { TARGET_ASSETS } from "../../../../constants/targetAssets";
import { setSelectedInterval } from "../../../../state/mintSlice";

import type { Store } from "@reduxjs/toolkit";

const mockStore = configureMockStore([]);

const store = mockStore({
  mint: {
    selected: {
      interval: "1m",
      targetAsset: TARGET_ASSETS[0],
      leverage: 2,
      longOrShort: "long",
    },
  },
});

vi.mock("../../../../hooks/useLiveTrades", () => ({
  useLiveTrades: () => null,
}));

describe("IntervalSelector", () => {
  it("renders all intervals and timezone label", () => {
    render(
      <Provider store={store as Store}>
        <IntervalSelector />
      </Provider>,
    );

    chartTimeIntervals.forEach((interval) => {
      expect(screen.getByText(interval)).toBeInTheDocument();
    });

    expect(screen.getByText(/^UTC/)).toBeInTheDocument();
  });
});

test("dispatches setSelectedInterval on button click", () => {
  const store = mockStore({
    mint: {
      selected: {
        interval: chartTimeIntervals[0],
        targetAsset: TARGET_ASSETS[0],
        leverage: 2,
        longOrShort: "long",
      },
    },
  });
  store.dispatch = vi.fn();

  render(
    <Provider store={store as Store}>
      <IntervalSelector />
    </Provider>,
  );

  const button = screen.getByText(chartTimeIntervals[1]);
  fireEvent.click(button);

  expect(store.dispatch).toHaveBeenCalledWith(
    setSelectedInterval(chartTimeIntervals[1]),
  );
});

test("active class is applied correctly", () => {
  const store = mockStore({
    mint: {
      selected: {
        interval: chartTimeIntervals[1],
        targetAsset: TARGET_ASSETS[0],
        leverage: 2,
        longOrShort: "long",
      },
    },
  });

  render(
    <Provider store={store as Store}>
      <IntervalSelector />
    </Provider>,
  );

  const activeButton = screen.getByText(chartTimeIntervals[1]);
  expect(activeButton).toHaveClass(styles.active);
});
