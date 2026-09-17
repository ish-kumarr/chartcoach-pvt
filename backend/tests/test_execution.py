from decimal import Decimal

from app.domain.execution import OrderCommand, OrderType, Policy, Quote, Side, decide_fill


def quote() -> Quote:
    return Quote(Decimal("99.90"), Decimal("100.10"), Decimal("100"), 1)


def test_limit_buy_waits_until_ask_reaches_limit():
    command = OrderCommand(Side.BUY, OrderType.LIMIT, Decimal("2"), limit_price=Decimal("100"))
    assert decide_fill(command, quote(), Policy()) is None
    assert decide_fill(command, Quote(Decimal("99.80"), Decimal("99.95"), Decimal("99.90"), 2), Policy()).price == Decimal("99.95")


def test_market_fill_applies_directional_slippage_and_fee():
    command = OrderCommand(Side.BUY, OrderType.MARKET, Decimal("10"))
    fill = decide_fill(command, quote(), Policy())
    assert fill is not None
    assert fill.price == Decimal("100.12")
    assert fill.fee == Decimal("0.50")


def test_stop_market_does_not_fill_before_trigger():
    command = OrderCommand(Side.SELL, OrderType.STOP_MARKET, Decimal("1"), stop_price=Decimal("99"))
    assert decide_fill(command, quote(), Policy()) is None
    assert decide_fill(command, Quote(Decimal("98.80"), Decimal("99"), Decimal("98.90"), 2), Policy()) is not None
