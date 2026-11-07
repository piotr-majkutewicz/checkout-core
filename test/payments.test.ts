import { describe, expect, it } from "vitest";
import { priceCart } from "../src/cart.js";
import { hmacSha256Hex, timingSafeEqual } from "../src/crypto.js";
import { createOrder, applyEvent, type Order } from "../src/order.js";
import { MockProvider, SIGNATURE_HEADER } from "../src/payments/mock.js";
import { WebhookError, type PaymentEvent } from "../src/payments/types.js";
import { InMemoryOrderStore, handleWebhook } from "../src/payments/webhook.js";

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const totals = priceCart([{ sku: "A", name: "A", unitGross: 5000, quantity: 1, vatRate: 23 }]);

function setup() {
  const provider = new MockProvider({ secret: "test-secret", now: () => NOW });
  const store = new InMemoryOrderStore();
  return { provider, store };
}

async function awaitingOrder(store: InMemoryOrderStore, provider: MockProvider, opts: { method?: "blik" | "card" | "transfer"; blikCode?: string; scenario?: string } = {}) {
  const base = createOrder("ord_1", totals, "t");
  const payment = await provider.createPayment({
    orderId: "ord_1",
    amount: totals.totalGross,
    method: opts.method ?? "card",
    blikCode: opts.blikCode,
    metadata: opts.scenario ? { scenario: opts.scenario } : undefined,
  });
  const order: Order = { ...applyEvent(base, "payment_started", "t"), paymentId: payment.paymentId };
  await store.save(order);
  return payment;
}

async function deliverAll(provider: MockProvider, store: InMemoryOrderStore) {
  const out = [];
  for (const d of await provider.takeDeliveries()) out.push(await handleWebhook(provider, store, d.body, d.headers));
  return out;
}

