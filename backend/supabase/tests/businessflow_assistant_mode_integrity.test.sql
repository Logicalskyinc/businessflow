-- Run with Supabase CLI against a disposable local database after all migrations:
-- supabase test db
-- Fixtures are rolled back; this test never touches a hosted project.

begin;

select plan(4);

insert into auth.users (
  id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '10000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'bf-owner-one@example.test', '',
  '{}'::jsonb, '{}'::jsonb, now(), now()
),
(
  '10000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'bf-owner-two@example.test', '',
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.businessflow_profiles (
  id, owner_user_id, name
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Assistant mode test business'
);

insert into public.businessflow_conversations (
  id, business_id, created_by, title
) values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Assistant mode test'
);

insert into public.businessflow_messages (
  id, conversation_id, created_by, role, content,
  client_message_id, assistant_mode
) values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'user', 'Assess this business using OYOSKY.',
  '50000000-0000-4000-8000-000000000001',
  'oyosky'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$select public.businessflow_append_assistant_message(
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'This response must not be stored as Grey.',
    'grey'
  )$$,
  '42501',
  'assistant_mode_mismatch',
  'A reply cannot use a different assistant mode from its user message'
);

select is(
  (
    select (public.businessflow_append_assistant_message(
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'OYOSKY assessment response.',
      'oyosky'
    )).assistant_mode
  ),
  'oyosky',
  'A reply using the selected assistant mode is stored'
);

select throws_ok(
  $$select public.businessflow_append_assistant_message(
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'A second response with a different mode.',
    'businessflow'
  )$$,
  '42501',
  'assistant_mode_mismatch',
  'A later retry cannot change the original assistant mode'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  $$select public.businessflow_append_assistant_message(
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'Cross-tenant response.',
    'oyosky'
  )$$,
  '42501',
  'conversation_not_found',
  'A different authenticated owner cannot append to this conversation'
);

select * from finish();
rollback;
