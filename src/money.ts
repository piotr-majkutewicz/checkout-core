/**
 * Money is always an integer number of grosze (1 PLN = 100 grosze).
 * Floats never enter the system: every operation below works on safe integers.
 */
export type Grosze = number;

export function assertGrosze(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of grosze, got ${value}`);
  }
}

export function assertNonNegativeGrosze(value: number, label = "amount"): void {
  assertGrosze(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative, got ${value}`);
}

/**
 * Integer division rounded half away from zero. Denominator must be positive.
 * Example: roundDiv(5, 2) = 3, roundDiv(-5, 2) = -3, roundDiv(4, 3) = 1.
 */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError("roundDiv needs integers and a positive denominator");
  }
  if (numerator < 0) return -roundDiv(-numerator, denominator);
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Formats grosze as a Polish-style amount, e.g. 123456 -> "1 234,56 zł". */
export function formatPLN(amount: Grosze): string {
  assertGrosze(amount);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const zloty = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const grosze = (abs % 100).toString().padStart(2, "0");
  return `${sign}${zloty},${grosze} zł`;
}
