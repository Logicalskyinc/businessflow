import test from "node:test";
import assert from "node:assert/strict";
import { createStripeWebhookHandler } from "../src/modules/billing/billing.routes.js";

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function createRequest(signature = "valid-signature") {
  return {
    body: Buffer.from("{}"),
    get(name) {
      if (name.toLowerCase() === "stripe-signature") return signature;
      return undefined;
    }
  };
}

function createStripe(event, { invalidSignature = false } = {}) {
  return {
    webhooks: {
      constructEvent(_body, signature, secret) {
        assert.equal(signature, "valid-signature");
        assert.equal(secret, "whsec_test");
        if (invalidSignature) throw new Error("Invalid signature");
        return event;
      }
    },
    subscriptions: {
      async retrieve(id) { return { id, status: "active" }; }
    }
  };
}

function createEvent(type = "invoice.payment_succeeded") {
  return {
    id: "evt_test_123",
    type,
    livemode: false,
    created: 1_800_000_000,
    data: { object: { id: "in_test_123" } }
  };
}

function withWebhookSecret(callback) {
  const previous = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previous;
    });
}

test("rejects webhook requests without a raw Buffer body", async () => {
  await withWebhookSecret(async () => {
    const handler = createStripeWebhookHandler({
      getStripe: () => createStripe(createEvent()),
      getBillingClient: () => { throw new Error("Must not be called"); }
    });
    const response = createResponse();
    await handler({ body: "{}", get: () => "valid-signature" }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, "raw_body_required");
  });
});

test("rejects invalid Stripe webhook signatures without touching billing storage", async () => {
  await withWebhookSecret(async () => {
    const handler = createStripeWebhookHandler({
      getStripe: () => createStripe(createEvent(), { invalidSignature: true }),
      getBillingClient: () => { throw new Error("Must not be called"); }
    });
    const response = createResponse();
    await handler(createRequest(), response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, "invalid_webhook_signature");
  });
});

test("processes a valid webhook event", async () => {
  await withWebhookSecret(async () => {
    const calls = [];
    const db = {
      async rpc(name, args) {
        calls.push({ name, args });
        return { error: null };
      }
    };
    const handler = createStripeWebhookHandler({
      getStripe: () => createStripe(createEvent()),
      getBillingClient: () => db,
      logger: { error() { assert.fail("Unexpected error log"); } }
    });
    const response = createResponse();
    await handler(createRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { received: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "billing_process_stripe_event");
    assert.equal(calls[0].args.p_event_id, "evt_test_123");
  });
});

test("records processing failures and returns 500 so Stripe can retry", async () => {
  await withWebhookSecret(async () => {
    const calls = [];
    const db = {
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === "billing_process_stripe_event") {
          return { error: new Error("Database transaction failed") };
        }
        return { error: null };
      }
    };
    const logged = [];
    const handler = createStripeWebhookHandler({
      getStripe: () => createStripe(createEvent()),
      getBillingClient: () => db,
      logger: { error(...args) { logged.push(args); } }
    });
    const response = createResponse();
    await handler(createRequest(), response);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { error: "webhook_processing_failed" });
    assert.deepEqual(calls.map(call => call.name), [
      "billing_process_stripe_event",
      "billing_mark_stripe_event_failed"
    ]);
    assert.equal(calls[1].args.p_event_id, "evt_test_123");
    assert.match(calls[1].args.p_error, /Database transaction failed/);
    assert.equal(logged.length, 1);
  });
});

test("returns 500 without attempting failure recording when billing client initialization fails", async () => {
  await withWebhookSecret(async () => {
    let loggerCalled = false;
    const handler = createStripeWebhookHandler({
      getStripe: () => createStripe(createEvent()),
      getBillingClient: () => { throw new Error("Missing service configuration"); },
      logger: { error() { loggerCalled = true; } }
    });
    const response = createResponse();
    await handler(createRequest(), response);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { error: "webhook_processing_failed" });
    assert.equal(loggerCalled, true);
  });
});
