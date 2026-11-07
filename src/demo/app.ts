import { type Discount, type CartLine, priceCart } from "../cart.js";
import { isWithinWithdrawalPeriod, withdrawalLastDay } from "../consumer-law.js";
import { type Order, applyEvent, createOrder } from "../order.js";
import { MockProvider } from "../payments/mock.js";
import { WebhookError } from "../payments/types.js";
import { InMemoryOrderStore, handleWebhook } from "../payments/webhook.js";
import { MOCK_LOCKERS, MockShippingProvider } from "../shipping/mock.js";
import { fitParcel } from "../shipping/parcel.js";
import { validateLockerCode } from "../shipping/locker-code.js";
import { ShippingError } from "../shipping/types.js";
import { en } from "../i18n/en.js";
import { APP_JS, DEFAULT_LANG, STYLE_CSS, indexHtml, parseLang } from "./assets.js";
import { DISCOUNT_CODES, PRODUCTS, SHIPPING_RULE, estimateParcel } from "./catalog.js";

export interface DemoEnv {
  MOCK_WEBHOOK_SECRET?: string;
  /** Cloudflare rate limiting binding (see wrangler.jsonc). Optional: without it an in-memory limiter is used. */
  RATE_LIMITER?: RateLimit;
}

/** Limits that keep a publicly reachable demo from being used to exhaust memory or CPU. */
export const DEMO_LIMITS = {
  /** Orders (and mock payments, and replayable webhooks) kept in memory; the oldest are dropped. */
  maxOrders: 200,
  /** Largest accepted request body, in bytes. A full 20-line cart is well under 2 KB. */
  maxBodyBytes: 4096,
  maxCartLines: 20,
  maxQuantity: 99,
  /** Requests per client IP per window. */
  rateLimit: 60,
  rateWindowMs: 60_000,
  /** Distinct client IPs tracked by the in-memory fallback limiter. */
  maxTrackedClients: 1000,
} as const;

// The public demo must not be indexed. Crawlers have to be able to fetch pages to see this
// header, so robots.txt allows everything and noindex is the only signal.
const SECURITY_HEADERS = {
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/** Carries a stable error code; the English text for it comes from the dictionary. */
class HttpError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode) {
    super(code);
  }
}

export type ErrorCode = {
  [K in keyof typeof en]: K extends `err.${infer C}` ? C : never;
}[keyof typeof en];

