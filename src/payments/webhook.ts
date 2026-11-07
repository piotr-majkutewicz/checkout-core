import type { Order, OrderEvent } from "../order.js";
import { applyEvent, canTransition } from "../order.js";
import type { PaymentEvent, PaymentEventType, PaymentProvider } from "./types.js";

/**
 * Storage the webhook handler needs. `update` must be an atomic read-modify-write:
 * the in-memory store does it synchronously, a D1 or SQL store would use a transaction
 * or an optimistic version column. If `fn` returns undefined nothing is written.
 */
export interface OrderStore {
  get(id: string): Promise<Order | undefined>;
  save(order: Order): Promise<void>;
  update<T>(id: string, fn: (order: Order) => { order: Order; result: T }): Promise<T | undefined>;
}

export interface InMemoryOrderStoreOptions {
  /** Keep at most this many orders; when a new order id is saved, the oldest one is dropped. Default: unbounded. */
  maxOrders?: number;
}

export class InMemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, Order>();
  private readonly maxOrders: number;

  constructor(options: InMemoryOrderStoreOptions = {}) {
    const max = options.maxOrders ?? Infinity;
    if (!(max >= 1)) throw new RangeError("maxOrders must be at least 1");
    this.maxOrders = max;
  }

  async get(id: string): Promise<Order | undefined> {
    return this.orders.get(id);
  }

  async save(order: Order): Promise<void> {
    this.orders.set(order.id, order);
    // Map iterates in insertion order, so the first key is the oldest order.
    while (this.orders.size > this.maxOrders) {
      const oldest = this.orders.keys().next().value as string;
      this.orders.delete(oldest);
    }
  }

  async update<T>(id: string, fn: (order: Order) => { order: Order; result: T }): Promise<T | undefined> {
    const current = this.orders.get(id);
    if (!current) return undefined;
    // No await between read and write: atomic within a single JavaScript thread.
    const { order, result } = fn(current);
    this.orders.set(id, order);
    return result;
  }
}

export type WebhookOutcome =
  | { status: "applied"; order: Order }
  | { status: "duplicate"; order: Order }
  | { status: "ignored"; reason: IgnoreReason; order: Order }
  | { status: "unknown_order" };

export type IgnoreReason =
  | "stale_sequence"
  | "payment_mismatch"
  | "amount_mismatch"
  | "transition_not_allowed";

const EVENT_MAP: Record<PaymentEventType, OrderEvent> = {
  "payment.succeeded": "payment_succeeded",
  "payment.failed": "payment_failed",
  "payment.refunded": "refund_completed",
};

/**
 * Applies one verified payment event to an order. Guarantees:
 *  - idempotent: the same event id twice produces one effect;
 *  - order-safe: events with a lower sequence than one already applied are dropped,
 *    and events that make no sense in the current state are recorded, not applied;
 *  - never throws for "weird but authentic" events, so the provider gets a 2xx and stops retrying.
 */
export function applyPaymentEvent(order: Order, event: PaymentEvent, at: string): { order: Order; result: WebhookOutcome } {
  if (order.processedEventIds.includes(event.id)) {
    return { order, result: { status: "duplicate", order } };
  }
  const withId: Order = { ...order, processedEventIds: [...order.processedEventIds, event.id] };

  const ignore = (reason: IgnoreReason) => {
    const flagged: Order = {
      ...withId,
      anomalies: [...withId.anomalies, `${event.type} ignored: ${reason} (event ${event.id})`],
    };
    return { order: flagged, result: { status: "ignored", reason, order: flagged } as WebhookOutcome };
  };

  if (order.paymentId !== undefined && event.paymentId !== order.paymentId) return ignore("payment_mismatch");
  if (event.sequence < order.lastPaymentSequence) return ignore("stale_sequence");
  if (event.type === "payment.succeeded" && event.amount !== order.totals.totalGross) {
    return ignore("amount_mismatch");
  }

  const orderEvent = EVENT_MAP[event.type];
  if (!canTransition(withId.state, orderEvent)) return ignore("transition_not_allowed");

  const next = applyEvent({ ...withId, lastPaymentSequence: event.sequence }, orderEvent, at);
  return { order: next, result: { status: "applied", order: next } };
}

/**
 * Full webhook pipeline: verify signature (throws WebhookError) -> load order ->
 * apply atomically. Pass the RAW request body, not a re-serialised object.
 */
export async function handleWebhook(
  provider: PaymentProvider,
  store: OrderStore,
  rawBody: string,
  headers: Record<string, string>,
  now: () => Date = () => new Date(),
): Promise<WebhookOutcome> {
  const event = await provider.verifyWebhook(rawBody, headers);
  const outcome = await store.update(event.orderId, (order) =>
    applyPaymentEvent(order, event, now().toISOString()),
  );
  return outcome ?? { status: "unknown_order" };
}
