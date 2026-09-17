import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketChart } from "./MarketChart";

const createChart = vi.fn();

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "Candlestick",
  HistogramSeries: "Histogram",
  LineSeries: "Line",
  ColorType: { Solid: "solid" },
  createChart: (...args: unknown[]) => createChart(...args),
}));

function chartFixture() {
  const series = {
    setData: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    createPriceLine: vi.fn(),
  };
  return {
    addSeries: vi.fn(() => ({ ...series })),
    removeSeries: vi.fn(),
    remove: vi.fn(),
    timeScale: () => ({
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      fitContent: vi.fn(),
      setVisibleLogicalRange: vi.fn(),
    }),
  };
}

describe("MarketChart", () => {
  beforeEach(() => {
    createChart.mockReset();
    createChart.mockImplementation(chartFixture);
  });

  it("keeps one chart instance when the load-older callback changes", () => {
    const candles = Array.from({ length: 24 }, (_, index) => ({
      time: 1_700_000_000 + index * 60,
      open: "100",
      high: "102",
      low: "99",
      close: "101",
      volume: "1000",
    }));
    const view = render(<MarketChart candles={candles} overlays={["ema"]} onLoadOlder={() => undefined} />);

    view.rerender(<MarketChart candles={[...candles]} overlays={["ema"]} onLoadOlder={() => undefined} />);

    expect(createChart).toHaveBeenCalledTimes(1);
  });
});
