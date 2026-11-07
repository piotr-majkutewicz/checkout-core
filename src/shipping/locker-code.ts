/**
 * EXAMPLE PATTERN ONLY: three letters, two or three digits, one or two letters (e.g. WAW123M).
 * This is an illustration of a plausible locker code shape. It is NOT an official
 * specification of any carrier. Replace it with the format your carrier documents.
 */
export const EXAMPLE_LOCKER_CODE_PATTERN = /^[A-Z]{3}\d{2,3}[A-Z]{1,2}$/;

export type LockerCodeCheck = { valid: true; code: string } | { valid: false; reason: string };

/** Trims, upper-cases and checks a customer-supplied locker code against a pattern. */
export function validateLockerCode(input: string, pattern: RegExp = EXAMPLE_LOCKER_CODE_PATTERN): LockerCodeCheck {
  const code = input.trim().toUpperCase();
  if (code === "") return { valid: false, reason: "Locker code is empty" };
  if (!pattern.test(code)) return { valid: false, reason: "Locker code has an unexpected format" };
  return { valid: true, code };
}
