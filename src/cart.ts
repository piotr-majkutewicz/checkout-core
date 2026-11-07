import { type Grosze, assertNonNegativeGrosze, roundDiv } from "./money.js";
import { type VatRate, type VatSummaryRow, assertVatRate, summarizeVat } from "./vat.js";

export interface CartLine {
  sku: string;
  name: string;
  /** Unit price including VAT. */
  unitGross: Grosze;
  quantity: number;
  vatRate: VatRate;
}

/** Fixed amount off, or a percentage in basis points (1000 = 10.00%). */
export type Discount =
  | { kind: "amount"; amount: Grosze }
  | { kind: "percent"; basisPoints: number };

/**
 * Delivery cost rule. `freeFrom` is compared with the goods total after discount.
 * `tiers` are evaluated in order: the first tier whose `upTo` is >= the goods total
 * wins; `upTo: null` means "no upper limit".
 */
export type ShippingRule =
  | { kind: "flat"; price: Grosze; freeFrom?: Grosze }
  | { kind: "tiers"; tiers: ReadonlyArray<{ upTo: Grosze | null; price: Grosze }>; freeFrom?: Grosze };

export interface PricingOptions {
  discount?: Discount;
  shipping?: ShippingRule;
  /** VAT rate applied to the delivery fee. Defaults to 23. */
  shippingVatRate?: VatRate;
}

export interface PricedLine {
  sku: string;
  grossBeforeDiscount: Grosze;
  discount: Grosze;
  gross: Grosze;
}

export interface CartTotals {
  lines: PricedLine[];
  itemsGross: Grosze;
  discountTotal: Grosze;
  itemsAfterDiscount: Grosze;
  shippingGross: Grosze;
  totalGross: Grosze;
  vat: VatSummaryRow[];
  totalNet: Grosze;
  totalVat: Grosze;
}

export function computeDiscount(itemsGross: Grosze, discount: Discount | undefined): Grosze {
  if (!discount) return 0;
  if (discount.kind === "amount") {
    assertNonNegativeGrosze(discount.amount, "discount");
    return Math.min(discount.amount, itemsGross);
  }
  const bp = discount.basisPoints;
  if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) {
    throw new RangeError("basisPoints must be an integer between 0 and 10000");
  }
  return roundDiv(itemsGross * bp, 10_000);
}

export function computeShipping(itemsAfterDiscount: Grosze, rule: ShippingRule | undefined): Grosze {
  if (!rule) return 0;
  if (rule.freeFrom !== undefined) {
    assertNonNegativeGrosze(rule.freeFrom, "freeFrom");
    if (itemsAfterDiscount >= rule.freeFrom) return 0;
  }
  if (rule.kind === "flat") {
    assertNonNegativeGrosze(rule.price, "shipping price");
    return rule.price;
  }
  for (const tier of rule.tiers) {
    assertNonNegativeGrosze(tier.price, "tier price");
    if (tier.upTo === null || itemsAfterDiscount <= tier.upTo) return tier.price;
  }
  throw new RangeError("No shipping tier matches; add a final tier with upTo: null");
}

/**
 * Largest remainder allocation: splits `total` across `weights` proportionally,
 * with integer shares that sum exactly to `total`. Ties go to the earlier index.
 */
export function allocate(total: Grosze, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const bigTotal = BigInt(total);
  const bigSum = BigInt(sum);
  const shares = weights.map((w) => (bigTotal * BigInt(w)) / bigSum);
  const remainders = weights.map((w, i) => ({ i, r: (bigTotal * BigInt(w)) % bigSum }));
  let left = Number(bigTotal - shares.reduce((a, b) => a + b, 0n));
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const result = shares.map(Number);
  for (const { i } of remainders) {
    if (left <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    left--;
  }
  return result;
}

export function priceCart(lines: readonly CartLine[], options: PricingOptions = {}): CartTotals {
  if (lines.length === 0) throw new RangeError("Cart is empty");
  const shippingVatRate = options.shippingVatRate ?? 23;
  assertVatRate(shippingVatRate);

  const lineGross = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(`Invalid quantity for ${line.sku}: ${line.quantity}`);
    }
    assertNonNegativeGrosze(line.unitGross, `unit price of ${line.sku}`);
    assertVatRate(line.vatRate);
    return line.unitGross * line.quantity;
  });

  const itemsGross = lineGross.reduce((a, b) => a + b, 0);
  const discountTotal = computeDiscount(itemsGross, options.discount);
  const shares = allocate(discountTotal, lineGross);

  const priced: PricedLine[] = lines.map((line, i) => ({
    sku: line.sku,
    grossBeforeDiscount: lineGross[i] ?? 0,
    discount: shares[i] ?? 0,
    gross: (lineGross[i] ?? 0) - (shares[i] ?? 0),
  }));

  const itemsAfterDiscount = itemsGross - discountTotal;
  const shippingGross = computeShipping(itemsAfterDiscount, options.shipping);

  const vatInput = lines.map((line, i) => ({ gross: priced[i]?.gross ?? 0, rate: line.vatRate }));
  if (shippingGross > 0) vatInput.push({ gross: shippingGross, rate: shippingVatRate });
  const vat = summarizeVat(vatInput);

  return {
    lines: priced,
    itemsGross,
    discountTotal,
    itemsAfterDiscount,
    shippingGross,
    totalGross: itemsAfterDiscount + shippingGross,
    vat,
    totalNet: vat.reduce((a, r) => a + r.net, 0),
    totalVat: vat.reduce((a, r) => a + r.vat, 0),
  };
}