describe("crypto", () => {
  it("matches the RFC 4231 HMAC-SHA256 test vector (case 2)", async () => {
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
  it("compares strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("MockProvider", () => {
  it("validates input", async () => {
    const { provider } = setup();
    await expect(provider.createPayment({ orderId: "o", amount: 0, method: "card" })).rejects.toThrow();
    await expect(provider.createPayment({ orderId: "o", amount: 1.5, method: "card" })).rejects.toThrow();
    await expect(provider.createPayment({ orderId: "o", amount: 100, method: "blik", blikCode: "12ab56" })).rejects.toThrow();
    await expect(provider.createPayment({ orderId: "o", amount: 100, method: "cash" as never })).rejects.toThrow();
  });

  it("BLIK succeeds immediately and asks for confirmation in the banking app", async () => {
    const { provider } = setup();
    const p = await provider.createPayment({ orderId: "o", amount: 100, method: "blik", blikCode: "123456" });
    expect(p.status).toBe("succeeded");
    expect(p.nextAction).toEqual({ type: "confirm_in_banking_app" });
  });

  it("card returns a redirect, transfer is delayed by default", async () => {
    const { provider } = setup();
    const card = await provider.createPayment({ orderId: "o", amount: 100, method: "card" });
    expect(card.nextAction?.type).toBe("redirect");
    const tr = await provider.createPayment({ orderId: "o", amount: 100, method: "transfer" });
    expect(tr.status).toBe("pending");
  });

  it("BLIK magic codes pick declined and delayed", async () => {
    const { provider } = setup();
    const declined = await provider.createPayment({ orderId: "o", amount: 100, method: "blik", blikCode: "222222" });
    expect(declined.status).toBe("failed");
    const delayed = await provider.createPayment({ orderId: "o", amount: 100, method: "blik", blikCode: "333333" });
    expect(delayed.status).toBe("pending");
    expect(await provider.getStatus(delayed.paymentId)).toBe("pending");
    provider.settle(delayed.paymentId);
    expect(await provider.getStatus(delayed.paymentId)).toBe("succeeded");
    expect(() => provider.settle(delayed.paymentId)).toThrow();
  });

  it("refunds fully and partially and refuses over-refunds", async () => {
    const { provider } = setup();
    const p = await provider.createPayment({ orderId: "o", amount: 1000, method: "card" });
    await expect(provider.refund(p.paymentId, 1001)).rejects.toThrow();
    await provider.refund(p.paymentId, 400);
    expect(await provider.getStatus(p.paymentId)).toBe("succeeded");
    await expect(provider.refund(p.paymentId, 601)).rejects.toThrow();
    await provider.refund(p.paymentId);
    expect(await provider.getStatus(p.paymentId)).toBe("refunded");
  });

  it("cannot refund a payment that did not succeed", async () => {
    const { provider } = setup();
    const p = await provider.createPayment({ orderId: "o", amount: 1000, method: "transfer" });
    await expect(provider.refund(p.paymentId)).rejects.toThrow();
  });
});

describe("webhook signature verification", () => {
  const event: PaymentEvent = {
    id: "e1", type: "payment.succeeded", paymentId: "p", orderId: "ord_1",
    amount: 5000, sequence: 1, occurredAt: "2026-11-07T12:00:00.000Z",
  };

  it("accepts a correctly signed event", async () => {
    const { provider } = setup();
    const d = await provider.sign(event);
    expect(await provider.verifyWebhook(d.body, d.headers)).toEqual(event);
  });

  it("rejects a tampered body", async () => {
    const { provider } = setup();
    const d = await provider.sign(event);
    const tampered = d.body.replace("5000", "1");
    await expect(provider.verifyWebhook(tampered, d.headers)).rejects.toMatchObject({ code: "bad_signature" });
  });

  it("rejects a wrong secret and missing headers", async () => {
    const { provider } = setup();
    const other = new MockProvider({ secret: "other", now: () => NOW });
    const d = await other.sign(event);
    await expect(provider.verifyWebhook(d.body, d.headers)).rejects.toBeInstanceOf(WebhookError);
    await expect(provider.verifyWebhook(d.body, {})).rejects.toMatchObject({ code: "bad_signature" });
    await expect(provider.verifyWebhook(d.body, { [SIGNATURE_HEADER]: "sha256=00" })).rejects.toBeInstanceOf(WebhookError);
  });

  it("rejects old timestamps (replay) but accepts within tolerance", async () => {
    const { provider } = setup();
    const old = await provider.sign(event, NOW - 10 * 60 * 1000);
    await expect(provider.verifyWebhook(old.body, old.headers)).rejects.toMatchObject({ code: "bad_timestamp" });
    const ok = await provider.sign(event, NOW - 4 * 60 * 1000);
    await expect(provider.verifyWebhook(ok.body, ok.headers)).resolves.toBeTruthy();
  });

  it("rejects a validly signed but malformed payload", async () => {
    const { provider } = setup();
    const bad = await provider.sign({ ...event, amount: 1.5 });
    await expect(provider.verifyWebhook(bad.body, bad.headers)).rejects.toMatchObject({ code: "bad_payload" });
  });

  it("is case-insensitive about header names", async () => {
    const { provider } = setup();
    const d = await provider.sign(event);
    const upper = Object.fromEntries(Object.entries(d.headers).map(([k, v]) => [k.toUpperCase(), v]));
    await expect(provider.verifyWebhook(d.body, upper)).resolves.toBeTruthy();
  });
});

describe("webhook handling", () => {
  it("moves the order to paid on a success event", async () => {
    const { provider, store } = setup();
    await awaitingOrder(store, provider);
    const [outcome] = await deliverAll(provider, store);
    expect(outcome?.status).toBe("applied");
    expect((await store.get("ord_1"))?.state).toBe("paid");
  });

  it("is idempotent: the same event twice has one effect", async () => {
    const { provider, store } = setup();
    await awaitingOrder(store, provider);
    const [d] = await provider.takeDeliveries();
    const first = await handleWebhook(provider, store, d!.body, d!.headers);
    const afterFirst = await store.get("ord_1");
    const second = await handleWebhook(provider, store, d!.body, d!.headers);
    const third = await handleWebhook(provider, store, d!.body, d!.headers);
    expect(first.status).toBe("applied");
    expect(second.status).toBe("duplicate");
    expect(third.status).toBe("duplicate");
    expect(await store.get("ord_1")).toEqual(afterFirst);
    expect((await store.get("ord_1"))?.history).toHaveLength(2);
  });

  it("handles concurrent deliveries of the same event as one effect", async () => {
    const { provider, store } = setup();
    await awaitingOrder(store, provider);
    const [d] = await provider.takeDeliveries();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => handleWebhook(provider, store, d!.body, d!.headers)));
    expect(results.filter((r) => r.status === "applied")).toHaveLength(1);
    expect(results.filter((r) => r.status === "duplicate")).toHaveLength(4);
  });

  it("rejects a bad signature without touching the order", async () => {
    const { provider, store } = setup();
    await awaitingOrder(store, provider);
    const [d] = await provider.takeDeliveries();
    const before = await store.get("ord_1");
    await expect(handleWebhook(provider, store, d!.body + " ", d!.headers)).rejects.toBeInstanceOf(WebhookError);
    expect(await store.get("ord_1")).toEqual(before);
  });

  it("a failure arriving after success does not undo the payment (out of order)", async () => {
    const { provider, store } = setup();
    const p = await awaitingOrder(store, provider, { scenario: "delayed" });
    // Craft: failed (seq 1) delivered after succeeded (seq 2)
    const failed = await provider.sign({ id: "f1", type: "payment.failed", paymentId: p.paymentId, orderId: "ord_1", amount: 5000, sequence: 1, occurredAt: "x" });
    const success = await provider.sign({ id: "s1", type: "payment.succeeded", paymentId: p.paymentId, orderId: "ord_1", amount: 5000, sequence: 2, occurredAt: "x" });
    expect((await handleWebhook(provider, store, success.body, success.headers)).status).toBe("applied");
    const late = await handleWebhook(provider, store, failed.body, failed.headers);
    expect(late).toMatchObject({ status: "ignored", reason: "stale_sequence" });
    expect((await store.get("ord_1"))?.state).toBe("paid");
  });

  it("a late success after a reported failure still marks the order paid", async () => {
    const { provider, store } = setup();
    const p = await awaitingOrder(store, provider, { scenario: "delayed" });
    const failed = await provider.sign({ id: "f1", type: "payment.failed", paymentId: p.paymentId, orderId: "ord_1", amount: 5000, sequence: 1, occurredAt: "x" });
    const success = await provider.sign({ id: "s1", type: "payment.succeeded", paymentId: p.paymentId, orderId: "ord_1", amount: 5000, sequence: 2, occurredAt: "x" });
    await handleWebhook(provider, store, failed.body, failed.headers);
    expect((await store.get("ord_1"))?.state).toBe("payment_failed");
    await handleWebhook(provider, store, success.body, success.headers);
    expect((await store.get("ord_1"))?.state).toBe("paid");
  });

  it("flags a payment that arrives for a cancelled order", async () => {
    const { provider, store } = setup();
    const p = await awaitingOrder(store, provider, { scenario: "delayed" });
    await store.update("ord_1", (o) => ({ order: applyEvent(o, "cancel", "t"), result: null }));
    provider.settle(p.paymentId);
    const [outcome] = await deliverAll(provider, store);
    expect(outcome).toMatchObject({ status: "ignored", reason: "transition_not_allowed" });
    const order = await store.get("ord_1");
    expect(order?.state).toBe("cancelled");
    expect(order?.anomalies).toHaveLength(1);
  });

  it("ignores events for another payment id and wrong amounts", async () => {
    const { provider, store } = setup();
    const p = await awaitingOrder(store, provider, { scenario: "delayed" });
    const other = await provider.sign({ id: "x1", type: "payment.succeeded", paymentId: "someone_else", orderId: "ord_1", amount: 5000, sequence: 1, occurredAt: "x" });
    expect(await handleWebhook(provider, store, other.body, other.headers)).toMatchObject({ reason: "payment_mismatch" });
    const cheap = await provider.sign({ id: "x2", type: "payment.succeeded", paymentId: p.paymentId, orderId: "ord_1", amount: 100, sequence: 1, occurredAt: "x" });
    expect(await handleWebhook(provider, store, cheap.body, cheap.headers)).toMatchObject({ reason: "amount_mismatch" });
    expect((await store.get("ord_1"))?.state).toBe("awaiting_payment");
  });

  it("reports unknown orders", async () => {
    const { provider, store } = setup();
    const d = await provider.sign({ id: "x", type: "payment.failed", paymentId: "p", orderId: "nope", amount: 1, sequence: 1, occurredAt: "x" });
    expect(await handleWebhook(provider, store, d.body, d.headers)).toEqual({ status: "unknown_order" });
  });

  it("declined BLIK leads to payment_failed, and a retry can then succeed", async () => {
    const { provider, store } = setup();
    await awaitingOrder(store, provider, { method: "blik", blikCode: "222222" });
    await deliverAll(provider, store);
    expect((await store.get("ord_1"))?.state).toBe("payment_failed");
    const retry = await provider.createPayment({ orderId: "ord_1", amount: totals.totalGross, method: "blik", blikCode: "111111" });
    await store.update("ord_1", (o) => ({ order: { ...applyEvent(o, "payment_started", "t"), paymentId: retry.paymentId, lastPaymentSequence: 0 }, result: null }));
    await deliverAll(provider, store);
    expect((await store.get("ord_1"))?.state).toBe("paid");
  });

  it("refund flow: paid -> refund_requested -> refunded via webhook", async () => {
    const { provider, store } = setup();
    const p = await awaitingOrder(store, provider);
    await deliverAll(provider, store);
    await store.update("ord_1", (o) => ({ order: applyEvent(o, "request_refund", "t"), result: null }));
    await provider.refund(p.paymentId);
    await deliverAll(provider, store);
    expect((await store.get("ord_1"))?.state).toBe("refunded");
  });
});
