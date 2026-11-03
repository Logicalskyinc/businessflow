-- Reject Stripe subscriptions whose Price ID is not registered to a BusinessFlow plan.
-- This prevents an unmapped or unrelated Stripe Price from creating a subscription
-- with a NULL plan_key and accidentally clearing workspace entitlements.

create or replace function public.billing_process_stripe_event(
  p_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_object_id text,
  p_event_created bigint,
  p_subscription jsonb
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_processing_status text;
  v_customer_id text;
  v_business_id uuid;
  v_price_id text;
  v_plan_key text;
  v_plan_entitlements jsonb;
  v_status text;
  v_last_event_created bigint;
  v_item record;
  v_enabled boolean;
  v_limit bigint;
  v_value jsonb;
begin
  insert into billing.events (
    stripe_event_id, event_type, livemode, stripe_object_id, processing_status, received_at
  ) values (p_event_id, p_event_type, p_livemode, p_object_id, 'received', now())
  on conflict (stripe_event_id) do nothing;

  select e.processing_status into v_processing_status
  from billing.events e where e.stripe_event_id = p_event_id for update;

  if v_processing_status = 'processed' then
    return jsonb_build_object('received', true, 'duplicate', true);
  end if;

  if p_subscription is not null then
    v_customer_id := coalesce(p_subscription->>'customer', p_subscription->'customer'->>'id');
    v_price_id := p_subscription #>> '{items,data,0,price,id}';
    v_status := p_subscription->>'status';

    if v_customer_id is null or v_price_id is null or v_status is null then
      raise exception 'Stripe subscription snapshot is missing required fields';
    end if;

    select c.business_id into v_business_id from billing.customers c
    where c.stripe_customer_id = v_customer_id;
    if v_business_id is null then
      raise exception 'Stripe customer is not mapped to a BusinessFlow workspace';
    end if;

    select p.plan_key, p.entitlements into v_plan_key, v_plan_entitlements
    from billing.plan_prices pp
    join billing.plans p on p.id = pp.plan_id
    where p.product_key = 'businessflow' and pp.stripe_price_id = v_price_id
    limit 1;

    if v_plan_key is null then
      raise exception 'Stripe Price ID is not registered to a BusinessFlow plan';
    end if;

    select s.last_event_created into v_last_event_created
    from billing.subscriptions s
    where s.stripe_subscription_id = p_subscription->>'id'
    for update;

    if v_last_event_created is null or p_event_created >= v_last_event_created then
      insert into billing.subscriptions (
        business_id, product_key, plan_key, stripe_subscription_id,
        stripe_customer_id, stripe_price_id, status,
        current_period_start, current_period_end, cancel_at_period_end,
        canceled_at, trial_start, trial_end, ended_at, metadata,
        last_event_created, updated_at
      ) values (
        v_business_id, 'businessflow', v_plan_key, p_subscription->>'id',
        v_customer_id, v_price_id, v_status,
        case when nullif(p_subscription->>'current_period_start', '') is null then null
          else to_timestamp((p_subscription->>'current_period_start')::double precision) end,
        case when nullif(p_subscription->>'current_period_end', '') is null then null
          else to_timestamp((p_subscription->>'current_period_end')::double precision) end,
        coalesce((p_subscription->>'cancel_at_period_end')::boolean, false),
        case when nullif(p_subscription->>'canceled_at', '') is null then null
          else to_timestamp((p_subscription->>'canceled_at')::double precision) end,
        case when nullif(p_subscription->>'trial_start', '') is null then null
          else to_timestamp((p_subscription->>'trial_start')::double precision) end,
        case when nullif(p_subscription->>'trial_end', '') is null then null
          else to_timestamp((p_subscription->>'trial_end')::double precision) end,
        case when nullif(p_subscription->>'ended_at', '') is null then null
          else to_timestamp((p_subscription->>'ended_at')::double precision) end,
        case when jsonb_typeof(p_subscription->'metadata') = 'object'
          then p_subscription->'metadata' else '{}'::jsonb end,
        p_event_created, now()
      )
      on conflict (stripe_subscription_id) do update set
        business_id = excluded.business_id, plan_key = excluded.plan_key,
        stripe_customer_id = excluded.stripe_customer_id, stripe_price_id = excluded.stripe_price_id,
        status = excluded.status, current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
        canceled_at = excluded.canceled_at, trial_start = excluded.trial_start,
        trial_end = excluded.trial_end, ended_at = excluded.ended_at,
        metadata = excluded.metadata, last_event_created = excluded.last_event_created, updated_at = now();

      delete from billing.entitlements e where e.business_id = v_business_id;

      if v_status in ('active', 'trialing') and v_plan_entitlements is not null then
        for v_item in select key, value from jsonb_each(v_plan_entitlements)
        loop
          if jsonb_typeof(v_item.value) = 'object' then
            v_enabled := coalesce((v_item.value->>'enabled')::boolean, true);
            v_limit := case when coalesce(v_item.value->>'limit', '') ~ '^[0-9]+$'
              then (v_item.value->>'limit')::bigint else null end;
            v_value := case when jsonb_typeof(v_item.value->'value') = 'object'
              then v_item.value->'value' else '{}'::jsonb end;
          else
            v_enabled := v_item.value = 'true'::jsonb;
            v_limit := null;
            v_value := '{}'::jsonb;
          end if;
          insert into billing.entitlements (
            business_id, feature_key, enabled, limit_value, value, source_plan_key, updated_at
          ) values (v_business_id, v_item.key, v_enabled, v_limit, v_value, v_plan_key, now());
        end loop;
      end if;
    end if;
  end if;

  update billing.events set processing_status = 'processed',
    attempts = attempts + 1, last_error = null, processed_at = now()
  where stripe_event_id = p_event_id;
  return jsonb_build_object('received', true, 'duplicate', false);
end;
$function$;
