import { hmacSha256Hex, timingSafeEqual } from "../crypto.js";
import { type Grosze, assertGrosze } from "../money.js";
import {
  type CreatePaymentRequest,
  type CreatePaymentResult,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentStatus,
  type RefundResult,
  WebhookError,
} from "./types.js";

export type MockScenario = "success" | "declined" | "delayed";

export const SIGNATURE_HEADER = "x-mock-signature";
export const TIMESTAMP_HEADER = "x-mock-timestamp";

export interface WebhookDelivery {
  body: string;
  headers: Record<string, string>;
}

interface MockPayment {
  id: string;
  orderId: string;
  amount: Grosze;
  method: PaymentMethod;
  status: PaymentStatus;
  refunded: Grosze;
  sequence: number;
}

export interface MockProviderOptions {
  secret: string;
  /** Injectable clock (milliseconds since epoch) for deterministic tests. */
  now?: () => number;
  /** How far a webhook timestamp may differ from now, in seconds. Default 300. */
  toleranceSeconds?: number;
}

/**
 * A fully working fake payment operator.
 *
 * Scenario selection (first match wins):
 *   1. metadata.scenario = "success" | "declined" | "delayed"
 *   2. BLIK code 222222 -> declined, 333333 -> delayed
 *   3. method default: blik and card succeed immediately, transfer is delayed
 *
 * "Delayed" payments stay pending until `settle()` is called, which stands in for the
 * customer finally confirming in their banking app or the transfer arriving.
 * Events are queued in an outbox and signed when taken with `takeDeliveries()`,
 * so a test or demo decides when (and how many times) they are delivered.
 */
export class MockProvider implements PaymentProvider {
  private readonly payments = new Map<string, MockPayment>();
  private outbox: PaymentEvent[] = [];
  private paymentCounter = 0;
  private eventCounter = 0;
  private readonly now: () => number;
  private readonly tolerance: number;

  constructor(private readonly options: MockProviderOptions) {
    this.now = options.now ?? Date.now;
    this.tolerance = options.toleranceSeconds ?? 300;
  }

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    assertGrosze(request.amount, "amount");
    if (request.amount <= 0) throw new RangeError("Payment amount must be positive");
    if (!["blik", "card", "transfer"].includes(request.method)) {
      throw new RangeError(`Unsupported payment method: ${request.method}`);
    }
    if (request.method === "blik" && !/^\d{6}$/.test(request.blikCode ?? "")) {
      throw new RangeError("BLIK code must be exactly 6 digits");
    }

    const id = `mock_pay_${++this.paymentCounter}`;
    const payment: MockPayment = {
      id,
      orderId: request.orderId,
      amount: request.amount,
      method: request.method,
      status: "pending",
      refunded: 0,
      sequence: 0,
    };
    this.payments.set(id, payment);

    const scenario = this.pickScenario(request);
    if (scenario === "success") this.resolve(payment, "payment.succeeded");
    else if (scenario === "declined") this.resolve(payment, "payment.failed");