/** Error body: a stable `code` for clients (the UI translates it) and a short English `error` for humans reading raw JSON. */
function errorResponse(code: ErrorCode, status: number): Response {
  return json({ error: en[`err.${code}`], code }, status);
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
  const store = new InMemoryOrderStore({ maxOrders: DEMO_LIMITS.maxOrders });
  const payments = new MockProvider({ secret: env.MOCK_WEBHOOK_SECRET ?? "demo-only-secret", maxPayments: DEMO_LIMITS.maxOrders });
  const localLimiter = createLocalLimiter(DEMO_LIMITS.rateLimit, DEMO_LIMITS.rateWindowMs, DEMO_LIMITS.maxTrackedClients, () => now().getTime());
  const shipping = new MockShippingProvider();
  const lastDelivery = new Map<string, { body: string; headers: Record<string, string> }>();

  /** Stands in for the operator calling our webhook endpoint. */
  async function flushWebhooks(orderId: string): Promise<void> {
    for (const d of await payments.takeDeliveries()) {
      lastDelivery.set(orderId, d);
      while (lastDelivery.size > DEMO_LIMITS.maxOrders) lastDelivery.delete(lastDelivery.keys().next().value as string);
      await handleWebhook(payments, store, d.body, d.headers, now);
    }
  }

  function buildCart(raw: Record<string, unknown>): { lines: CartLine[]; items: Array<{ product: (typeof PRODUCTS)[number]; quantity: number }>; discount?: Discount } {
    const rawItems = raw["items"];
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > DEMO_LIMITS.maxCartLines) {
      throw new HttpError(400, "cart_lines");
    }
    const seen = new Set<string>();
    const items = rawItems.map((entry) => {
      const i = plainObject(entry);
      onlyKeys(i, ["sku", "quantity"]);
      const product = typeof i["sku"] === "string" ? PRODUCTS.find((p) => p.sku === i["sku"]) : undefined;
      if (!product) throw new HttpError(400, "unknown_product");
      if (seen.has(product.sku)) throw new HttpError(400, "duplicate_product");
      seen.add(product.sku);
      const q = i["quantity"];
      if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > DEMO_LIMITS.maxQuantity) throw new HttpError(400, "bad_quantity");
      return { product, quantity: q };
    });
    let discount: Discount | undefined;
    const code = optionalString(raw, "discountCode", 32)?.trim();
    if (code) {
      discount = Object.hasOwn(DISCOUNT_CODES, code.toUpperCase()) ? DISCOUNT_CODES[code.toUpperCase()] : undefined;
      if (!discount) throw new HttpError(400, "unknown_discount");
    }
    const lines = items.map(({ product, quantity }) => ({
      sku: product.sku, name: product.name, unitGross: product.unitGross, vatRate: product.vatRate, quantity,
    }));
    return { lines, items, discount };
  }

  async function mustOrder(id: string): Promise<Order> {
    const order = await store.get(id);
    if (!order) throw new HttpError(404, "order_not_found");
    return order;
  }

  /** Applies a manual transition (ship, deliver...) and turns state-machine rejections into 409. */
  async function transition(id: string, fn: (o: Order) => Order): Promise<Order> {
    await mustOrder(id);
    let failure: unknown;
    const result = await store.update(id, (o) => {
      try {
        const next = fn(o);
        return { order: next, result: next };
      } catch (e) {
        failure = e;
        return { order: o, result: o };
      }
    });
    if (failure) throw new HttpError(409, "action_not_allowed");
    return result as Order;
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "GET" && path === "/") return asset(indexHtml(parseLang(url.searchParams.get("lang")) ?? DEFAULT_LANG), "text/html");
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
      const body = plainObject(await readJson(request));
      onlyKeys(body, ["items", "discountCode"]);
      const cart = buildCart(body);
      return json(priceCart(cart.lines, { discount: cart.discount, shipping: SHIPPING_RULE }));
    }

    if (method === "POST" && path === "/api/orders") {
      const body = plainObject(await readJson(request));
      onlyKeys(body, ["items", "discountCode", "method", "blikCode", "lockerCode"]);
      const cart = buildCart(body);
      const payMethod = body["method"];
      if (payMethod !== "blik" && payMethod !== "card" && payMethod !== "transfer") throw new HttpError(400, "bad_method");
      const blikCode = optionalString(body, "blikCode", 16);
      if (payMethod === "blik" && !/^\d{6}$/.test(blikCode ?? "")) throw new HttpError(400, "bad_blik");
      const lockerCheck = validateLockerCode(optionalString(body, "lockerCode", 16) ?? "");
      if (!lockerCheck.valid) throw new HttpError(400, "bad_locker_code");
      const locker = await shipping.getLocker(lockerCheck.code);
      if (!locker) throw new HttpError(400, "unknown_locker");
      const fit = fitParcel(estimateParcel(cart.items));
      if (!fit.fits) throw new HttpError(400, "parcel_too_big");
      if (!locker.supportedSizes.includes(fit.sizeClass)) throw new HttpError(400, "locker_too_small");

      const totals = priceCart(cart.lines, { discount: cart.discount, shipping: SHIPPING_RULE });
      if (totals.totalGross <= 0) throw new HttpError(400, "nothing_to_pay");
      const id = `ord_${crypto.randomUUID().slice(0, 8)}`;
      let order = applyEvent(createOrder(id, totals, now().toISOString()), "payment_started", now().toISOString());
      const payment = await payments.createPayment({
        orderId: id,
        amount: totals.totalGross,
        method: payMethod,
        blikCode: payMethod === "blik" ? blikCode : undefined,
      });
      order = { ...order, paymentId: payment.paymentId, paymentMethod: payMethod, lockerCode: locker.code };
      await store.save(order);
      await flushWebhooks(id);
      return json({ order: await mustOrder(id), nextAction: payment.nextAction ?? null }, 201);
    }

    const m = /^\/api\/orders\/([\w-]{1,40})(?:\/([a-z]{1,10}))?$/.exec(path);
    if (m) {
      const id = m[1] as string;
      const action = m[2];
      if (method === "GET" && !action) return json(await withLegal(await mustOrder(id)));
      if (method === "POST" && action === "settle") {
        const order = await mustOrder(id);
        if (!order.paymentId) throw new HttpError(409, "no_payment");
        try {
          payments.settle(order.paymentId, "succeeded");
        } catch {
          throw new HttpError(409, "cannot_settle");
        }
        await flushWebhooks(id);
        return json(await withLegal(await mustOrder(id)));
      }
      if (method === "POST" && action === "redeliver") {
        const d = lastDelivery.get(id);
        if (!d) throw new HttpError(404, "no_webhook");
        const outcome = await handleWebhook(payments, store, d.body, d.headers, now);
        return json({ outcome: outcome.status, ...(await withLegal(await mustOrder(id))) });
      }
      if (method === "POST" && action === "ship") {
        const order = await mustOrder(id);
        if (order.state !== "paid") throw new HttpError(409, "ship_not_allowed");
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
      const raw = await readBody(request, DEMO_LIMITS.maxBodyBytes);
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

    throw new HttpError(404, "not_found");
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

  /** Per-IP limit: Cloudflare binding when configured, otherwise a bounded in-memory counter. */
  async function allowed(request: Request): Promise<boolean> {
    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    if (env.RATE_LIMITER) {
      try {
        return (await env.RATE_LIMITER.limit({ key: ip })).success;
      } catch (e) {
        console.error(e); // a broken limiter must not take the demo down
        return true;
      }
    }
    return localLimiter(ip);
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname.startsWith("/api/") && !(await allowed(request))) {
        const limited = errorResponse("rate_limited", 429);
        limited.headers.set("retry-after", "60");
        return limited;
      }
      return withSecurityHeaders(await route(request));
    } catch (e) {
      // Error bodies never echo internals: only fixed messages written in this file.
      if (e instanceof HttpError) return errorResponse(e.code, e.status);
      if (e instanceof ShippingError) return errorResponse("shipping_rejected", 400);
      if (e instanceof RangeError) return errorResponse("invalid_request", 400);
      console.error(e);
      return errorResponse("internal", 500);
    }
  };
}

/** Fixed-window counter per key, bounded in memory. Fallback for when no Cloudflare binding is configured. */
export function createLocalLimiter(limit: number, windowMs: number, maxKeys: number, now: () => number) {
  const windows = new Map<string, { start: number; count: number }>();
  return function allow(key: string): boolean {
    const t = now();
    let w = windows.get(key);
    if (!w || t - w.start >= windowMs) {
      w = { start: t, count: 0 };
      windows.delete(key);
      windows.set(key, w);
      while (windows.size > maxKeys) windows.delete(windows.keys().next().value as string);
    }
    w.count++;
    return w.count <= limit;
  };
}

/** Reads a body of at most `max` bytes, refusing early on Content-Length and never buffering more than the cap. */
async function readBody(request: Request, max: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) throw new HttpError(413, "body_too_large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "body_too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function readJson(request: Request): Promise<unknown> {
  const text = await readBody(request, DEMO_LIMITS.maxBodyBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

function plainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "body_not_object");
  return value as Record<string, unknown>;
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new HttpError(400, "unexpected_field");
}

function optionalString(obj: Record<string, unknown>, key: string, maxLength: number): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > maxLength) throw new HttpError(400, "invalid_input");
  return v;
}
