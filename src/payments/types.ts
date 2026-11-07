import type { Grosze } from "../money.js";

export type PaymentMethod = "blik" | "card" | "transfer";

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";

export interface CreatePaymentRequest {
  orderId: string;
  amount: Grosze;
  method: PaymentMethod;
  /** 6-digit BLIK code entered by the customer (BLIK is Poland's mobile payment scheme). */
  blikCode?: string;
  /** Provider-specific hints, e.g. the mock provider reads `scenario`. */
  metadata?: Record<string, string>;
}

export type NextAction =
  | { type: "redirect"; url: string }
  | { type: "confirm_in_banking_app" };

export interface CreatePaymentResult {
  paymentId: string;
  status: PaymentStatus;
  nextAction?: NextAction;
}

export type PaymentEventType = "payment.succeeded" | "payment.failed" | "payment.refunded";

/** Provider-neutral event produced by verifyWebhook. */
export interface PaymentEvent {
  /** Unique per event; the idempotency key. */
  id: string;
  type: PaymentEventType;
  paymentId: string;
  orderId: string;
  amount: Grosze;
  /** Monotonic per payment. Lets the consumer discard events that arrive late. */
  sequence: number;
  occurredAt: string;
}

export interface RefundResult {
  refundId: string;
  paymentId: string;
  amount: Grosze;
}

export type WebhookErrorCode = "bad_signature" | "bad_timestamp" | "bad_payload";

export class WebhookError extends Error {
  constructor(
    readonly code: WebhookErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WebhookError";
  }
}

export interface PaymentProvider {
  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;
  /** Verifies the signature over the RAW body and parses it. Throws WebhookError. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<PaymentEvent>;
  getStatus(paymentId: string): Promise<PaymentStatus>;
  refund(paymentId: string, amount?: Grosze): Promise<RefundResult>;
}
