import { describe, expect, it } from "vitest";
import { DEMO_LIMITS, createApp, createLocalLimiter } from "../src/demo/app.js";

const NOW = new Date("2026-11-07T12:00:00Z");
const order = { items: [{ sku: "MUG-01", quantity: 1 }], lockerCode: "WAW123M", method: "card" };
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app(new Request(`http://localhost${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }));

describe("request size caps", () => {
  it("rejects an oversized body with 413, by Content-Length and by actual size", async () => {
    const app = createApp({}, () => NOW);
    const big = JSON.stringify({ items: [{ sku: "MUG-01", quantity: 1 }], discountCode: "x".repeat(DEMO_LIMITS.maxBodyBytes) });
    expect((await post(app, "/api/quote", big)).status).toBe(413);
    // A stream with no Content-Length header must be cut off by the reader.
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const res = await app(new Request("http://localhost/api/quote", { method: "POST", body: stream, duplex: "half" } as RequestInit));
    expect(res.status).toBe(413);
    expect((await post(app, "/api/webhooks/mock", big)).status).toBe(413);
  });
});

describe("strict validation", () => {
  const app = createApp({}, () => NOW);
  const bad: Array<[string, unknown]> = [
    ["array body", []],
    ["null body", null],
    ["unexpected field", { ...order, admin: true }],
    ["proto key", JSON.parse('{"__proto__":{"x":1},"items":[{"sku":"MUG-01","quantity":1}]}')],
    ["too many lines", { ...order, items: Array.from({ length: 21 }, () => ({ sku: "MUG-01", quantity: 1 })) }],
    ["duplicate sku", { ...order, items: [{ sku: "MUG-01", quantity: 1 }, { sku: "MUG-01", quantity: 1 }] }],
    ["string quantity", { ...order, items: [{ sku: "MUG-01", quantity: "2" }] }],
    ["fractional quantity", { ...order, items: [{ sku: "MUG-01", quantity: 1.5 }] }],
    ["quantity over cap", { ...order, items: [{ sku: "MUG-01", quantity: 100 }] }],
    ["non-string sku", { ...order, items: [{ sku: { a: 1 }, quantity: 1 }] }],
    ["extra line field", { ...order, items: [{ sku: "MUG-01", quantity: 1, price: 1 }] }],
    ["unknown method", { ...order, method: "bitcoin" }],
    ["method as array", { ...order, method: ["card"] }],
    ["locker not a string", { ...order, lockerCode: 123 }],
    ["huge locker", { ...order, lockerCode: "W".repeat(500) }],
    ["inherited discount name", { ...order, discountCode: "constructor" }],
  ];
  for (const [name, body] of bad) {
    it(`400 for ${name}`, async () => {
      const res = await post(app, "/api/orders", body);
      expect(res.status).toBe(400);
    });
  }
});

describe("non-leaky errors", () => {
  it("does not echo input or internals", async () => {
    const app = createApp({}, () => NOW);
    const probe = "<script>alert(1)</script>";
    const r1 = await (await post(app, "/api/quote", { items: [{ sku: probe, quantity: 1 }] })).text();
    expect(r1).not.toContain("script");
    const r2 = await (await post(app, "/api/orders", { ...order, lockerCode: "ZZZ999Z" })).text();
    expect(r2).not.toMatch(/stack|at \w+\.|\.ts/);
    const r3 = await app(new Request("http://localhost/api/orders/ord_none/ship", { method: "POST" }));
    expect(await r3.json()).toEqual({ error: "Order not found.", code: "order_not_found" });
  });

  it("answers an unexpected failure with a fixed 500 body", async () => {
    const env = { RATE_LIMITER: undefined } as const;
    const app = createApp(env, () => { throw new Error("secret internals /srv/x"); });
    const res = await app(new Request("http://localhost/api/catalog"));
    // clock failure happens inside the limiter: still a generic body
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong on the server.", code: "internal" });
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});

describe("rate limiting", () => {
  it("in-memory fallback returns 429 per IP past the limit, and recovers after the window", async () => {
    let t = NOW.getTime();
    const app = createApp({}, () => new Date(t));
    const get = (ip: string) => app(new Request("http://localhost/api/catalog", { headers: { "cf-connecting-ip": ip } }));
    for (let i = 0; i < DEMO_LIMITS.rateLimit; i++) expect((await get("1.1.1.1")).status).toBe(200);
    const limited = await get("1.1.1.1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(limited.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await get("2.2.2.2")).status).toBe(200);
    t += DEMO_LIMITS.rateWindowMs;
    expect((await get("1.1.1.1")).status).toBe(200);
  });

  it("does not rate limit the static page", async () => {
    const app = createApp({}, () => NOW);
    for (let i = 0; i < DEMO_LIMITS.rateLimit + 5; i++) expect((await app(new Request("http://localhost/"))).status).toBe(200);
  });

  it("uses the Cloudflare binding when present", async () => {
    const keys: string[] = [];
    const RATE_LIMITER = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: keys.length < 2 }) } as unknown as RateLimit;
    const app = createApp({ RATE_LIMITER }, () => NOW);
    const req = () => app(new Request("http://localhost/api/catalog", { headers: { "cf-connecting-ip": "9.9.9.9" } }));
    expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(429);
    expect(keys).toEqual(["9.9.9.9", "9.9.9.9"]);
  });

  it("fails open if the binding throws", async () => {
    const RATE_LIMITER = { limit: async () => { throw new Error("down"); } } as unknown as RateLimit;
    const app = createApp({ RATE_LIMITER }, () => NOW);
    expect((await app(new Request("http://localhost/api/catalog"))).status).toBe(200);
  });

  it("local limiter tracks a bounded number of clients", () => {
    const allow = createLocalLimiter(1, 1000, 2, () => 0);
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    allow("b");
    allow("c"); // evicts "a"
    expect(allow("a")).toBe(true);
  });
});

describe("order cap in the app", () => {
  it("forgets the oldest orders past the cap", async () => {
    const app = createApp({}, () => NOW);
    const ids: string[] = [];
    for (let i = 0; i < DEMO_LIMITS.maxOrders + 2; i++) {
      // vary the client so the per-IP limit does not interfere
      const res = await post(app, "/api/orders", order, { "cf-connecting-ip": `10.0.${i >> 8}.${i & 255}` });
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as any).order.id);
    }
    const status = async (id: string) => (await app(new Request(`http://localhost/api/orders/${id}`, { headers: { "cf-connecting-ip": "5.5.5.5" } }))).status;
    expect(await status(ids[0] as string)).toBe(404);
    expect(await status(ids[ids.length - 1] as string)).toBe(200);
  });
});
