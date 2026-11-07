import { describe, expect, it } from "vitest";
import { createApp } from "../src/demo/app.js";

const NOW = new Date("2026-11-07T12:00:00Z");
const base = { items: [{ sku: "MUG-01", quantity: 2 }], lockerCode: "WAW123M" };

async function call(app: ReturnType<typeof createApp>, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const res = await app(new Request(`http://localhost${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers }));
  return { status: res.status, data: (res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text()) as any };
}

describe("demo app", () => {
  it("serves the page with a strict CSP", async () => {
    const app = createApp({}, () => NOW);
    const res = await app(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await res.text()).toContain("checkout-core");
  });

  it("never uses innerHTML in the client script", async () => {
    const app = createApp({}, () => NOW);
    const js = (await call(app, "/app.js")).data as string;
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it("quotes a cart", async () => {
    const app = createApp({}, () => NOW);
    const { status, data } = await call(app, "/api/quote", "POST", { items: [{ sku: "MUG-01", quantity: 2 }], discountCode: "save10" });
    expect(status).toBe(200);
    expect(data.itemsGross).toBe(9998);
    expect(data.discountTotal).toBe(1000);
    expect(data.shippingGross).toBe(1299);
  });

  it("rejects bad input with 400", async () => {
    const app = createApp({}, () => NOW);
    expect((await call(app, "/api/quote", "POST", { items: [] })).status).toBe(400);
    expect((await call(app, "/api/quote", "POST", { items: [{ sku: "NOPE", quantity: 1 }] })).status).toBe(400);
    expect((await call(app, "/api/quote", "POST", { items: [{ sku: "MUG-01", quantity: 0 }] })).status).toBe(400);
    expect((await call(app, "/api/quote", "POST", { items: [{ sku: "MUG-01", quantity: 1 }], discountCode: "x" })).status).toBe(400);
    const res = await app(new Request("http://localhost/api/quote", { method: "POST", body: "{nope" }));
    expect(res.status).toBe(400);
    expect((await call(app, "/api/orders", "POST", { ...base, method: "blik", blikCode: "12" })).status).toBe(400);
    expect((await call(app, "/api/orders", "POST", { ...base, method: "card", lockerCode: "bad" })).status).toBe(400);
    expect((await call(app, "/api/orders", "POST", { ...base, method: "card", lockerCode: "ZZZ999Z" })).status).toBe(400);
    expect((await call(app, "/nope")).status).toBe(404);
  });

  it("rejects a bulky item for a locker that cannot take it", async () => {
    const app = createApp({}, () => NOW);
    const r = await call(app, "/api/orders", "POST", { items: [{ sku: "LAMP-01", quantity: 3 }], method: "card", lockerCode: "GDA010N" });
    expect(r.status).toBe(400);
  });

  it("full happy path: BLIK -> paid -> shipped -> fulfilled -> withdrawal info", async () => {
    const app = createApp({}, () => NOW);
    const created = await call(app, "/api/orders", "POST", { ...base, method: "blik", blikCode: "123456" });
    expect(created.status).toBe(201);
    const id = created.data.order.id;
    expect(created.data.order.state).toBe("paid");
    expect((await call(app, `/api/orders/${id}/ship`, "POST")).data.order.state).toBe("shipped");
    expect((await call(app, `/api/orders/${id}/ship`, "POST")).status).toBe(409);
    const delivered = await call(app, `/api/orders/${id}/deliver`, "POST");
    expect(delivered.data.order.state).toBe("fulfilled");
    expect(delivered.data.withdrawal.lastDay).toBe("2026-11-21");
  });

  it("delayed transfer stays awaiting_payment until settled; replay is a duplicate", async () => {
    const app = createApp({}, () => NOW);
    const id = (await call(app, "/api/orders", "POST", { ...base, method: "transfer" })).data.order.id;
    expect((await call(app, `/api/orders/${id}`)).data.order.state).toBe("awaiting_payment");
    expect((await call(app, `/api/orders/${id}/ship`, "POST")).status).toBe(409);
    expect((await call(app, `/api/orders/${id}/settle`, "POST")).data.order.state).toBe("paid");
    const replay = await call(app, `/api/orders/${id}/redeliver`, "POST");
    expect(replay.data.outcome).toBe("duplicate");
    expect(replay.data.order.history).toHaveLength(2);
  });

  it("declined BLIK ends in payment_failed", async () => {
    const app = createApp({}, () => NOW);
    const r = await call(app, "/api/orders", "POST", { ...base, method: "blik", blikCode: "111111" });
    expect(r.data.order.state).toBe("payment_failed");
  });

  it("refund flow ends in refunded", async () => {
    const app = createApp({}, () => NOW);
    const id = (await call(app, "/api/orders", "POST", { ...base, method: "card", cardScenario: "success" })).data.order.id;
    const r = await call(app, `/api/orders/${id}/refund`, "POST");
    expect(r.data.order.state).toBe("refunded");
    expect((await call(app, `/api/orders/${id}/refund`, "POST")).status).toBe(409);
  });

  it("webhook endpoint rejects unsigned and tampered requests", async () => {
    const app = createApp({}, () => NOW);
    expect((await call(app, "/api/webhooks/mock", "POST", { id: "x" })).status).toBe(401);
    expect((await call(app, "/api/webhooks/mock", "POST", { id: "x" }, { "x-mock-signature": "sha256=00", "x-mock-timestamp": "1" })).status).toBe(401);
  });
});

describe("not indexed on purpose", () => {
  const paths: Array<[string, string]> = [
    ["GET", "/"], ["GET", "/app.js"], ["GET", "/style.css"], ["GET", "/robots.txt"], ["GET", "/api/catalog"],
    ["GET", "/nope"], ["POST", "/api/quote"], ["POST", "/api/webhooks/mock"], ["GET", "/api/orders/ord_x"],
  ];

  it("sends X-Robots-Tag on every response, errors included", async () => {
    const app = createApp({}, () => NOW);
    for (const [method, path] of paths) {
      const res = await app(new Request(`http://localhost${path}`, { method, body: method === "POST" ? "{}" : undefined }));
      expect(res.headers.get("x-robots-tag"), `${method} ${path}`).toBe("noindex, nofollow");
    }
  });

  it("puts a robots meta tag in the HTML", async () => {
    const html = (await call(createApp({}, () => NOW), "/")).data as string;
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("robots.txt allows crawling so that noindex can be read, and there is no sitemap", async () => {
    const app = createApp({}, () => NOW);
    const robots = await call(app, "/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.data).toBe("User-agent: *\nAllow: /\n");
    expect(robots.data).not.toMatch(/disallow|sitemap/i);
    expect((await call(app, "/sitemap.xml")).status).toBe(404);
  });
});

describe("public demo framing", () => {
  it("shows the simulation banner and the call to action in both languages, without external resources", async () => {
    const app = createApp({}, () => NOW);
    const cases: Array<[string, string, string, string]> = [
      ["/", "Demo z symulowanymi dostawcami płatności i paczkomatów. Bez prawdziwych płatności i przesyłek.", "Potrzebujesz sklepu lub poprawek w istniejącym?", "Napisz do Piotra Majkutewicza."],
      ["/?lang=en", "Demo with simulated payment and parcel-locker providers. No real payments or shipments.", "Need a shop built or fixed?", "Talk to Piotr Majkutewicz."],
    ];
    for (const [path, banner, lead, link] of cases) {
      const html = (await call(app, path)).data as string;
      expect(html).toContain(banner);
      expect(html).toContain(lead);
      expect(html).toContain(`<a href="https://piotrmajkutewicz.pl" rel="noopener" data-i18n="ctaLink">${link}</a>`);
      // Only the owner's link may point off-site; scripts and styles are same-origin.
      const urls = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
      expect(urls).toEqual(["https://piotrmajkutewicz.pl"]);
    }
  });
});
