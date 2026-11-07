/**
 * Consumer rights expressed as data and arithmetic. THIS IS NOT LEGAL ADVICE.
 * The defaults reflect the commonly cited 14-day right of withdrawal for distance sales
 * in the EU/Poland, counted from the day the consumer takes possession of the goods.
 * Real rules have exceptions (custom-made goods, sealed hygiene products, digital content,
 * late information duties that extend the period, deadlines falling on a day off) that
 * this module does NOT model. Check with a lawyer before relying on it.
 */
export interface WithdrawalConfig {
  /** Length of the withdrawal period in calendar days. */
  days: number;
  /** Time zone used to decide which calendar day the goods were received. */
  timeZone: string;
}

export const DEFAULT_WITHDRAWAL_CONFIG: WithdrawalConfig = { days: 14, timeZone: "Europe/Warsaw" };

/** Calendar date (YYYY-MM-DD) of an instant in the given time zone. */
export function localDate(instant: Date | string, timeZone: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
  // The en-CA locale formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Last calendar day (inclusive, in the configured time zone) on which the customer can
 * withdraw. The day of receipt is day 0, so receipt on 1 March gives 15 March.
 */
export function withdrawalLastDay(receivedAt: Date | string, config: WithdrawalConfig = DEFAULT_WITHDRAWAL_CONFIG): string {
  if (!Number.isInteger(config.days) || config.days < 0) throw new RangeError("days must be a non-negative integer");
  return addDays(localDate(receivedAt, config.timeZone), config.days);
}

/** True while `at` still falls on or before the last day of the withdrawal period. */
export function isWithinWithdrawalPeriod(
  receivedAt: Date | string,
  at: Date | string,
  config: WithdrawalConfig = DEFAULT_WITHDRAWAL_CONFIG,
): boolean {
  const today = localDate(at, config.timeZone);
  const received = localDate(receivedAt, config.timeZone);
  return today >= received && today <= withdrawalLastDay(receivedAt, config);
}
