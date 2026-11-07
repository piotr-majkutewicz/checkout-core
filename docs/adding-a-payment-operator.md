# Adding a real payment operator

The core never talks to an operator directly. It talks to `PaymentProvider` (`src/payments/types.ts`). A real adapter is one class implementing that interface.

> The skeleton in `examples/provider-adapter.skeleton.ts` is **unverified**. No part of it has been run against a real operator. You need a sandbox or test account with the operator to finish and verify an adapter. Do not ship an adapter that was only tested against the mock.

## Steps

1. **Get sandbox access** and read the operator's documentation for: registering a transaction, notification (webhook) format and signing, status codes, refunds, test credentials and test card or BLIK scenarios.
2. **Copy the skeleton** and fill in each `TODO`.
3. **`createPayment`**: convert `amount` (grosze) to whatever the operator wants (integer grosze or a decimal string) at this boundary only. Return the operator's transaction id as `paymentId` and a redirect URL or a "confirm in your banking app" hint as `nextAction`.
4. **`verifyWebhook`**: verify the signature over the **raw** body with `timingSafeEqual` from `src/crypto.ts`, throw `WebhookError("bad_signature")` on mismatch, then map the notification to a `PaymentEvent`:
   - `id` must be stable across operator retries. If the operator sends no event id, derive one from transaction id, status and the operator's timestamp.
   - `sequence` must grow per payment so stale events can be dropped. Use an operator version or timestamp if there is no counter.
   - Some operators ask you to confirm a notification by calling their API. Do that here.
5. **`getStatus`**: map operator statuses to `pending | succeeded | failed | refunded`. Use it for reconciliation (for example a scheduled job for orders stuck in `awaiting_payment`).
6. **`refund`**: pass an idempotency key if the operator supports one, and keep partial refunds consistent with the order total.
7. **Wire it up** by passing your provider to `handleWebhook(provider, store, rawBody, headers)` in your webhook route. Respond with 2xx for anything authentic (including `ignored` and `duplicate` outcomes) and 4xx only for failed verification.
8. **Replace the in-memory store** with a database implementation of `OrderStore`. `update` must be an atomic read-modify-write.
9. **Test against the sandbox**: success, decline, a notification delivered twice, a notification delivered late, a refund. The tests in `test/payments.test.ts` are a good checklist to port.
10. **Secrets** (API keys, webhook secrets) go in your platform's secret store, never in the repository or in `wrangler.jsonc`.
