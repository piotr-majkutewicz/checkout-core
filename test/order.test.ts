import { describe, expect, it } from "vitest";
import { priceCart } from "../src/cart.js";
import {
  InvalidTransitionError,
  ORDER_EVENTS,
  ORDER_STATES,
  allowedEvents,
  applyEvent,
  canTransition,
  createOrder,
  nextState,
  type OrderEvent,
  type OrderState,
} from "../src/order.js";

const ALLOWED: Array<[OrderState, OrderEvent, OrderState]> = [
  ["created", "payment_started", "awaiting_payment"],
  ["created", "cancel", "cancelled"],
  ["awaiting_payment", "payment_succeeded", "paid"],
  ["awaiting_payment", "payment_failed", "payment_failed"],
  ["awaiting_payment", "cancel", "cancelled"],
  ["payment_failed", "payment_started", "awaiting_payment"],
  ["payment_failed", "payment_succeeded", "paid"],
  ["payment_failed", "cancel", "cancelled"],
  ["paid", "ship", "shipped"],
  ["paid", "request_refund", "refund_requested"],
  ["shipped", "deliver", "fulfilled"],
  ["shipped", "request_refund", "refund_requested"],
  ["fulfilled", "request_refund", "refund_requested"],
  ["refund_requested", "refund_completed", "refunded"],
];

const totals = priceCart([{ sku: "A", name: "A", unitGross: 1000, quantity: 1, vatRate: 23 }]);

describe("order state machine", () => {
  it("allows exactly the listed transitions", () => {
    for (const [from, event, to] of ALLOWED) {
      expect(nextState(from, event), `${from} --${event}-->`).toBe(to);
      expect(canTransition(from, event)).toBe(true);
    }
  });

  it("rejects every transition that is not listed", () => {
    const allowed = new Set(ALLOWED.map(([f, e]) => `${f}|${e}`));
    let checked = 0;
    for (const state of ORDER_STATES) {
      for (const event of ORDER_EVENTS) {
        if (allowed.has(`${state}|${event}`)) continue;
        checked++;
        expect(canTransition(state, event), `${state} --${event}-->`).toBe(false);
        const order = { ...createOrder("o1", totals, "t"), state };
        expect(() => applyEvent(order, event, "t")).toThrow(InvalidTransitionError);
      }
    }
    expect(checked).toBe(ORDER_STATES.length * ORDER_EVENTS.length - ALLOWED.length);
  });

  it("treats cancelled and refunded as terminal", () => {
    expect(allowedEvents("cancelled")).toEqual([]);
    expect(allowedEvents("refunded")).toEqual([]);
  });

  it("does not allow cancelling a paid order directly", () => {
    expect(canTransition("paid", "cancel")).toBe(false);
  });

  it("records history and does not mutate the input", () => {
    const o1 = createOrder("o1", totals, "t0");
    const o2 = applyEvent(o1, "payment_started", "t1");
    expect(o1.state).toBe("created");
    expect(o1.history).toEqual([]);
    expect(o2.history).toEqual([{ from: "created", to: "awaiting_payment", event: "payment_started", at: "t1" }]);
  });

  it("walks the happy path", () => {
    let o = createOrder("o1", totals, "t");
    for (const e of ["payment_started", "payment_succeeded", "ship", "deliver"] as const) o = applyEvent(o, e, "t");
    expect(o.state).toBe("fulfilled");
  });
});
