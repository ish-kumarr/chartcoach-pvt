import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrderTicket } from "./OrderTicket";

describe("OrderTicket", () => {
  it("blocks an invalid limit order and submits the confirmed valid draft", async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    render(<OrderTicket instrumentId="NASDAQ:AAPL" quoteCurrency="USD" onSubmit={submit} pending={false} />);
    await user.selectOptions(screen.getByLabelText("Order type"), "limit");
    await user.click(screen.getByRole("button", { name: "Review buy order" }));
    expect(screen.getByText("Quantity must be greater than zero.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Quantity"), "2");
    await user.type(screen.getByLabelText("Limit price"), "100");
    await user.click(screen.getByRole("button", { name: "Review buy order" }));
    expect(screen.getByRole("dialog", { name: "Confirm order" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Place buy order" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: "2", limit_price: "100", order_type: "limit" }));
  });
});
