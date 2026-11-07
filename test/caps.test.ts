import { describe, expect, it } from "vitest";
import { createOrder } from "../src/order.js";
import { MockProvider } from "../src/payments/mock.js";
import { InMemoryOrderStore } from "../src/payments/webhook.js";
import { priceCart } from "../src/cart.js";

const totals = priceCart([{ sku: "A", name: "A", unitGross: 1000, vatRate: 23, quantity: 1 }]);
const mk = (id: string) => createOrder(id, totals, "2026-11-07T12:00:00Z");

describe("memory caps", () => {
  it("order store evicts the oldest order past maxOrders", async () => {
    const store = new InMemoryOrderStore({ maxOrders: 3 });
    for (const id of ["a", "b", "c", "d", "e"]) await store.save(mk(id));
    expect(await store.get("a")).toBeUndefined();
    expect(await store.get("b")).toBeUndefined();
    expect(await store.get("c")).toBeDefined();
    expect(await store.get("e")).toBeDefined();
  });

  it("updating an existing order does not evict anything", async () => {
    const store = new InMemoryOrderStore({ maxOrders: 2 });
    await store.save(mk("a"));
    await store.save(mk("b"));
    await store.save(mk("b"));
    expect(await store.get("a")).toBeDefined();
  });

  it("rejects a nonsensical cap", () => {
    expect(() => new InMemoryOrderStore({ maxOrders: 0 })).toThrow(RangeError);
  });

  it("mock provider evicts the oldest payment past maxPayments", async () => {
    const p = new MockProvider({ secret: "s", maxPayments: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await p.createPayment({ orderId: `o${i}`, amount: 1000, method: "card" })).paymentId);
    }
    await expect(p.getStatus(ids[0] as string)).rejects.toThrow();
    await expect(p.getStatus(ids[2] as string)).resolves.toBeDefined();
  });
});
