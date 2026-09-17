export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";
export type Candle = { time: number; open: string; high: string; low: string; close: string; volume: string };
export type IndicatorPoint = { time: number; value: number };
export type OrderDraft = { side: "buy" | "sell"; order_type: "market" | "limit" | "stop_market" | "stop_limit"; quantity: string; limit_price: string; stop_price: string; stop_loss: string; take_profit: string; time_in_force: "DAY" | "GTC" };
export type SimulatorAccount = { id: string; cash: string; equity: string; reporting_currency: string; buying_power?: string; realized_pnl?: string; unrealized_pnl?: string; reserved?: string };
export type SimulatorOrder = { id: string; instrument_id?: string; side: string; order_type: string; quantity: string; filled_quantity?: string; price?: string; limit_price?: string; stop_price?: string; stop_loss?: string; take_profit?: string; time_in_force?: string; status: string; created_at?: string };
export type SimulatorFill = { id: string; order_id: string; instrument_id?: string; side?: string; price: string; quantity: string; fee: string; time?: number; created_at?: string };
export type SimulatorPosition = { instrument_id: string; quantity: string; average_price?: string; avg_price?: string; market_price?: string; market_value?: string; unrealized_pnl?: string; realized_pnl?: string };
export type LedgerEntry = { id?: string; type?: string; event?: string; amount?: string; balance?: string; time?: number; created_at?: string; description?: string };
export type DatasetCoverage = { start?: number | string; end?: number | string; requested_days?: number; actual_days?: number; complete?: boolean; message?: string };
export type SimulatorSession = { id: string; mode: "replay" | "delayed" | "drill"; instrument_id: string; clock?: number; initial_clock?: number; market_time?: number; state: string; speed: number; assisted: boolean; parent_session_id?: string; forked_at_clock?: number; revision: number; source?: string; data_source?: string; data_status?: string; coverage?: DatasetCoverage; dataset?: { coverage?: DatasetCoverage; source?: string }; total_bars?: number; account: SimulatorAccount; orders: SimulatorOrder[]; fills: SimulatorFill[]; positions?: SimulatorPosition[]; ledger?: LedgerEntry[] };
export type Instrument = { id: string; symbol: string; venue: string; asset_class: string; quote_currency: string; source: string; replay_source?: string; delayed_source?: string; polygon_supported?: boolean; name?: string };
export type Journal = { plan: string; reflection: string; updated_at?: string };
export type Review = { score: number; passed: boolean; assisted: boolean; dimensions: Record<string, number>; ai_review?: { available: boolean; reason?: string } };

