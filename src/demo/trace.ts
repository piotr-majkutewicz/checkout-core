/**
 * The "behind the scenes" log. Every API call that does something interesting appends entries,
 * and the response carries them to the UI. `kind` is a stable code (the UI maps it to a text in
 * the selected language); `data` is plain JSON that the UI shows as raw data on demand.
 */
export type TraceKind =
  | "cart_priced"
  | "order_created"
  | "payment_requested"
  | "payment_settled"
  | "webhook_sent"
  | "signature_ok"
  | "order_transition"
  | "webhook_duplicate"
  | "webhook_ignored"
  | "webhook_rejected"
  | "shipment_created"
  | "refund_requested"
  | "redelivered"
  | "forged_sent"
  | "stale_sent";

export interface TraceEntry {
  at: string;
  kind: TraceKind;
  data: Record<string, unknown>;
}

export interface Trace {
  readonly entries: TraceEntry[];
  add(kind: TraceKind, data?: Record<string, unknown>): void;
}

export function createTrace(now: () => Date): Trace {
  const entries: TraceEntry[] = [];
  return {
    entries,
    add(kind, data = {}) {
      entries.push({ at: now().toISOString(), kind, data });
    },
  };
}