    const nextAction =
      request.method === "blik"
        ? ({ type: "confirm_in_banking_app" } as const)
        : ({ type: "redirect", url: `https://mock-bank.invalid/pay/${id}` } as const);
    return { paymentId: id, status: payment.status, nextAction };
  }

  async getStatus(paymentId: string): Promise<PaymentStatus> {
    return this.mustGet(paymentId).status;
  }

  async refund(paymentId: string, amount?: Grosze): Promise<RefundResult> {
    const payment = this.mustGet(paymentId);
    if (payment.status !== "succeeded") {
      throw new Error(`Cannot refund a payment in status ${payment.status}`);
    }
    const value = amount ?? payment.amount - payment.refunded;
    assertGrosze(value, "refund amount");
    if (value <= 0 || value > payment.amount - payment.refunded) {
      throw new RangeError("Refund amount exceeds the refundable balance");
    }
    payment.refunded += value;
    if (payment.refunded === payment.amount) payment.status = "refunded";
    payment.sequence++;
    this.outbox.push(this.makeEvent(payment, "payment.refunded", value));
    return { refundId: `mock_ref_${paymentId}_${payment.sequence}`, paymentId, amount: value };
  }

  /** Demo/test helper: resolves a delayed payment. */
  settle(paymentId: string, outcome: "succeeded" | "failed" = "succeeded"): void {
    const payment = this.mustGet(paymentId);
    if (payment.status !== "pending") throw new Error(`Payment is already ${payment.status}`);
    this.resolve(payment, outcome === "succeeded" ? "payment.succeeded" : "payment.failed");
  }

  /** Signs and returns every queued event, emptying the outbox. */
  async takeDeliveries(): Promise<WebhookDelivery[]> {
    const events = this.outbox;
    this.outbox = [];
    return Promise.all(events.map((event) => this.sign(event)));
  }

  /** Signs an arbitrary event. Useful for replay and out-of-order tests. */
  async sign(event: PaymentEvent, timestampMs: number = this.now()): Promise<WebhookDelivery> {
    const body = JSON.stringify(event);
    const timestamp = Math.floor(timestampMs / 1000).toString();
    const signature = await hmacSha256Hex(this.options.secret, `${timestamp}.${body}`);
    return {
      body,
      headers: {
        "content-type": "application/json",
        [TIMESTAMP_HEADER]: timestamp,
        [SIGNATURE_HEADER]: `sha256=${signature}`,
      },
    };
  }

  async verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<PaymentEvent> {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
    const timestamp = lower[TIMESTAMP_HEADER];
    const signature = lower[SIGNATURE_HEADER];
    if (!timestamp || !signature) throw new WebhookError("bad_signature", "Missing signature headers");

    const expected = `sha256=${await hmacSha256Hex(this.options.secret, `${timestamp}.${rawBody}`)}`;
    if (!timingSafeEqual(expected, signature)) throw new WebhookError("bad_signature", "Signature mismatch");

    const ageSeconds = Math.abs(this.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > this.tolerance) {
      throw new WebhookError("bad_timestamp", "Timestamp outside the tolerance window");
    }
    return parseEvent(rawBody);
  }

  private pickScenario(request: CreatePaymentRequest): MockScenario {
    const explicit = request.metadata?.["scenario"];
    if (explicit === "success" || explicit === "declined" || explicit === "delayed") return explicit;
    if (request.method === "blik") {
      if (request.blikCode === "222222") return "declined";
      if (request.blikCode === "333333") return "delayed";
    }
    return request.method === "transfer" ? "delayed" : "success";
  }

  private resolve(payment: MockPayment, type: "payment.succeeded" | "payment.failed"): void {
    payment.status = type === "payment.succeeded" ? "succeeded" : "failed";
    payment.sequence++;
    this.outbox.push(this.makeEvent(payment, type, payment.amount));
  }

  private makeEvent(payment: MockPayment, type: PaymentEventType, amount: Grosze): PaymentEvent {
    return {
      id: `mock_evt_${++this.eventCounter}`,
      type,
      paymentId: payment.id,
      orderId: payment.orderId,
      amount,
      sequence: payment.sequence,
      occurredAt: new Date(this.now()).toISOString(),
    };
  }

  private mustGet(paymentId: string): MockPayment {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error(`Unknown payment: ${paymentId}`);
    return payment;
  }
}

function parseEvent(rawBody: string): PaymentEvent {
  let data: unknown;
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw new WebhookError("bad_payload", "Body is not valid JSON");
  }
  const e = data as Partial<PaymentEvent> | null;
  const types: PaymentEventType[] = ["payment.succeeded", "payment.failed", "payment.refunded"];
  if (
    !e ||
    typeof e.id !== "string" ||
    !types.includes(e.type as PaymentEventType) ||
    typeof e.paymentId !== "string" ||
    typeof e.orderId !== "string" ||
    !Number.isSafeInteger(e.amount) ||
    !Number.isSafeInteger(e.sequence) ||
    typeof e.occurredAt !== "string"
  ) {
    throw new WebhookError("bad_payload", "Unexpected event shape");
  }
  return e as PaymentEvent;
}
