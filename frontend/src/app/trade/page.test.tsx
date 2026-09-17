import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TradePage from "./page";
import { simulatorApi } from "@/lib/simulator";

vi.mock("@/components/simulator/MarketChart", () => ({ MarketChart: () => <div>Chart</div> }));
vi.mock("@/components/simulator/ActivityPanel", () => ({ ActivityPanel: () => <div>Activity</div> }));
vi.mock("@/components/simulator/OrderTicket", () => ({ OrderTicket: () => <div>Ticket</div> }));

const session = {
  id: "sim-1", mode: "replay" as const, instrument_id: "NASDAQ:AAPL", clock: 320,
  initial_clock: 300, market_time: 1_700_019_200, state: "paused", speed: 5,
  assisted: false, revision: 1, total_bars: 420, data_source: "polygon",
  account: { id: "account-1", cash: "1000000", equity: "1000000", reporting_currency: "INR" },
  orders: [], fills: [], positions: [], ledger: [],
};

describe("TradePage replay controls", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); history.replaceState(null, "", "/"); });

  it("offers the requested replay speeds and a seekable timeline", async () => {
    history.replaceState(null, "", "/trade?session=sim-1");
    vi.spyOn(simulatorApi, "instruments").mockResolvedValue([{ id: "NASDAQ:AAPL", symbol: "AAPL", venue: "NASDAQ", asset_class: "stock", quote_currency: "USD", source: "polygon" }]);
    vi.spyOn(simulatorApi, "bootstrap").mockResolvedValue({ equity: "1000000", account_id: "account-1", modes: ["replay"] });
    vi.spyOn(simulatorApi, "getSession").mockResolvedValue(session);
    vi.spyOn(simulatorApi, "candles").mockResolvedValue([]);
    vi.spyOn(simulatorApi, "getJournal").mockResolvedValue({ plan: "", reflection: "" });

    render(<TradePage />);

    await waitFor(() => expect(screen.getByRole("button", { name: "10×" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "5×" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "20×" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30×" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Replay position" })).toHaveAttribute("min", "300");
    expect(screen.getByRole("slider", { name: "Replay position" })).toHaveAttribute("max", "420");
  });

  it("seeks to the selected bar and switches to a returned fork", async () => {
    history.replaceState(null, "", "/trade?session=sim-1");
    vi.spyOn(simulatorApi, "instruments").mockResolvedValue([{ id: "NASDAQ:AAPL", symbol: "AAPL", venue: "NASDAQ", asset_class: "stock", quote_currency: "USD", source: "polygon" }]);
    vi.spyOn(simulatorApi, "bootstrap").mockResolvedValue({ equity: "1000000", account_id: "account-1", modes: ["replay"] });
    vi.spyOn(simulatorApi, "getSession").mockResolvedValue(session);
    vi.spyOn(simulatorApi, "candles").mockResolvedValue([]);
    vi.spyOn(simulatorApi, "getJournal").mockResolvedValue({ plan: "", reflection: "" });
    const control = vi.spyOn(simulatorApi, "control").mockResolvedValue({ ...session, id: "sim-fork", clock: 305, assisted: true, parent_session_id: session.id });

    render(<TradePage />);

    const slider = await screen.findByRole("slider", { name: "Replay position" });
    fireEvent.change(slider, { target: { value: "305" } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(control).toHaveBeenCalledWith("sim-1", "seek", expect.any(String), 305));
    await waitFor(() => expect(location.search).toBe("?session=sim-fork"));
  });
});
