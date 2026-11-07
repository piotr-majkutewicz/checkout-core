import { describe, expect, it } from "vitest";
import { allocate, computeShipping, priceCart, type CartLine } from "../src/cart.js";
import { formatPLN, roundDiv } from "../src/money.js";
import { fromNet, splitGross, summarizeVat } from "../src/vat.js";

describe("roundDiv", () => {
  it("rounds half away from zero", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(1, 3)).toBe(0);
    expect(roundDiv(0, 7)).toBe(0);
  });
  it("rejects bad input", () => {
    expect(() => roundDiv(1.5, 2)).toThrow();
    expect(() => roundDiv(1, 0)).toThrow();
  });
});

describe("formatPLN", () => {
  it("formats grosze", () => {
    expect(formatPLN(0)).toBe("0,00 zł");
    expect(formatPLN(5)).toBe("0,05 zł");
    expect(formatPLN(123456)).toBe("1 234,56 zł");
    expect(formatPLN(-250)).toBe("-2,50 zł");
  });
  it("rejects floats", () => {
    expect(() => formatPLN(1.5)).toThrow();
  });
});

describe("splitGross", () => {
  it("splits 123.00 PLN at 23% exactly", () => {
    expect(splitGross(12300, 23)).toEqual({ net: 10000, vat: 2300, gross: 12300 });
  });
  it("handles 8%, 5% and 0%", () => {
    expect(splitGross(10800, 8)).toEqual({ net: 10000, vat: 800, gross: 10800 });
    expect(splitGross(10500, 5)).toEqual({ net: 10000, vat: 500, gross: 10500 });
    expect(splitGross(9999, 0)).toEqual({ net: 9999, vat: 0, gross: 9999 });
  });
  it("rounds half up on the net amount", () => {
    // 1 gr gross at 23%: 100/123 = 0.81 -> net 1, vat 0
    expect(splitGross(1, 23)).toEqual({ net: 1, vat: 0, gross: 1 });
    // 2 gr: 200/123 = 1.63 -> 2
    expect(splitGross(2, 23)).toEqual({ net: 2, vat: 0, gross: 2 });
    // 10 gr: 1000/123 = 8.13 -> 8, vat 2
    expect(splitGross(10, 23)).toEqual({ net: 8, vat: 2, gross: 10 });
    // exact .5 case: 21 gr at 5%: 2100/105 = 20 exactly; 3 gr at 8%: 300/108 = 2.78 -> 3
    expect(splitGross(3, 8)).toEqual({ net: 3, vat: 0, gross: 3 });
  });
  it("always satisfies net + vat === gross", () => {
    for (const rate of [23, 8, 5, 0] as const) {
      for (let gross = 0; gross <= 2000; gross++) {
        const s = splitGross(gross, rate);
        expect(s.net + s.vat).toBe(gross);
        expect(s.vat).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it("rejects unsupported rates and floats", () => {
    expect(() => splitGross(100, 19 as never)).toThrow();
    expect(() => splitGross(10.5, 23)).toThrow();
  });
});

describe("fromNet", () => {
  it("adds VAT", () => {
    expect(fromNet(10000, 23)).toEqual({ net: 10000, vat: 2300, gross: 12300 });
    expect(fromNet(1, 23)).toEqual({ net: 1, vat: 0, gross: 1 });
    expect(fromNet(3, 23)).toEqual({ net: 3, vat: 1, gross: 4 });
  });
});

describe("summarizeVat", () => {
  it("groups by rate, highest first, rounding once per group", () => {
    // Three lines of 1.00 PLN at 23%: per line net would be 0.81 each (2.43 total),
    // grouped: 300/123 = 2.44 -> 2.44
    const rows = summarizeVat([
      { gross: 100, rate: 23 },
      { gross: 100, rate: 23 },
      { gross: 100, rate: 23 },
      { gross: 105, rate: 5 },
    ]);
    expect(rows.map((r) => r.rate)).toEqual([23, 5]);
    expect(rows[0]).toEqual({ rate: 23, net: 244, vat: 56, gross: 300 });
    expect(rows[1]).toEqual({ rate: 5, net: 100, vat: 5, gross: 105 });
  });
});

describe("allocate", () => {
  it("sums exactly to the total", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1, [5, 5, 5])).toEqual([1, 0, 0]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(10, [0, 0])).toEqual([0, 0]);
  });
  it("sums exactly for many splits", () => {
    for (let total = 0; total < 200; total++) {
      const parts = allocate(total, [333, 1, 7, 1999]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

const mug: CartLine = { sku: "MUG", name: "Mug", unitGross: 4999, quantity: 1, vatRate: 23 };
const book: CartLine = { sku: "BOOK", name: "Book", unitGross: 3990, quantity: 2, vatRate: 5 };
const tea: CartLine = { sku: "TEA", name: "Tea", unitGross: 1999, quantity: 3, vatRate: 8 };

describe("priceCart", () => {
  it("sums several lines with mixed VAT rates", () => {
    const t = priceCart([mug, book, tea]);
    expect(t.itemsGross).toBe(4999 + 7980 + 5997);
    expect(t.totalGross).toBe(t.itemsGross);
    expect(t.vat.map((r) => r.rate)).toEqual([23, 8, 5]);
    expect(t.totalNet + t.totalVat).toBe(t.totalGross);
  });

  it("applies a fixed discount, capped at the goods total", () => {
    expect(priceCart([mug], { discount: { kind: "amount", amount: 1000 } }).totalGross).toBe(3999);
    const capped = priceCart([mug], { discount: { kind: "amount", amount: 999999 } });
    expect(capped.totalGross).toBe(0);
    expect(capped.discountTotal).toBe(4999);
  });

  it("applies a percentage discount with rounding", () => {
    // 10% of 49.99 = 4.999 -> 5.00
    const t = priceCart([mug], { discount: { kind: "percent", basisPoints: 1000 } });
    expect(t.discountTotal).toBe(500);
    expect(t.totalGross).toBe(4499);
    // 12.5% of 3 gr = 0.375 -> 0
    const tiny = priceCart([{ ...mug, unitGross: 3 }], { discount: { kind: "percent", basisPoints: 1250 } });
    expect(tiny.discountTotal).toBe(0);
    // 100% discount
    expect(priceCart([mug], { discount: { kind: "percent", basisPoints: 10000 } }).totalGross).toBe(0);
  });

  it("allocates discount across lines so line discounts sum to the total", () => {
    const t = priceCart([mug, book, tea], { discount: { kind: "amount", amount: 1001 } });
    expect(t.lines.reduce((a, l) => a + l.discount, 0)).toBe(1001);
    expect(t.lines.reduce((a, l) => a + l.gross, 0)).toBe(t.itemsAfterDiscount);
    // VAT summary gross equals the total (no shipping)
    expect(t.vat.reduce((a, r) => a + r.gross, 0)).toBe(t.totalGross);
  });

  it("rejects bad discounts", () => {
    expect(() => priceCart([mug], { discount: { kind: "percent", basisPoints: 10001 } })).toThrow();
    expect(() => priceCart([mug], { discount: { kind: "percent", basisPoints: 1.5 } })).toThrow();
    expect(() => priceCart([mug], { discount: { kind: "amount", amount: -1 } })).toThrow();
  });

  it("adds shipping to the total and to the VAT summary", () => {
    const t = priceCart([book], { shipping: { kind: "flat", price: 1299 } });
    expect(t.shippingGross).toBe(1299);
    expect(t.totalGross).toBe(7980 + 1299);
    expect(t.vat.find((r) => r.rate === 23)?.gross).toBe(1299);
  });

  it("makes shipping free from a threshold, measured after discount", () => {
    const rule = { kind: "flat", price: 1299, freeFrom: 10000 } as const;
    expect(priceCart([{ ...mug, quantity: 2 }], { shipping: rule }).shippingGross).toBe(1299); // 99.98 < 100.00
    expect(priceCart([{ ...mug, unitGross: 5000, quantity: 2 }], { shipping: rule }).shippingGross).toBe(0); // exactly 100.00
    expect(priceCart([{ ...mug, unitGross: 5000, quantity: 2 }], { shipping: rule, discount: { kind: "amount", amount: 1 } }).shippingGross).toBe(1299);
  });

  it("rejects empty carts and bad lines", () => {
    expect(() => priceCart([])).toThrow();
    expect(() => priceCart([{ ...mug, quantity: 0 }])).toThrow();
    expect(() => priceCart([{ ...mug, quantity: 1.5 }])).toThrow();
    expect(() => priceCart([{ ...mug, unitGross: 9.99 }])).toThrow();
    expect(() => priceCart([{ ...mug, unitGross: -1 }])).toThrow();
    expect(() => priceCart([{ ...mug, vatRate: 19 as never }])).toThrow();
  });

  it("handles a free item", () => {
    const t = priceCart([{ ...mug, unitGross: 0 }]);
    expect(t.totalGross).toBe(0);
    expect(t.vat).toEqual([{ rate: 23, net: 0, vat: 0, gross: 0 }]);
  });
});

describe("computeShipping tiers", () => {
  const rule = {
    kind: "tiers",
    tiers: [
      { upTo: 5000, price: 999 },
      { upTo: 15000, price: 1499 },
      { upTo: null, price: 1999 },
    ],
    freeFrom: 30000,
  } as const;
  it("picks the first matching tier, boundaries inclusive", () => {
    expect(computeShipping(0, rule)).toBe(999);
    expect(computeShipping(5000, rule)).toBe(999);
    expect(computeShipping(5001, rule)).toBe(1499);
    expect(computeShipping(15000, rule)).toBe(1499);
    expect(computeShipping(15001, rule)).toBe(1999);
    expect(computeShipping(29999, rule)).toBe(1999);
    expect(computeShipping(30000, rule)).toBe(0);
  });
  it("fails loudly when no tier matches", () => {
    expect(() => computeShipping(10, { kind: "tiers", tiers: [{ upTo: 5, price: 1 }] })).toThrow();
  });
  it("returns 0 without a rule", () => {
    expect(computeShipping(100, undefined)).toBe(0);
  });
});
