import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";

export const billingRouter = Router();

let stripeInstance;
let billingClient;

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw Object.assign(new Error("Stripe is not configured."), { status: 503, code: "billing_not_configured" });
  }
  return stripeInstance ??= new Stripe(process.env.STRIPE_SECRET_KEY);
};

const getBillingClient = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error("Server-side billing access is not configured."), { status: 503, code: "billing_not_configured" });
  }
  // Use the default public schema only for service_role-only RPC wrappers.
  // The underlying billing tables remain in a private, unexposed schema.
  return billingClient ??= createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
};

async function getOwnedBusiness(request, businessId) {
  if (typeof businessId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
    throw Object.assign(new Error("A valid business_id is required."), { status: 400, code: "invalid_business_id" });
  }

  const { data, error } = await request.supabase
    .from("businessflow_profiles")
    .select("id,name,owner_user_id")
    .eq("id", businessId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.owner_user_id !== request.user.id) {
    throw Object.assign(new Error("Only the workspace owner can manage billing."), { status: 403, code: "billing_forbidden" });
  }
  return data;
}

async function getOrCreateCustomer(business, user) {
  const db = getBillingClient();
  const { data: existing, error } = await db.rpc("billing_get_customer", { p_business_id: business.id });
  if (error) throw error;
  if (existing) return existing;

  const created = await getStripe().customers.create({
    name: business.name,
    email: user.email || undefined,
    metadata: { product_key: "businessflow", business_id: business.id, owner_user_id: user.id }
  }, { idempotencyKey: "businessflow_customer_" + business.id });

  const { data: saved, error: saveError } = await db.rpc("billing_save_customer", {
    p_business_id: business.id,
    p_owner_user_id: user.id,
    p_stripe_customer_id: created.id
  });
  if (saveError) throw saveError;
  return saved;
}

function respondError(error, response, next) {
  if (error?.status) {
    return response.status(error.status).json({
      error: error.code || "billing_request_failed",
      message: error.message
    });
  }
  return next(error);
}

billingRouter.use(requireAuthenticatedUser);

billingRouter.post("/customer", async (request, response, next) => {
  try {
    const business = await getOwnedBusiness(request, request.body?.business_id);
    const stripeCustomerId = await getOrCreateCustomer(business, request.user);
    return response.json({ status: "ok", customer: { business_id: business.id, stripe_customer_id: stripeCustomerId } });
  } catch (error) { return respondError(error, response, next); }
});

billingRouter.post("/checkout", async (request, response, next) => {
  try {
    const business = await getOwnedBusiness(request, request.body?.business_id);
    const planKey = request.body?.plan_key;
    if (typeof planKey !== "string" || !/^[a-z][a-z0-9_-]{1,63}$/.test(planKey)) {
      return response.status(400).json({ error: "invalid_plan_key" });
    }

    const db = getBillingClient();
    const { data: plan, error: planError } = await db.rpc("billing_get_plan", { p_plan_key: planKey });
    if (planError) throw planError;
    if (!plan?.stripe_price_id) return response.status(404).json({ error: "plan_unavailable" });

    const { data: hasSubscription, error: subscriptionError } = await db.rpc("billing_has_current_subscription", {
      p_business_id: business.id
    });
    if (subscriptionError) throw subscriptionError;
    if (hasSubscription) {
      return response.status(409).json({ error: "subscription_exists", message: "Manage the current subscription in the billing portal." });
    }

    const idempotencyKey = request.get("idempotency-key");
    if (typeof idempotencyKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return response.status(400).json({ error: "idempotency_key_required", message: "Send a unique UUID in the Idempotency-Key header." });
    }

    const customerId = await getOrCreateCustomer(business, request.user);
    const successUrl = process.env.BILLING_CHECKOUT_SUCCESS_URL;
    const cancelUrl = process.env.BILLING_CHECKOUT_CANCEL_URL;
    if (!successUrl || !cancelUrl) {
      throw Object.assign(new Error("Checkout return URLs are not configured."), { status: 503, code: "billing_not_configured" });
    }

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: business.id,
      metadata: { product_key: "businessflow", business_id: business.id, plan_key: planKey },
      subscription_data: { metadata: { product_key: "businessflow", business_id: business.id, plan_key: planKey } },
      allow_promotion_codes: true
    }, { idempotencyKey: "businessflow_checkout_" + business.id + "_" + idempotencyKey });

    return response.status(201).json({ status: "created", checkout_url: session.url, session_id: session.id });
  } catch (error) { return respondError(error, response, next); }
});

billingRouter.post("/portal", async (request, response, next) => {
  try {
    const business = await getOwnedBusiness(request, request.body?.business_id);
    const returnUrl = process.env.BILLING_PORTAL_RETURN_URL;
    if (!returnUrl) {
      throw Object.assign(new Error("Billing portal return URL is not configured."), { status: 503, code: "billing_not_configured" });
    }
    const { data: customerId, error } = await getBillingClient().rpc("billing_get_customer", { p_business_id: business.id });
    if (error) throw error;
    if (!customerId) return response.status(404).json({ error: "billing_customer_not_found" });
    const session = await getStripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return response.json({ status: "ok", portal_url: session.url });
  } catch (error) { return respondError(error, response, next); }
});

billingRouter.get("/subscription", async (request, response, next) => {
  try {
    const business = await getOwnedBusiness(request, request.query.business_id);
    const { data, error } = await getBillingClient().rpc("billing_get_subscription", { p_business_id: business.id });
    if (error) throw error;
    return response.json({ status: "ok", subscription: data ?? null });
  } catch (error) { return respondError(error, response, next); }
});

billingRouter.get("/entitlements", async (request, response, next) => {
  try {
    const business = await getOwnedBusiness(request, request.query.business_id);
    const { data, error } = await getBillingClient().rpc("billing_get_entitlements", { p_business_id: business.id });
    if (error) throw error;
    return response.json({ status: "ok", entitlements: data ?? [] });
  } catch (error) { return respondError(error, response, next); }
});

export async function handleStripeWebhook(request, response) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return response.status(503).json({ error: "webhook_not_configured" });
  if (!Buffer.isBuffer(request.body)) return response.status(400).json({ error: "raw_body_required" });

  let event;
  try {
    event = getStripe().webhooks.constructEvent(request.body, request.get("stripe-signature"), webhookSecret);
  } catch {
    return response.status(400).json({ error: "invalid_webhook_signature" });
  }

  const object = event.data?.object;
  try {
    const db = getBillingClient();
    let subscription = null;
    if (event.type === "checkout.session.completed" && object.subscription) {
      subscription = await getStripe().subscriptions.retrieve(object.subscription);
    } else if (event.type.startsWith("customer.subscription.")) {
      // Fetch the current Stripe snapshot instead of trusting an old webhook payload.
      subscription = await getStripe().subscriptions.retrieve(object.id);
    }

    const { error } = await db.rpc("billing_process_stripe_event", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_livemode: event.livemode,
      p_object_id: object?.id ?? null,
      p_event_created: event.created,
      p_subscription: subscription
    });
    if (error) throw error;
    return response.json({ received: true });
  } catch (error) {
    try {
      await db.rpc("billing_mark_stripe_event_failed", {
        p_event_id: event.id,
        p_event_type: event.type,
        p_livemode: event.livemode,
        p_object_id: object?.id ?? null,
        p_error: String(error?.message ?? "Webhook processing failed").slice(0, 1000)
      });
    } catch { /* Preserve the processing error; Stripe will retry the webhook. */ }
    console.error("BusinessFlow Stripe webhook failed:", error);
    return response.status(500).json({ error: "webhook_processing_failed" });
  }
}
