"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityPanel } from "@/components/simulator/ActivityPanel";
import { MarketChart, type Overlay } from "@/components/simulator/MarketChart";
import { OrderTicket } from "@/components/simulator/OrderTicket";
import {
  formatInr,
  formatQuote,
  sessionLabel,
  simulatorApi,
  simulatorErrorPresentation,
  type Candle,
  type Instrument,
  type Journal,
  type Review,
  type SimulatorSession,
  type Timeframe,
} from "@/lib/simulator";
import "./terminal.css";
const uid = () => crypto.randomUUID();
export default function TradePage() {
  const [instruments, setInstruments] = useState<Instrument[]>([]),
    [selected, setSelected] = useState("NASDAQ:AAPL"),
    [mode, setMode] = useState<"replay" | "delayed">("replay"),
    [source, setSource] = useState<"synthetic-test" | "polygon">("polygon"),
    [days, setDays] = useState<7 | 30 | 90 | 365>(30),
    [session, setSession] = useState<SimulatorSession | null>(null),
    [candles, setCandles] = useState<Candle[]>([]),
    [timeframe, setTimeframe] = useState<Timeframe>("1m"),
    [overlays, setOverlays] = useState<Overlay[]>(["ema"]),
    [journal, setJournal] = useState<Journal>({ plan: "", reflection: "" }),
    [review, setReview] = useState<Review>(),
    [query, setQuery] = useState(""),
    [seekDraft, setSeekDraft] = useState<number | null>(null),
    [pending, setPending] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>();
  const controller = useRef(uid()),
    instrument = useMemo(
      () =>
        instruments.find((x) => x.id === (session?.instrument_id || selected)),
      [instruments, selected, session],
    ),
    filtered = useMemo(
      () =>
        instruments.filter((x) =>
          `${x.symbol} ${x.venue}`.toLowerCase().includes(query.toLowerCase()),
        ),
      [instruments, query],
    ),
    last = candles.at(-1);
  const refresh = useCallback(
    async (id: string) => {
      const [s, c] = await Promise.all([
        simulatorApi.getSession(id),
        simulatorApi.candles(id, { limit: 700, timeframe }),
      ]);
      setSession(s);
      setCandles(c);
      return s;
    },
    [timeframe],
  );
  useEffect(() => {
    Promise.allSettled([simulatorApi.instruments(), simulatorApi.bootstrap()])
      .then(async ([catalog, access]) => {
        if (catalog.status === "fulfilled") setInstruments(catalog.value);
        else setError(catalog.reason);
        if (access.status === "rejected") setError(access.reason);
        const id = new URLSearchParams(location.search).get("session");
        if (id && access.status === "fulfilled") {
          const s = await refresh(id);
          setJournal(await simulatorApi.getJournal(s.id));
        }
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => refresh(session.id).catch(setError), 1800);
    return () => clearInterval(timer);
  }, [session?.id, refresh]);
  useEffect(() => {
    if (!session || session.state !== "playing" || session.mode !== "replay")
      return;
    const timer = setInterval(
      () =>
        simulatorApi
          .control(
            session.id,
            "heartbeat",
            uid(),
            undefined,
            controller.current,
          )
          .catch(setError),
      5000,
    );
    return () => clearInterval(timer);
  }, [session?.id, session?.state, session?.mode]);
  async function start() {
    setPending(true);
    setError(undefined);
    try {
      const s = await simulatorApi.createSession(
        { mode, instrument_id: selected, source, history_days: days },
        uid(),
      );
      setSession(s);
      setCandles(await simulatorApi.candles(s.id, { limit: 700, timeframe }));
      history.replaceState(null, "", `/trade?session=${s.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  async function mutate(job: () => Promise<unknown>) {
    if (!session || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await job();
      await refresh(session.id);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  async function seek(target: number) {
    if (!session || pending || target === session.clock) return;
    setPending(true);
    setError(undefined);
    try {
      const next = await simulatorApi.control(
        session.id,
        "seek",
        uid(),
        target,
      );
      setSession(next);
      setCandles(
        await simulatorApi.candles(next.id, { limit: 700, timeframe }),
      );
      if (next.id !== session.id) {
        setJournal(await simulatorApi.getJournal(next.id));
        setReview(undefined);
      }
      history.replaceState(null, "", `/trade?session=${next.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setSeekDraft(null);
      setPending(false);
    }
  }
  const older = useCallback(async () => {
    if (!session || !candles.length) return;
    try {
      const c = await simulatorApi.candles(session.id, {
        before: candles[0].time,
        limit: 700,
        timeframe,
      });
      if (c.length) setCandles((v) => [...c, ...v]);
    } catch (e) {
      setError(e);
    }
  }, [session, candles, timeframe]);
  if (loading)
    return (
      <main className="loading">
        <b>CC</b>
        <p>Connecting to the practice exchange…</p>
      </main>
    );
  if (!session)
    return (
      <main className="launch">
        <header>
          <b>
            CHARTCOACH <span>/ Practice Exchange</span>
          </b>
          <small>● Simulator online</small>
        </header>
        <div className="launch-grid">
          <section>
            <label>SERVER-AUTHORITATIVE PAPER TRADING</label>
            <h1>
              Train the decision.
              <br />
              <em>Not the outcome.</em>
            </h1>
            <p>
              Replay up to one year of minute-level history or use a persistent
              15-minute delayed market clock. Every fill, cost and risk decision
              is recorded.
            </p>
            <div className="stats">
              <b>
                ₹10L<small>virtual capital</small>
              </b>
              <b>
                40<small>instruments</small>
              </b>
              <b>
                1m<small>execution precision</small>
              </b>
            </div>
          </section>
          <section className="builder">
            <div className="modes">
              <button
                className={mode === "replay" ? "on" : ""}
                onClick={() => setMode("replay")}
              >
                Historical replay<small>Control the clock</small>
              </button>
              <button
                className={mode === "delayed" ? "on" : ""}
                onClick={() => setMode("delayed")}
              >
                Delayed paper<small>Persistent account</small>
              </button>
            </div>
            <label>
              Instrument
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setSource(
                    e.target.value.startsWith("NASDAQ:")
                      ? "polygon"
                      : "synthetic-test",
                  );
                }}
              >
                {instruments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.symbol} · {x.venue} · {x.asset_class}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <label>
                History
                <select
                  value={days}
                  onChange={(e) =>
                    setDays(Number(e.target.value) as typeof days)
                  }
                >
                  {[7, 30, 90, 365].map((x) => (
                    <option key={x} value={x}>
                      {x === 365 ? "1 year" : `${x} days`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data source
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as typeof source)}
                >
                  <option value="synthetic-test">Deterministic test</option>
                  {selected.startsWith("NASDAQ:") && (
                    <option value="polygon">Polygon market data</option>
                  )}
                </select>
              </label>
            </div>
            <p className="note">
              ●{" "}
              {source === "polygon"
                ? `Polygon minute bars · ${mode === "delayed" ? "15-minute delay" : "historical replay"}`
                : "Labeled educational fixture data"}
            </p>
            <button className="open" disabled={pending} onClick={start}>
              {pending ? "Preparing market data…" : "Open trading workspace →"}
            </button>
          </section>
        </div>
        {Boolean(error) && <Toast error={error} close={() => setError(undefined)} />}
      </main>
    );
  const date = session.market_time
    ? new Date(session.market_time * 1000).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Waiting for market";
  return (
    <main className="terminal">
      <header className="top">
        <b className="logo">CC</b>
        <div>
          <strong>{instrument?.symbol}</strong>
          <small>
            {instrument?.venue} · {instrument?.asset_class}
          </small>
        </div>
        <div>
          <strong>
            {last
              ? formatQuote(last.close, instrument?.quote_currency || "USD")
              : "—"}
          </strong>
          <small>{date}</small>
        </div>
        <span className="feed">
          ●{" "}
          {sessionLabel(session.mode, session.data_source || "synthetic-test")}
        </span>
        <button
          onClick={() => {
            setSession(null);
            history.replaceState(null, "", "/trade");
          }}
        >
          Exit
        </button>
      </header>
      <div className="metrics">
        <Metric n="Equity" v={session.account.equity} />
        <Metric
          n="Available"
          v={session.account.buying_power || session.account.cash}
        />
        <Metric n="Reserved" v={session.account.reserved || "0"} />
        <Metric n="Realized P&L" v={session.account.realized_pnl || "0"} />
        <Metric n="Unrealized P&L" v={session.account.unrealized_pnl || "0"} />
      </div>
      <div className="body">
        <aside className="watch">
          <h3>
            WATCHLIST <small>{filtered.length}</small>
          </h3>
          <input
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.map((x) => (
            <button
              key={x.id}
              className={x.id === session.instrument_id ? "on" : ""}
              disabled={x.id !== session.instrument_id}
            >
              <b>
                {x.symbol}
                <small>{x.venue}</small>
              </b>
              <span>{x.quote_currency}</span>
            </button>
          ))}
        </aside>
        <section className="work">
          <nav className="tools">
            <div>
              {(["1m", "5m", "15m", "1h", "1d"] as Timeframe[]).map((x) => (
                <button
                  className={x === timeframe ? "on" : ""}
                  key={x}
                  onClick={() => setTimeframe(x)}
                >
                  {x}
                </button>
              ))}
            </div>
            <div>
              {(["sma", "ema", "vwap"] as Overlay[]).map((x) => (
                <button
                  className={overlays.includes(x) ? "on" : ""}
                  key={x}
                  onClick={() =>
                    setOverlays((v) =>
                      v.includes(x) ? v.filter((y) => y !== x) : [...v, x],
                    )
                  }
                >
                  {x.toUpperCase()}
                </button>
              ))}
            </div>
            <small>{candles.length} bars</small>
          </nav>
          <div className="chart">
            {candles.length ? (
              <MarketChart
                candles={candles}
                overlays={overlays}
                onLoadOlder={older}
              />
            ) : (
              <p>No visible data</p>
            )}
          </div>
          {session.mode === "replay" && (
            <div className="controls">
              <button
                onClick={() =>
                  mutate(() => simulatorApi.control(session.id, "step", uid()))
                }
              >
                │▶ Step
              </button>
              <button
                className="play"
                onClick={() =>
                  mutate(() =>
                    simulatorApi.control(
                      session.id,
                      session.state === "playing" ? "pause" : "play",
                      uid(),
                    ),
                  )
                }
              >
                {session.state === "playing" ? "❚❚ Pause" : "▶ Play"}
              </button>
              {[5, 10, 20, 30].map((x) => (
                <button
                  className={session.speed === x ? "on" : ""}
                  key={x}
                  onClick={() =>
                    mutate(() =>
                      simulatorApi.control(session.id, "speed", uid(), x),
                    )
                  }
                >
                  {x}×
                </button>
              ))}
              <div className="seek-control">
                <input
                  aria-label="Replay position"
                  type="range"
                  min={session.initial_clock ?? 0}
                  max={session.total_bars ?? session.clock ?? 0}
                  value={seekDraft ?? session.clock ?? 0}
                  disabled={pending}
                  onChange={(event) =>
                    setSeekDraft(Number(event.currentTarget.value))
                  }
                  onPointerUp={(event) =>
                    void seek(Number(event.currentTarget.value))
                  }
                  onKeyUp={(event) => {
                    if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "Home",
                        "End",
                        "PageUp",
                        "PageDown",
                      ].includes(event.key)
                    )
                      void seek(Number(event.currentTarget.value));
                  }}
                />
                <output>
                  {seekDraft ?? session.clock ?? 0} / {session.total_bars ?? 0}
                </output>
                <small>Backtracking creates an assisted copy</small>
              </div>
            </div>
          )}
          <ActivityPanel
            session={session}
            instrument={instrument}
            journal={journal}
            review={review}
            onCancel={(id) =>
              mutate(() => simulatorApi.cancelOrder(session.id, id, uid()))
            }
            onAmend={(id, price) =>
              mutate(() =>
                simulatorApi.amendOrder(
                  session.id,
                  id,
                  { limit_price: price },
                  uid(),
                ),
              )
            }
            onClose={(id, q) =>
              mutate(() => simulatorApi.closePosition(session.id, id, q, uid()))
            }
            onSaveJournal={(j) =>
              mutate(async () => {
                await simulatorApi.journal(
                  session.id,
                  j.plan,
                  j.reflection,
                  uid(),
                );
                setJournal(j);
              })
            }
            onReview={() =>
              simulatorApi.review(session.id).then(setReview).catch(setError)
            }
          />
        </section>
        <aside className="rail">
          <h3>
            ORDER ENTRY <small>{instrument?.symbol}</small>
          </h3>
          <OrderTicket
            instrumentId={session.instrument_id}
            quoteCurrency={instrument?.quote_currency || "USD"}
            pending={pending}
            onSubmit={(p) =>
              mutate(() => simulatorApi.order(session.id, p, uid()))
            }
          />
          <div className="risk">
            <b>Educational cash preset</b>
            <p>
              Long-only · 5 bps commission/spread · 2 bps slippage · 5 bps FX
            </p>
          </div>
        </aside>
      </div>
      {Boolean(error) && <Toast error={error} close={() => setError(undefined)} />}
    </main>
  );
}
function Metric({ n, v }: { n: string; v: string }) {
  const x = Number(v);
  return (
    <div>
      <span>{n}</span>
      <b className={x < 0 ? "neg" : n.includes("P&L") && x > 0 ? "pos" : ""}>
        {formatInr(v)}
      </b>
    </div>
  );
}
function Toast({ error, close }: { error: unknown; close: () => void }) {
  const e = simulatorErrorPresentation(error);
  return (
    <div className="toast" role="alert">
      <div>
        <b>{e.title}</b>
        <p>{e.message}</p>
      </div>
      <button onClick={close}>×</button>
    </div>
  );
}
