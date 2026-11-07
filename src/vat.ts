import { type Grosze, assertGrosze, roundDiv } from "./money.js";

/** Polish VAT rates (percent) supported by this library: 23, 8, 5 and 0. */
export const VAT_RATES = [23, 8, 5, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

export function assertVatRate(rate: number): asserts rate is VatRate {
  if (!(VAT_RATES as readonly number[]).includes(rate)) {
    throw new RangeError(`Unsupported VAT rate: ${rate}`);
  }
}

export interface VatSplit {
  net: Grosze;
  vat: Grosze;
  gross: Grosze;
}

/**
 * Splits a gross amount into net and VAT.
 *
 * Rounding rule: net = round_half_up(gross * 100 / (100 + rate)), vat = gross - net.
 * The gross amount is the source of truth (it is what the customer sees and pays),
 * and VAT is the remainder, so net + vat === gross always holds exactly.
 */
export function splitGross(gross: Grosze, rate: VatRate): VatSplit {
  assertGrosze(gross, "gross");
  assertVatRate(rate);
  const net = roundDiv(gross * 100, 100 + rate);
  return { net, vat: gross - net, gross };
}

/** Adds VAT to a net amount (for B2B prices): vat = round_half_up(net * rate / 100). */
export function fromNet(net: Grosze, rate: VatRate): VatSplit {
  assertGrosze(net, "net");
  assertVatRate(rate);
  const vat = roundDiv(net * rate, 100);
  return { net, vat, gross: net + vat };
}

export interface VatSummaryRow extends VatSplit {
  rate: VatRate;
}

/**
 * Summarises VAT per rate. Rounding happens once per rate group, on the summed
 * gross of that group, not per line. This keeps the rounding error to at most
 * half a grosz per rate and matches how an invoice summary is laid out
 * (one row per VAT rate). This is a design decision, not accounting advice.
 */
export function summarizeVat(lines: ReadonlyArray<{ gross: Grosze; rate: VatRate }>): VatSummaryRow[] {
  const groups = new Map<VatRate, Grosze>();
  for (const line of lines) {
    assertGrosze(line.gross, "gross");
    assertVatRate(line.rate);
    groups.set(line.rate, (groups.get(line.rate) ?? 0) + line.gross);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, gross]) => ({ rate, ...splitGross(gross, rate) }));
}
