import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
const token = process.env.BUSINESSFLOW_RLS_TEST_USER_TOKEN;
const foreignBusinessId = process.env.BUSINESSFLOW_RLS_TEST_FOREIGN_BUSINESS_ID;
const enabled = Boolean(url && key && token && foreignBusinessId);

test("RLS prevents a signed-in user from reading another owner's BusinessFlow records", { skip: !enabled }, async () => {
  const client = createClient(url, key, {
    auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
    global: { headers: { Authorization: "Bearer " + token } }
  });
  const checks = [
    ["businessflow_profiles","id","id"],
    ["businessflow_goals","id","business_id"],
    ["businessflow_experiments","id","business_id"],
    ["businessflow_memory","id","business_id"],
    ["businessflow_imports","id","business_id"],
    ["businessflow_conversations","id","business_id"]
  ];
  for (const [table,column,filter] of checks) {
    const { data,error } = await client.from(table).select(column).eq(filter,foreignBusinessId);
    assert.equal(error,null,table + " query should be allowed but filtered by RLS");
    assert.deepEqual(data,[],table + " must not expose another owner's records");
  }
});
