create or replace function public.billing_list_plans()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'plan_key', p.plan_key,
      'display_name', p.display_name,
      'billing_interval', p.billing_interval,
      'currency', p.currency,
      'unit_amount', p.unit_amount,
      'entitlements', p.entitlements
    ) order by p.unit_amount nulls first, p.plan_key),
    '[]'::jsonb
  )
  from billing.plans p
  where p.product_key = 'businessflow'
    and p.active = true;
$$;

revoke all on function public.billing_list_plans() from public, anon, authenticated;
grant execute on function public.billing_list_plans() to service_role;
