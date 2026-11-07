/**
 * SKELETON, UNVERIFIED. This file has never been run against any real payment operator.
 *
 * It only shows where each piece of a production adapter goes. Every endpoint, header name,
 * signature scheme and status mapping below is a placeholder you must replace by reading the
 * operator's documentation and testing against its sandbox with your own test account.
 */
import { type Grosze } from "../src/money.js";
import {
  type CreatePaymentRequest,
  type CreatePaymentResult,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentStatus,
  type RefundResult,
} from "../src/payments/types.js";

export interface ExampleOperatorConfig {
  baseUrl: string; // TODO: sandbox URL from the operator's docs
  merchantId: string; // TODO
  apiKey: string; // TODO: keep in a secret store, never in the repository
  webhookSecret: string; // TODO: how the operator signs notifications
}

export class ExampleOperatorProvider implements PaymentProvider {
  constructor(private readonly config: ExampleOperatorConfig) {}

  async createPayment(_request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    // TODO: map { amount (grosze), method } to the operator's "register transaction" call.
    // TODO: some operators want amounts as integer grosze, others as decimal strings. Convert
    //       at this boundary only, never inside the core.
    // TODO: return the operator's transaction id as paymentId and any redirect URL as nextAction.
    throw new Error("Not implemented: ExampleOperatorProvider.createPayment");
  }

  async verifyWebhook(_rawBody: string, _headers: Record<string, string>): Promise<PaymentEvent> {
    // TODO: verify the operator's signature over the RAW body with a constant-time comparison
    //       (see timingSafeEqual in src/crypto.ts), then throw WebhookError("bad_signature") on mismatch.
    // TODO: derive a stable event id. If the operator sends none, build one from
    //       transaction id + status + operator timestamp so retries produce the same id.
    // TODO: derive a monotonic sequence for stale-event detection (operator timestamp or version).
    // TODO: some operators require you to call back and verify the transaction; do that here.
    throw new Error("Not implemented: ExampleOperatorProvider.verifyWebhook");
  }

  async getStatus(_paymentId: string): Promise<PaymentStatus> {
    // TODO: query the operator and map its statuses onto pending | succeeded | failed | refunded.
    throw new Error("Not implemented: ExampleOperatorProvider.getStatus");
  }

  async refund(_paymentId: string, _amount?: Grosze): Promise<RefundResult> {
    // TODO: call the operator's refund endpoint; pass an idempotency key if it supports one.
    throw new Error("Not implemented: ExampleOperatorProvider.refund");
  }
}
