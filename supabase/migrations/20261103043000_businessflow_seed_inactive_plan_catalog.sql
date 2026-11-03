insert into billing.plans (product_key, plan_key, display_name, stripe_price_id, billing_interval, currency, unit_amount, entitlements, active) values
('businessflow','beginner','Beginner',null,null,null,null,'{"workspace_users":{"enabled":true,"limit":2},"integrations":{"enabled":true,"limit":2}}'::jsonb,false),
('businessflow','business','Business',null,null,null,null,'{"workspace_users":{"enabled":true,"limit":10},"integrations":{"enabled":true,"limit":5}}'::jsonb,false),
('businessflow','pro','Pro',null,null,null,null,'{"workspace_users":{"enabled":true,"limit":30},"integrations":{"enabled":true,"limit":15}}'::jsonb,false),
('businessflow','enterprise','Enterprise',null,null,null,null,'{"custom_limits":{"enabled":true},"priority_support":{"enabled":true}}'::jsonb,false)
on conflict (product_key,plan_key) do update set display_name=excluded.display_name, entitlements=excluded.entitlements, updated_at=now() where billing.plans.active=false;
drop function if exists public.billing_get_plan(text);
