create index if not exists billing_customers_owner_user_idx
  on billing.customers (owner_user_id);
create index if not exists billing_subscriptions_product_plan_idx
  on billing.subscriptions (product_key, plan_key);
