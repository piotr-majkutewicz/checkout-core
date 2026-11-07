import { describe, expect, it } from "vitest";
import { createApp } from "../src/demo/app.js";
import { APP_JS, DICTIONARIES, parseLang } from "../src/demo/assets.js";
import { PRODUCTS } from "../src/demo/catalog.js";
import { en } from "../src/i18n/en.js";
import { FORMAT_MONEY_SOURCE, MONEY_FORMATS } from "../src/i18n/money.js";
import { pl } from "../src/i18n/pl.js";
import { MOCK_LOCKERS } from "../src/shipping/mock.js";
import { ORDER_EVENTS, ORDER_STATES } from "../src/order.js";

const NOW = new Date("2026-11-07T12:00:00Z");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  it("have the same keys in Polish and English", () => {
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
  });

  it("have no empty texts and use the same placeholders", () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(pl[key].trim(), `pl ${key}`).not.toBe("");
      expect(en[key].trim(), `en ${key}`).not.toBe("");
      expect(placeholders(pl[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("contain no long dashes", () => {
    for (const d of [pl, en]) for (const v of Object.values(d)) expect(v).not.toMatch(/[–—]/);
  });

  it("cover every order state, event, product and demo locker", () => {
    for (const d of [pl, en] as Array<Record<string, string>>) {
      for (const st of ORDER_STATES) expect(d[`state.${st}`], st).toBeTruthy();
      for (const ev of ORDER_EVENTS) expect(d[`event.${ev}`], ev).toBeTruthy();
      for (const p of PRODUCTS) {
        expect(d[`product.${p.sku}.name`], p.sku).toBeTruthy();
        expect(d[`product.${p.sku}.desc`], p.sku).toBeTruthy();
      }
      for (const l of MOCK_LOCKERS) expect(d[`locker.${l.code}`], l.code).toBeTruthy();
    }
  });

  it("translate Polish for real: texts differ from English", () => {
    expect(pl["step.cart"]).toBe("Koszyk");
    expect(pl["step.locker"]).toBe("Paczkomat");
    expect(pl.banner).not.toBe(en.banner);
  });
});

describe("language handling", () => {
  it("accepts only pl and en", () => {
    expect(parseLang("pl")).toBe("pl");
    expect(parseLang("en")).toBe("en");
    expect(parseLang("de")).toBeUndefined();
    expect(parseLang(null)).toBeUndefined();
  });

  it("defaults to Polish whatever the browser asks for, and ?lang= overrides", async () => {
    const app = createApp({}, () => NOW);
    const get = async (path: string, headers: Record<string, string> = {}) => (await app(new Request(`http://localhost${path}`, { headers }))).text();
    expect(await get("/", { "accept-language": "en-US,en;q=0.9" })).toContain('<html lang="pl">');
    expect(await get("/?lang=en")).toContain('<html lang="en">');
    expect(await get("/?lang=pl")).toContain('<html lang="pl">');
    expect(await get("/?lang=xx")).toContain('<html lang="pl">');
  });

  it("renders an accessible language switcher", async () => {
    const html = await (await createApp({}, () => NOW)(new Request("http://localhost/"))).text();
    expect(html).toMatch(/<div class="lang" role="group"[^>]*aria-label="Język"/);
    expect(html).toMatch(/<button type="button" data-lang="pl" lang="pl"[^>]*aria-label="Polski"[^>]*aria-pressed="true">PL<\/button>/);
    expect(html).toMatch(/<button type="button" data-lang="en" lang="en"[^>]*aria-label="English"[^>]*aria-pressed="false">EN<\/button>/);
    const enHtml = await (await createApp({}, () => NOW)(new Request("http://localhost/?lang=en"))).text();
    expect(enHtml).toMatch(/aria-label="Language"/);
    expect(enHtml).toMatch(/data-lang="en"[^>]*aria-pressed="true"/);
  });

  it("client script persists the choice defensively and honours ?lang=", () => {
    expect(APP_JS).toContain('get("lang")');
    expect(APP_JS).toMatch(/try \{ localStorage\.setItem\("lang"/);
    expect(APP_JS).toMatch(/try \{ var s = localStorage\.getItem\("lang"\)/);
    expect(APP_JS).toContain('return "pl";');
    expect(APP_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(APP_JS).not.toContain("__I18N__");
  });

  it("embeds both dictionaries in the script", () => {
    expect(APP_JS).toContain(JSON.stringify(DICTIONARIES.pl["step.payment"]));
    expect(APP_JS).toContain(JSON.stringify(DICTIONARIES.en["step.payment"]));
  });
});

describe("money formatting", () => {
  const formatMoney = new Function(`${FORMAT_MONEY_SOURCE}; return formatMoney;`)() as (g: number, f: unknown) => string;
  it("Polish: 1 234,56 zł with non-breaking spaces", () => {
    expect(formatMoney(123456, MONEY_FORMATS.pl)).toBe("1 234,56 zł");
    expect(formatMoney(4999, MONEY_FORMATS.pl)).toBe("49,99 zł");
    expect(formatMoney(5, MONEY_FORMATS.pl)).toBe("0,05 zł");
    expect(formatMoney(-1000, MONEY_FORMATS.pl)).toBe("-10,00 zł");
    expect(formatMoney(100000000, MONEY_FORMATS.pl)).toBe("1 000 000,00 zł");
  });
  it("English: PLN 1,234.56", () => {
    expect(formatMoney(123456, MONEY_FORMATS.en)).toBe("PLN 1,234.56");
    expect(formatMoney(5, MONEY_FORMATS.en)).toBe("PLN 0.05");
    expect(formatMoney(-1000, MONEY_FORMATS.en)).toBe("-PLN 10.00");
  });
});

describe("API error codes", () => {
  it("every code the API returns has a UI text in both languages", async () => {
    const app = createApp({}, () => NOW);
    const post = (path: string, body: unknown) => app(new Request(`http://localhost${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
    const order = { items: [{ sku: "MUG-01", quantity: 1 }], lockerCode: "WAW123M", method: "card", cardScenario: "success" };
    const responses = [
      await post("/api/quote", { items: [] }),
      await post("/api/quote", { items: [{ sku: "NOPE", quantity: 1 }] }),
      await post("/api/quote", { items: [{ sku: "MUG-01", quantity: 0 }] }),
      await post("/api/quote", "{nope"),
      await post("/api/quote", []),
      await post("/api/quote", { ...order, extra: 1 }),
      await post("/api/orders", { ...order, method: "x" }),
      await post("/api/orders", { ...order, method: "blik", blikCode: "1" }),
      await post("/api/orders", { ...order, lockerCode: "bad" }),
      await post("/api/orders", { ...order, cardScenario: "x" }),
      await post("/api/orders/ord_x/settle", { outcome: "x" }),
      await post("/api/orders", { ...order, lockerCode: "ZZZ999Z" }),
      await post("/api/orders", { items: [{ sku: "LAMP-01", quantity: 3 }], method: "card", lockerCode: "GDA010N" }),
      await post("/api/orders/ord_none/ship", {}),
      await app(new Request("http://localhost/nope")),
    ];
    const codes = new Set<string>();
    for (const r of responses) {
      const body = (await r.json()) as { code: string; error: string };
      expect(body.code).toBeTruthy();
      expect(body.error).toBe((en as Record<string, string>)[`err.${body.code}`]);
      expect((pl as Record<string, string>)[`err.${body.code}`], body.code).toBeTruthy();
      codes.add(body.code);
    }
    expect(codes).toContain("unknown_product");
    expect(codes).toContain("bad_locker_code");
    expect(codes).toContain("order_not_found");
  });
});
