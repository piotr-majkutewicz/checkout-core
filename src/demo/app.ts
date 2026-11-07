import { type Discount, type CartLine, priceCart } from "../cart.js";
import { isWithinWithdrawalPeriod, withdrawalLastDay } from "../consumer-law.js";
import { type Order, applyEvent, createOrder } from "../order.js";
import { MockProvider } from "../payments/mock.js";
import { WebhookError, type PaymentMethod } from "../payments/types.js";
import { InMemoryOrderStore, handleWebhook } from "../payments/webhook.js";
import { MOCK_LOCKERS, MockShippingProvider } from "../shipping/mock.js";
import { fitParcel } from "../shipping/parcel.js";
import { validateLockerCode } from "../shipping/locker-code.js";
import { ShippingError } from "../shipping/types.js";
import { APP_JS, INDEX_HTML, STYLE_CSS } from "./assets.js";
import { DISCOUNT_CODES, PRODUCTS, SHIPPING_RULE, estimateParcel } from "./catalog.js";

export interface DemoEnv {
  MOCK_WEBHOOK_SECRET?: string;
}

// The public demo must not be indexed. Crawlers have to be able to fetch pages to see this
// header, so robots.txt allows everything and noindex is the only signal.
const SECURITY_HEADERS = {
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS },
  });
}

/** Last line of defence: whatever a route returned, the headers are there. */
function withSecurityHeaders(res: Response): Response {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
  return res;
}

function asset(body: string, type: string): Response {
  return new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, ...SECURITY_HEADERS } });
}

/**
 * Builds the demo request handler.
 *
 * Order state lives in process memory (InMemoryOrderStore). That is on purpose and only
 * fit for a demo: it disappears on restart and is not shared between Worker isolates.
 * A real deployment needs a database; OrderStore is the seam where one plugs in.
 */
