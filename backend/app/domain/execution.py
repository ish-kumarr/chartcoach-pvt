"""Deterministic, Decimal-based execution primitives.

This module has no database or web framework dependency. Persistence adapters
can apply its decisions atomically inside a MongoDB transaction.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from enum import StrEnum


class Side(StrEnum):
    BUY = "buy"
    SELL = "sell"


class OrderType(StrEnum):
    MARKET = "market"
    LIMIT = "limit"
    STOP_MARKET = "stop_market"
    STOP_LIMIT = "stop_limit"


class OrderState(StrEnum):
    OPEN = "open"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


@dataclass(frozen=True)
class Quote:
    bid: Decimal
    ask: Decimal
    last: Decimal
    timestamp: int


@dataclass(frozen=True)
class Policy:
    fee_bps: Decimal = Decimal("5")
    spread_bps: Decimal = Decimal("5")
    slippage_bps: Decimal = Decimal("2")
    initial_margin_ratio: Decimal = Decimal("1")
    maintenance_margin_ratio: Decimal = Decimal(".75")
    shorting_enabled: bool = False


@dataclass(frozen=True)
class OrderCommand:
    side: Side
    order_type: OrderType
    quantity: Decimal
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    reduce_only: bool = False


@dataclass(frozen=True)
class FillDecision:
    price: Decimal
    quantity: Decimal
    fee: Decimal


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal(".01"), rounding=ROUND_HALF_UP)


def execution_price(command: OrderCommand, quote: Quote, policy: Policy) -> Decimal | None:
    """Return a fill price, or None when a resting order is not eligible."""
    reference = quote.ask if command.side is Side.BUY else quote.bid
    slip = Decimal("1") + policy.slippage_bps / Decimal("10000")
    if command.side is Side.SELL:
        slip = Decimal("1") - policy.slippage_bps / Decimal("10000")
    if command.order_type is OrderType.MARKET:
        return reference * slip
    stop_hit = command.stop_price is None or (
        quote.ask >= command.stop_price if command.side is Side.BUY else quote.bid <= command.stop_price
    )
    limit_hit = command.limit_price is not None and (
        quote.ask <= command.limit_price if command.side is Side.BUY else quote.bid >= command.limit_price
    )
    if command.order_type is OrderType.LIMIT:
        return reference if limit_hit else None
    if command.order_type is OrderType.STOP_MARKET:
        return reference * slip if stop_hit else None
    return reference * slip if stop_hit and limit_hit else None


def decide_fill(command: OrderCommand, quote: Quote, policy: Policy) -> FillDecision | None:
    price = execution_price(command, quote, policy)
    if price is None:
        return None
    notional = price * command.quantity
    return FillDecision(price=money(price), quantity=command.quantity, fee=money(notional * policy.fee_bps / Decimal("10000")))
