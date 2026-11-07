import { describe, expect, it } from "vitest";
import { createApp } from "../src/demo/app.js";
import { LUHN_SOURCE, TEST_CARDS } from "../src/demo/cards.js";

const NOW = new Date("2026-11-07T12:00:00Z");
const base = { items: [{ sku: "MUG-01", quantity: 2 }], lockerCode: "WAW123M" };

function setup() {
  const app = createApp({}, () => NOW);
  let n = 0;
  const call = async (path: string, method = "GET", body?: unknown) => {
    const res = await app(new Request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "cf-connecting-ip": `10.1.0.${++n % 250}` } }));
    return { status: res.status, data: (await res.json()) as any };
  };
  return call;
}
const kinds = (r: { data: any }) => (r.data.trace as Array<{ kind: string }>).map((e) => e.kind);

describe("simulated payment flows", () => {
  it("BLIK: 111111 is declined, 222222 stays pending with a blik_app flow, others succeed", async () => {
    const call = setup();
    expect((await call("/api/orders", "POST", { ...base, method: "blik", blikCode: "111111" })).data.order.state).toBe("payment_failed");
    const delayed = await call("/api/orders", "POST", { ...base, method: "blik", blikCode: "222222" });
    expect(delayed.data.order.state).toBe("awaiting_payment");
    expect(delayed.data.flow).toBe("blik_app");
    expect(delayed.data.paymentStatus).toBe("pending");
    const settled = await call(`/api/orders/${delayed.data.order.id}/settle`, "POST", { outcome: "succeeded" });
    expect(settled.data.order.state).toBe("paid");
    expect((await call("/api/orders", "POST", { ...base, method: "blik", blikCode: "123456" })).data.order.state).toBe("paid");
  });

  it("card: success, declined and 3-D Secure (approve or reject)", async () => {
    const call = setup();
    expect((await call("/api/orders", "POST", { ...base, method: "card", cardScenario: "success" })).data.order.state).toBe("paid");
    expect((await call("/api/orders", "POST", { ...base, method: "card", cardScenario: "declined" })).data.order.state).toBe("payment_failed");
    const a = await call("/api/orders", "POST", { ...base, method: "card", cardScenario: "three_ds" });
    expect([a.data.order.state, a.data.flow]).toEqual(["awaiting_payment", "three_ds"]);
    expect((await call(`/api/orders/${a.data.order.id}/settle`, "POST", { outcome: "succeeded" })).data.order.state).toBe("paid");
    const b = await call("/api/orders", "POST", { ...base, method: "card", cardScenario: "three_ds" });
    expect((await call(`/api/orders/${b.data.order.id}/settle`, "POST", { outcome: "failed" })).data.order.state).toBe("payment_failed");
    expect((await call("/api/orders", "POST", { ...base, method: "card" })).data.code).toBe("bad_card_scenario");
  });

  it("transfer waits for the bank, then settles", async () => {
    const call = setup();
    const r = await call("/api/orders", "POST", { ...base, method: "transfer" });
    expect([r.data.order.state, r.data.flow]).toEqual(["awaiting_payment", "bank"]);
    expect((await call(`/api/orders/${r.data.order.id}/settle`, "POST")).data.order.state).toBe("paid");
    expect((await call(`/api/orders/${r.data.order.id}/settle`, "POST")).data.code).toBe("cannot_settle");
    expect((await call(`/api/orders/${r.data.order.id}/settle`, "POST", { outcome: "maybe" })).data.code).toBe("bad_outcome");
  });
});

describe("behind the scenes trace", () => {
  it("describes the whole chain with timestamps in order", async () => {
    const call = setup();
    const r = await call("/api/orders", "POST", { ...base, method: "card", cardScenario: "success" });
    expect(kinds(r)).toEqual(["cart_priced", "order_created", "order_transition", "payment_requested", "webhook_sent", "signature_ok", "order_transition"]);
    const sent = r.data.trace.find((e: any) => e.kind === "webhook_sent");
    expect(sent.data.headers["x-mock-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(r.data.trace.every((e: any) => e.at === NOW.toISOString())).toBe(true);
    const ship = await call(`/api/orders/${r.data.order.id}/ship`, "POST");
    expect(kinds(ship)).toEqual(["shipment_created", "order_transition"]);
    expect(ship.data.shipment.trackingNumber).toMatch(/^MOCK/);
  });

  it("quote adds a cart_priced entry", async () => {
    const call = setup();
    const r = await call("/api/quote", "POST", { items: [{ sku: "MUG-01", quantity: 1 }] });
    expect(kinds(r)).toEqual(["cart_priced"]);
  });
});

describe("reliability demonstrations", () => {
  async function paid() {
    const call = setup();
    const r = await call("/api/orders", "POST", { ...base, method: "card", cardScenario: "success" });
    return { call, id: r.data.order.id as string, history: r.data.order.history.length as number };
  }

  it("the same notification again is a duplicate and changes nothing", async () => {
    const { call, id, history } = await paid();
    const r = await call(`/api/orders/${id}/redeliver`, "POST");
    expect(r.data.outcome).toBe("duplicate");
    expect(r.data.order.history).toHaveLength(history);
    expect(kinds(r)).toContain("webhook_duplicate");
  });

  it("a tampered notification is rejected with 401 and changes nothing", async () => {
    const { call, id, history } = await paid();
    const r = await call(`/api/orders/${id}/forge`, "POST");
    expect(r.data.outcome).toBe("rejected");
    expect(r.data.order.state).toBe("paid");
    expect(r.data.order.history).toHaveLength(history);
    const rejected = r.data.trace.find((e: any) => e.kind === "webhook_rejected");
    expect(rejected.data).toEqual({ status: 401, code: "bad_signature" });
  });

  it("a late out-of-order notification is ignored and the state stays intact", async () => {
    const { call, id, history } = await paid();
    const r = await call(`/api/orders/${id}/late`, "POST");
    expect(r.data.outcome).toBe("ignored");
    expect(r.data.order.state).toBe("paid");
    expect(r.data.order.history).toHaveLength(history);
    expect(r.data.order.anomalies).toHaveLength(1);
    expect(kinds(r)).toContain("webhook_ignored");
  });

  it("cannot demonstrate on an order that has had no payment notification", async () => {
    const call = setup();
    expect((await call("/api/orders/ord_none/late", "POST")).status).toBe(404);
    expect((await call("/api/orders/ord_none/forge", "POST")).status).toBe(404);
  });
});

describe("test cards", () => {
  const luhnValid = new Function(`${LUHN_SOURCE}; return luhnValid;`)() as (s: string) => boolean;
  it("all demo numbers pass the Luhn check and a typo does not", () => {
    for (const c of TEST_CARDS) expect(luhnValid(c.number), c.number).toBe(true);
    expect(luhnValid("4242 4242 4242 4241")).toBe(false);
    expect(luhnValid("abcd")).toBe(false);
    expect(luhnValid("")).toBe(false);
  });
});
