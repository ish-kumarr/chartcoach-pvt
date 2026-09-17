import { describe, expect, it } from "vitest";
import {
  aggregateCandles,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateVWAP,
  createLatestRequestGuard,
  formatInr,
  sessionLabel,
  simulatorErrorPresentation,
  SimulatorApiError,
  validateOrderDraft,
} from "./simulator";

describe("simulator presentation helpers", () => {
  it("formats INR equity and labels synthetic replay clearly", () => {
    expect(formatInr("1000000.00")).toBe("₹10,00,000.00");
    expect(sessionLabel("replay", "synthetic-test")).toBe("Replay · Synthetic test data");
  });

  it("turns an unauthenticated simulator response into a sign-in action", () => {
    expect(simulatorErrorPresentation(new SimulatorApiError("Could not verify your login. Please log in again.", 401, "UNAUTHORIZED"))).toEqual({
      title: "Sign in required",
      message: "Sign in to open the practice simulator.",
      actionLabel: "Sign in",
      actionHref: "/login?next=%2Ftrade",
    });
  });

  it("classifies API errors even when an app bundle returns a plain error object", () => {
    expect(simulatorErrorPresentation({ message: "Could not verify your login. Please log in again.", status: 401, code: "UNAUTHORIZED" })).toEqual({
      title: "Sign in required",
      message: "Sign in to open the practice simulator.",
      actionLabel: "Sign in",
      actionHref: "/login?next=%2Ftrade",
    });
  });

  it("explains when the backend cannot be reached", () => {
    expect(simulatorErrorPresentation(new SimulatorApiError("", 0, "BACKEND_UNREACHABLE"))).toEqual({
      title: "Simulator backend unavailable",
      message: "The practice service is not reachable. Check that the backend is running on port 8000, then retry.",
      actionLabel: "Retry",
    });
  });

  it("labels Polygon delayed instruments separately from synthetic fixtures", () => {
    expect(sessionLabel("delayed", "polygon-delayed")).toBe("Delayed practice · Polygon delayed data");
  });
});

const candles = [
  { time: 0, open: "10", high: "12", low: "9", close: "11", volume: "10" },
  { time: 60, open: "11", high: "14", low: "10", close: "13", volume: "20" },
  { time: 120, open: "13", high: "15", low: "12", close: "14", volume: "30" },
  { time: 300, open: "20", high: "22", low: "19", close: "21", volume: "40" },
];

describe("terminal market calculations", () => {
  it("aggregates candles into aligned intervals without filling market gaps", () => {
    expect(aggregateCandles(candles, "5m")).toEqual([
      { time: 0, open: "10", high: "15", low: "9", close: "14", volume: "60" },
      { time: 300, open: "20", high: "22", low: "19", close: "21", volume: "40" },
    ]);
  });

  it("calculates SMA, EMA and cumulative VWAP from real candle values", () => {
    expect(calculateSMA(candles, 3)).toEqual([{ time: 120, value: 12.666666666666666 }, { time: 300, value: 16 }]);
    expect(calculateEMA(candles, 3)).toEqual([{ time: 120, value: 12.666666666666666 }, { time: 300, value: 16.833333333333332 }]);
    expect(calculateVWAP(candles).map((point) => ({ ...point, value: Number(point.value.toFixed(4)) }))).toEqual([
      { time: 0, value: 10.6667 },
      { time: 60, value: 11.7778 },
      { time: 120, value: 12.7222 },
      { time: 300, value: 15.9 },
    ]);
  });

  it("returns bounded RSI and aligned MACD points once enough prices exist", () => {
    const trend = Array.from({ length: 40 }, (_, index) => ({ ...candles[0], time: index * 60, close: String(100 + index) }));
    expect(calculateRSI(trend, 14)[0]).toEqual({ time: 840, value: 100 });
    const macd = calculateMACD(trend);
    expect(macd.length).toBeGreaterThan(0);
    expect(macd[0]).toEqual(expect.objectContaining({ time: 1980 }));
  });
});

describe("terminal safety", () => {
  it("requires positive quantity and the applicable trigger prices", () => {
    expect(validateOrderDraft({ side: "buy", order_type: "limit", quantity: "0", limit_price: "", stop_price: "", stop_loss: "", take_profit: "", time_in_force: "DAY" })).toEqual([
      "Quantity must be greater than zero.",
      "Limit price must be greater than zero.",
    ]);
  });

  it("rejects buy brackets on the unsafe side of the entry", () => {
    expect(validateOrderDraft({ side: "buy", order_type: "limit", quantity: "2", limit_price: "100", stop_price: "", stop_loss: "101", take_profit: "99", time_in_force: "GTC" })).toEqual([
      "Stop loss must be below the entry price for a buy order.",
      "Take profit must be above the entry price for a buy order.",
    ]);
  });

  it("ignores a response older than the latest issued poll", () => {
    const guard = createLatestRequestGuard();
    const first = guard.issue();
    const second = guard.issue();
    expect(guard.isLatest(first)).toBe(false);
    expect(guard.isLatest(second)).toBe(true);
  });
});
