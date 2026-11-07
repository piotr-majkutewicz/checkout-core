import type { CartTotals } from "./cart.js";

export const ORDER_STATES = [
  "created",
  "awaiting_payment",
  "paid",
  "shipped",
  "fulfilled",
  "cancelled",
  "payment_failed",
  "refund_requested",
  "refunded",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const ORDER_EVENTS = [
  "payment_started",
  "payment_succeeded",
  "payment_failed",
  "cancel",
  "ship",
  "deliver",
  "request_refund",
  "refund_completed",
] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

/**
 * The complete list of allowed transitions. Anything not listed here is forbidden.
 *
 *   created ──payment_started──▶ awaiting_payment ──payment_succeeded──▶ paid ──ship──▶ shipped ──deliver──▶ fulfilled
 *   awaiting_payment ──payment_failed──▶ payment_failed ──payment_started──▶ awaiting_payment (retry)
 *   payment_failed ──payment_succeeded──▶ paid   (a late success after a reported failure is real, e.g. a slow BLIK confirmation)
 *   created | awaiting_payment | payment_failed ──cancel──▶ cancelled
 *   paid | shipped | fulfilled ──request_refund──▶ refund_requested ──refund_completed──▶ refunded
 *
 * Deliberate choices: a paid order cannot be "cancelled" directly, it has to go through a
 * refund, so money never silently disappears. `cancelled` and `refunded` are terminal.
 */
const TRANSITIONS: Record<OrderState, Partial<Record<OrderEvent, OrderState>>> = {
  created: { payment_started: "awaiting_payment", cancel: "cancelled" },
  awaiting_payment: { payment_succeeded: "paid", payment_failed: "payment_failed", cancel: "cancelled" },
  payment_failed: { payment_started: "awaiting_payment", payment_succeeded: "paid", cancel: "cancelled" },
  paid: { ship: "shipped", request_refund: "refund_requested" },
  shipped: { deliver: "fulfilled", request_refund: "refund_requested" },
  fulfilled: { request_refund: "refund_requested" },
  refund_requested: { refund_completed: "refunded" },
  cancelled: {},
  refunded: {},
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: OrderState,
    readonly event: OrderEvent,
  ) {
    super(`Transition not allowed: ${from} --${event}--> ?`);
    this.name = "InvalidTransitionError";
  }
}

export function nextState(state: OrderState, event: OrderEvent): OrderState | undefined {
  return TRANSITIONS[state][event];
}

export function canTransition(state: OrderState, event: OrderEvent): boolean {
  return nextState(state, event) !== undefined;
}

export function allowedEvents(state: OrderState): OrderEvent[] {
  return Object.keys(TRANSITIONS[state]) as OrderEvent[];
}

export interface HistoryEntry {
  from: OrderState;
  to: OrderState;
  event: OrderEvent;
  at: string;
}

export interface Order {
  id: string;
  state: OrderState;
  totals: CartTotals;
  createdAt: string;
  paymentId?: string;
  paymentMethod?: string;
  lockerCode?: string;
  trackingNumber?: string;
  deliveredAt?: string;
  /** Highest payment event sequence number applied so far (guards against stale events). */
  lastPaymentSequence: number;
  /** Webhook event ids already handled. Kept on the order so idempotency is part of the same atomic write. */
  processedEventIds: string[];
  /** Things a human should look at, e.g. a payment that arrived for a cancelled order. */
  anomalies: string[];
  history: HistoryEntry[];
}

export function createOrder(id: string, totals: CartTotals, at: string): Order {
  return {
    id,
    state: "created",
    totals,
    createdAt: at,
    lastPaymentSequence: 0,
    processedEventIds: [],
    anomalies: [],
    history: [],
  };
}

/** Pure transition: returns a new order or throws InvalidTransitionError. */
export function applyEvent(order: Order, event: OrderEvent, at: string): Order {
  const to = nextState(order.state, event);
  if (to === undefined) throw new InvalidTransitionError(order.state, event);
  return {
    ...order,
    state: to,
    history: [...order.history, { from: order.state, to, event, at }],
  };
}
