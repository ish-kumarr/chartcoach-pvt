"use client";
import { useState } from "react";
import { type OrderDraft, validateOrderDraft } from "@/lib/simulator";

const empty: OrderDraft = { side: "buy", order_type: "market", quantity: "", limit_price: "", stop_price: "", stop_loss: "", take_profit: "", time_in_force: "DAY" };
export function OrderTicket({ instrumentId, quoteCurrency, onSubmit, pending }: { instrumentId: string; quoteCurrency: string; onSubmit: (payload: Record<string, unknown>) => void; pending: boolean }) {
  const [draft, setDraft] = useState(empty); const [errors, setErrors] = useState<string[]>([]); const [confirm, setConfirm] = useState(false);
  const update = (key: keyof OrderDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const review = () => { const next = validateOrderDraft(draft); setErrors(next); if (!next.length) setConfirm(true); };
  const submit = () => { const payload: Record<string, unknown> = { instrument_id: instrumentId, side: draft.side, order_type: draft.order_type, quantity: draft.quantity, time_in_force: draft.time_in_force }; if (draft.limit_price) payload.limit_price = draft.limit_price; if (draft.stop_price) payload.stop_price = draft.stop_price; if (draft.stop_loss) payload.stop_loss = draft.stop_loss; if (draft.take_profit) payload.take_profit = draft.take_profit; onSubmit(payload); setConfirm(false); };
  return <section className="ticket" aria-label="Order ticket">
    <div className="segmented"><button className={draft.side === "buy" ? "active buy" : ""} onClick={() => update("side", "buy")}>Buy</button><button className={draft.side === "sell" ? "active sell" : ""} onClick={() => update("side", "sell")}>Sell</button></div>
    <label>Order type<select aria-label="Order type" value={draft.order_type} onChange={(event) => update("order_type", event.target.value)}><option value="market">Market</option><option value="limit">Limit</option><option value="stop_market">Stop market</option><option value="stop_limit">Stop limit</option></select></label>
    <div className="field-pair"><label>Quantity<input aria-label="Quantity" inputMode="decimal" value={draft.quantity} onChange={(event) => update("quantity", event.target.value)} /></label><label>TIF<select value={draft.time_in_force} onChange={(event) => update("time_in_force", event.target.value)}><option>DAY</option><option>GTC</option></select></label></div>
    {(draft.order_type === "limit" || draft.order_type === "stop_limit") && <label>Limit price <span>{quoteCurrency}</span><input aria-label="Limit price" inputMode="decimal" value={draft.limit_price} onChange={(event) => update("limit_price", event.target.value)} /></label>}
    {(draft.order_type === "stop_market" || draft.order_type === "stop_limit") && <label>Stop price <span>{quoteCurrency}</span><input aria-label="Stop price" inputMode="decimal" value={draft.stop_price} onChange={(event) => update("stop_price", event.target.value)} /></label>}
    <details><summary>Bracket protection</summary><div className="field-pair"><label>Stop loss<input inputMode="decimal" value={draft.stop_loss} onChange={(event) => update("stop_loss", event.target.value)} /></label><label>Take profit<input inputMode="decimal" value={draft.take_profit} onChange={(event) => update("take_profit", event.target.value)} /></label></div></details>
    {errors.length ? <div className="form-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
    <button className="primary full" onClick={review} disabled={pending}>Review {draft.side} order</button>
    {confirm ? <div className="confirm" role="dialog" aria-label="Confirm order"><strong>Confirm {draft.side} {draft.quantity} {instrumentId}</strong><p>{draft.order_type.replace("_", " ")} · {draft.time_in_force}{draft.limit_price ? ` · ${draft.limit_price} ${quoteCurrency}` : ""}</p><div><button onClick={() => setConfirm(false)}>Back</button><button className="primary" disabled={pending} onClick={submit}>{pending ? "Submitting…" : `Place ${draft.side} order`}</button></div></div> : null}
  </section>;
}