export function createApp(env: DemoEnv = {}, now: () => Date = () => new Date()) {
  const store = new InMemoryOrderStore();
  const payments = new MockProvider({ secret: env.MOCK_WEBHOOK_SECRET ?? "demo-only-secret" });
  const shipping = new MockShippingProvider();
  const lastDelivery = new Map<string, { body: string; headers: Record<string, string> }>();

  /** Stands in for the operator calling our webhook endpoint. */
  async function flushWebhooks(orderId: string): Promise<void> {
    for (const d of await payments.takeDeliveries()) {
      lastDelivery.set(orderId, d);
      await handleWebhook(payments, store, d.body, d.headers, now);
    }
  }

  function buildCart(body: unknown): { lines: CartLine[]; items: Array<{ product: (typeof PRODUCTS)[number]; quantity: number }>; discount?: Discount } {
    const b = body as { items?: Array<{ sku?: unknown; quantity?: unknown }>; discountCode?: unknown } | null;
    if (!b || !Array.isArray(b.items) || b.items.length === 0 || b.items.length > 20) throw new HttpError(400, "Cart must contain 1 to 20 lines");
    const items = b.items.map((i) => {
      const product = PRODUCTS.find((p) => p.sku === i.sku);
      if (!product) throw new HttpError(400, `Unknown product: ${String(i.sku)}`);
      if (!Number.isInteger(i.quantity) || (i.quantity as number) < 1 || (i.quantity as number) > 99) throw new HttpError(400, "Quantity must be 1 to 99");
      return { product, quantity: i.quantity as number };
    });
    let discount: Discount | undefined;
    if (typeof b.discountCode === "string" && b.discountCode.trim() !== "") {
      discount = DISCOUNT_CODES[b.discountCode.trim().toUpperCase()];
      if (!discount) throw new HttpError(400, "Unknown discount code");
    }
    const lines = items.map(({ product, quantity }) => ({
      sku: product.sku, name: product.name, unitGross: product.unitGross, vatRate: product.vatRate, quantity,
    }));
    return { lines, items, discount };
  }

  async function mustOrder(id: string): Promise<Order> {
    const order = await store.get(id);
    if (!order) throw new HttpError(404, "Order not found");
    return order;
  }

  /** Applies a manual transition (ship, deliver...) and turns state-machine rejections into 409. */
  async function transition(id: string, fn: (o: Order) => Order): Promise<Order> {
    await mustOrder(id);
    let failure: Error | undefined;
    const result = await store.update(id, (o) => {
      try {
        const next = fn(o);
        return { order: next, result: next };
      } catch (e) {
        failure = e as Error;
        return { order: o, result: o };
      }
    });
    if (failure) throw new HttpError(409, failure.message);
    return result as Order;
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "GET" && path === "/") return asset(INDEX_HTML, "text/html");
    if (method === "GET" && path === "/app.js") return asset(APP_JS, "text/javascript");
    if (method === "GET" && path === "/style.css") return asset(STYLE_CSS, "text/css");
    if (method === "GET" && path === "/robots.txt") return asset("User-agent: *\nAllow: /\n", "text/plain");

    if (method === "GET" && path === "/api/catalog") {
      return json({
        products: PRODUCTS.map(({ sku, name, description, unitGross, vatRate }) => ({ sku, name, description, unitGross, vatRate })),
        lockers: MOCK_LOCKERS.map(({ code, name, city }) => ({ code, name, city })),
        discountCodes: Object.keys(DISCOUNT_CODES),
        shipping: SHIPPING_RULE,
      });
    }

    if (method === "POST" && path === "/api/quote") {
      const cart = buildCart(await readJson(request));
      return json(priceCart(cart.lines, { discount: cart.discount, shipping: SHIPPING_RULE }));
    }

    if (method === "POST" && path === "/api/orders") {
      const body = (await readJson(request)) as Record<string, unknown>;
      const cart = buildCart(body);
      const payMethod = body["method"] as PaymentMethod;
      if (!["blik", "card", "transfer"].includes(payMethod)) throw new HttpError(400, "Choose BLIK, card or bank transfer");
      if (payMethod === "blik" && !/^\d{6}$/.test(String(body["blikCode"] ?? ""))) throw new HttpError(400, "BLIK code must be 6 digits");
      const lockerCheck = validateLockerCode(String(body["lockerCode"] ?? ""));
      if (!lockerCheck.valid) throw new HttpError(400, lockerCheck.reason);
      const locker = await shipping.getLocker(lockerCheck.code);
      if (!locker) throw new HttpError(400, "No such locker in the demo data");
      const fit = fitParcel(estimateParcel(cart.items));
      if (!fit.fits) throw new HttpError(400, fit.reason);
      if (!locker.supportedSizes.includes(fit.sizeClass)) throw new HttpError(400, `Locker ${locker.code} cannot take a size ${fit.sizeClass} parcel`);

      const totals = priceCart(cart.lines, { discount: cart.discount, shipping: SHIPPING_RULE });
      if (totals.totalGross <= 0) throw new HttpError(400, "Nothing to pay");
      const id = `ord_${crypto.randomUUID().slice(0, 8)}`;
      let order = applyEvent(createOrder(id, totals, now().toISOString()), "payment_started", now().toISOString());
      const payment = await payments.createPayment({
        orderId: id,
        amount: totals.totalGross,
        method: payMethod,
        blikCode: typeof body["blikCode"] === "string" ? body["blikCode"] : undefined,
      });
      order = { ...order, paymentId: payment.paymentId, paymentMethod: payMethod, lockerCode: locker.code };
      await store.save(order);
      await flushWebhooks(id);
      return json({ order: await mustOrder(id), nextAction: payment.nextAction ?? null }, 201);
    }

    const m = /^\/api\/orders\/([\w-]+)(?:\/([\w-]+))?$/.exec(path);
    if (m) {
      const id = m[1] as string;
      const action = m[2];
      if (method === "GET" && !action) return json(await withLegal(await mustOrder(id)));
      if (method === "POST" && action === "settle") {
        const order = await mustOrder(id);
        if (!order.paymentId) throw new HttpError(409, "Order has no payment");
        try {
          payments.settle(order.paymentId, "succeeded");
        } catch (e) {
          throw new HttpError(409, (e as Error).message);
        }
        await flushWebhooks(id);
        return json(await withLegal(await mustOrder(id)));
      }
      if (method === "POST" && action === "redeliver") {
        const d = lastDelivery.get(id);
        if (!d) throw new HttpError(404, "No webhook delivered yet");
        const outcome = await handleWebhook(payments, store, d.body, d.headers, now);
        return json({ outcome: outcome.status, ...(await withLegal(await mustOrder(id))) });
      }
      if (method === "POST" && action === "ship") {
        const order = await mustOrder(id);
        if (order.state !== "paid") throw new HttpError(409, `Cannot ship an order in state ${order.state}`);
        const shipment = await shipping.createShipment({
          orderId: id,
          lockerCode: order.lockerCode ?? "",
          parcel: { lengthMm: 200, widthMm: 150, heightMm: 70, weightG: 800 },
          recipient: { name: "Demo Customer", phone: "+48000000000", email: "demo@example.com" },
        });
        const next = await transition(id, (o) => ({ ...applyEvent(o, "ship", now().toISOString()), trackingNumber: shipment.trackingNumber }));
        return json({ ...(await withLegal(next)), label: shipment.label.content });
      }
      if (method === "POST" && action === "deliver") {
        const at = now().toISOString();
        const next = await transition(id, (o) => ({ ...applyEvent(o, "deliver", at), deliveredAt: at }));
        return json(await withLegal(next));
      }
      if (method === "POST" && action === "refund") {
        const order = await transition(id, (o) => applyEvent(o, "request_refund", now().toISOString()));
        await payments.refund(order.paymentId as string);
        await flushWebhooks(id);
        return json(await withLegal(await mustOrder(id)));
      }
    }

    if (method === "POST" && path === "/api/webhooks/mock") {
      const raw = await request.text();
      const headers: Record<string, string> = {};
      request.headers.forEach((v, k) => (headers[k] = v));
      try {
        const outcome = await handleWebhook(payments, store, raw, headers, now);
        return json({ outcome: outcome.status });
      } catch (e) {
        if (e instanceof WebhookError) return json({ error: e.code }, e.code === "bad_payload" ? 400 : 401);
        throw e;
      }
    }

    throw new HttpError(404, "Not found");
  }

  async function withLegal(order: Order) {
    if (!order.deliveredAt) return { order };
    const at = now();
    return {
      order,
      withdrawal: {
        lastDay: withdrawalLastDay(order.deliveredAt),
        open: isWithinWithdrawalPeriod(order.deliveredAt, at),
        note: "Illustration only, not legal advice.",
      },
    };
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      return withSecurityHeaders(await route(request));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof ShippingError) return json({ error: e.message, code: e.code }, 400);
      if (e instanceof RangeError) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: "Internal error" }, 500);
    }
  };
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 20_000) throw new HttpError(413, "Body too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}