const timeframeSeconds: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };
export function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  const seconds = timeframeSeconds[timeframe];
  if (seconds === 60) return [...candles];
  const buckets = new Map<number, Candle>();
  for (const candle of [...candles].sort((a, b) => a.time - b.time)) {
    const time = Math.floor(candle.time / seconds) * seconds;
    const current = buckets.get(time);
    if (!current) buckets.set(time, { ...candle, time });
    else buckets.set(time, { ...current, high: String(Math.max(Number(current.high), Number(candle.high))), low: String(Math.min(Number(current.low), Number(candle.low))), close: candle.close, volume: String(Number(current.volume) + Number(candle.volume)) });
  }
  return [...buckets.values()];
}
export function calculateSMA(candles: Candle[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  for (let index = period - 1; index < candles.length; index++) result.push({ time: candles[index].time, value: candles.slice(index - period + 1, index + 1).reduce((sum, item) => sum + Number(item.close), 0) / period });
  return result;
}
export function calculateEMA(candles: Candle[], period: number): IndicatorPoint[] {
  if (candles.length < period) return [];
  const multiplier = 2 / (period + 1);
  let value = candles.slice(0, period).reduce((sum, item) => sum + Number(item.close), 0) / period;
  const result = [{ time: candles[period - 1].time, value }];
  for (let index = period; index < candles.length; index++) { value = (Number(candles[index].close) - value) * multiplier + value; result.push({ time: candles[index].time, value }); }
  return result;
}
export function calculateVWAP(candles: Candle[]): IndicatorPoint[] {
  let priceVolume = 0; let volume = 0;
  return candles.map((candle) => { const size = Number(candle.volume); priceVolume += ((Number(candle.high) + Number(candle.low) + Number(candle.close)) / 3) * size; volume += size; return { time: candle.time, value: volume ? priceVolume / volume : Number(candle.close) }; });
}
export function calculateRSI(candles: Candle[], period = 14): IndicatorPoint[] {
  if (candles.length <= period) return [];
  let gains = 0; let losses = 0;
  for (let index = 1; index <= period; index++) { const change = Number(candles[index].close) - Number(candles[index - 1].close); gains += Math.max(change, 0); losses += Math.max(-change, 0); }
  let averageGain = gains / period; let averageLoss = losses / period;
  const value = () => averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  const result = [{ time: candles[period].time, value: value() }];
  for (let index = period + 1; index < candles.length; index++) { const change = Number(candles[index].close) - Number(candles[index - 1].close); averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period; averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period; result.push({ time: candles[index].time, value: value() }); }
  return result;
}
export function calculateMACD(candles: Candle[], fast = 12, slow = 26, signal = 9) {
  const fastMap = new Map(calculateEMA(candles, fast).map((point) => [point.time, point.value]));
  const line = calculateEMA(candles, slow).map((point) => ({ time: point.time, value: (fastMap.get(point.time) ?? point.value) - point.value }));
  const signalInput = line.map((point) => ({ time: point.time, open: String(point.value), high: String(point.value), low: String(point.value), close: String(point.value), volume: "0" }));
  const signalMap = new Map(calculateEMA(signalInput, signal).map((point) => [point.time, point.value]));
  return line.filter((point) => signalMap.has(point.time)).map((point) => ({ ...point, signal: signalMap.get(point.time)!, histogram: point.value - signalMap.get(point.time)! }));
}
const positive = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0;
export function validateOrderDraft(order: OrderDraft): string[] {
  const errors: string[] = [];
  if (!positive(order.quantity)) errors.push("Quantity must be greater than zero.");
  if ((order.order_type === "limit" || order.order_type === "stop_limit") && !positive(order.limit_price)) errors.push("Limit price must be greater than zero.");
  if ((order.order_type === "stop_market" || order.order_type === "stop_limit") && !positive(order.stop_price)) errors.push("Stop price must be greater than zero.");
  const entry = Number(order.limit_price || order.stop_price);
  if (positive(order.stop_loss) && positive(String(entry)) && order.side === "buy" && Number(order.stop_loss) >= entry) errors.push("Stop loss must be below the entry price for a buy order.");
  if (positive(order.take_profit) && positive(String(entry)) && order.side === "buy" && Number(order.take_profit) <= entry) errors.push("Take profit must be above the entry price for a buy order.");
  if (positive(order.stop_loss) && positive(String(entry)) && order.side === "sell" && Number(order.stop_loss) <= entry) errors.push("Stop loss must be above the entry price for a sell order.");
  if (positive(order.take_profit) && positive(String(entry)) && order.side === "sell" && Number(order.take_profit) >= entry) errors.push("Take profit must be below the entry price for a sell order.");
  return errors;
}
export function createLatestRequestGuard() { let latest = 0; return { issue: () => ++latest, isLatest: (request: number) => request === latest }; }

const baseUrl = () => process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || (typeof window === "undefined" ? "http://localhost:8000" : `${window.location.protocol}//${window.location.hostname}:8000`);
export class SimulatorApiError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "SimulatorApiError"; } }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${baseUrl()}/api/v1/simulator${path}`, { credentials: "include", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    if (!response.ok) { const body = await response.json().catch(() => null); const message = body?.error?.message || body?.detail?.message || body?.detail || (response.status === 401 ? "Your session has expired. Sign in again to use practice trading." : response.status === 403 ? "Practice trading requires the Trader plan or higher." : `Simulator request failed (${response.status}).`); throw new SimulatorApiError(typeof message === "string" ? message : "Simulator request failed.", response.status, body?.error?.code || body?.detail?.code); }
    if (response.status === 204) return undefined as T;
    return response.json();
  } catch (error) { if (error instanceof SimulatorApiError) throw error; throw new SimulatorApiError("The practice service is not reachable. Check that the backend is running on port 8000, then retry.", 0, "BACKEND_UNREACHABLE"); }
}
const keyed = (key: string, body?: unknown, method = "POST"): RequestInit => ({ method, headers: { "Idempotency-Key": key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const simulatorApi = {
  bootstrap: () => request<{ equity: string; account_id: string; modes: string[] }>("/bootstrap"),
  instruments: () => request<Instrument[]>("/instruments"), sessions: () => request<SimulatorSession[]>("/sessions"),
  drills: () => request<Array<{ id: string; title: string; title_hi: string; objective: string }>>("/drills"),
  createSession: (payload: { mode: "replay" | "delayed" | "drill"; instrument_id: string; source: "synthetic-test" | "polygon"; history_days: 7 | 30 | 90 | 365; drill_id?: string }, key: string) => request<SimulatorSession>("/sessions", keyed(key, payload)),
  getSession: (id: string) => request<SimulatorSession>(`/sessions/${id}`),
  candles: (id: string, options: { before?: number; limit?: number; timeframe?: Timeframe } = {}) => { const query = new URLSearchParams(); if (options.before) query.set("before", String(options.before)); query.set("limit", String(options.limit ?? 500)); query.set("timeframe", options.timeframe ?? "1m"); return request<Candle[]>(`/sessions/${id}/candles?${query}`); },
  control: (id: string, action: string, key: string, value?: number, controller_id?: string) => request<SimulatorSession>(`/sessions/${id}/controls`, keyed(key, { action, ...(value === undefined ? {} : { value }), ...(controller_id ? { controller_id } : {}) })),
  order: (id: string, payload: Record<string, unknown>, key: string) => request<SimulatorOrder>(`/sessions/${id}/orders`, keyed(key, payload)),
  amendOrder: (id: string, orderId: string, payload: Record<string, unknown>, key: string) => request<SimulatorOrder>(`/sessions/${id}/orders/${orderId}`, keyed(key, payload, "PATCH")),
  cancelOrder: (id: string, orderId: string, key: string) => request<SimulatorOrder>(`/sessions/${id}/orders/${orderId}/cancel`, keyed(key)),
  closePosition: (id: string, instrumentId: string, quantity: string, key: string) => request<unknown>(`/sessions/${id}/positions/${encodeURIComponent(instrumentId)}/close`, keyed(key, { quantity })),
  getJournal: (id: string) => request<Journal>(`/sessions/${id}/journal`),
  journal: (id: string, plan: string, reflection: string, key: string) => request<{ saved: boolean }>(`/sessions/${id}/journal`, keyed(key, { plan, reflection }, "PUT")),
  review: (id: string) => request<Review>(`/sessions/${id}/review`),
  resetAccount: (id: string, key: string) => request<{ account: SimulatorAccount }>(`/accounts/${id}/reset`, keyed(key, { reason: "learner_requested" })),
};
export const formatInr = (value: string | number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(Number(value));
export const formatQuote = (value: string | number | undefined, currency: string) => value === undefined ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 4 }).format(Number(value));
export type SimulatorErrorPresentation = { title: string; message: string; actionLabel?: string; actionHref?: string };
export function simulatorErrorPresentation(error: unknown): SimulatorErrorPresentation {
  const apiError = error instanceof SimulatorApiError ? error : undefined; const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; message?: unknown } : undefined; const code = apiError?.code || (typeof candidate?.code === "string" ? candidate.code : undefined); const status = apiError?.status ?? (typeof candidate?.status === "number" ? candidate.status : undefined);
  if (code === "BACKEND_UNREACHABLE" || status === 0) return { title: "Simulator backend unavailable", message: "The practice service is not reachable. Check that the backend is running on port 8000, then retry.", actionLabel: "Retry" };
  if (code === "UNAUTHORIZED" || status === 401) return { title: "Sign in required", message: "Sign in to open the practice simulator.", actionLabel: "Sign in", actionHref: "/login?next=%2Ftrade" };
  if (code === "ENTITLEMENT_REQUIRED" || status === 403) return { title: "Practice access is locked", message: "Trading practice requires the Trader plan or higher.", actionLabel: "View plans", actionHref: "/pricing" };
  if (code === "MARKET_DATA_UNAVAILABLE" || status === 503) return { title: "Delayed market data unavailable", message: "Polygon did not return a usable quote or candle set for this instrument. No order was submitted.", actionLabel: "Retry" };
  const message = error instanceof Error && error.message ? error.message : typeof candidate?.message === "string" && candidate.message ? candidate.message : "The simulator could not complete that request."; return { title: "Simulator request failed", message, actionLabel: "Retry" };
}
const sourceLabels: Record<string, string> = { "synthetic-test": "Synthetic test data", polygon: "Polygon requested", "polygon-delayed": "Polygon delayed data", "historical-replay": "Historical replay data", "delayed-feed": "Delayed market feed" };
export const sessionLabel = (mode: string, source: string) => `${mode === "replay" ? "Replay" : mode === "delayed" ? "Delayed practice" : "Guided drill"} · ${sourceLabels[source] || source}`;
