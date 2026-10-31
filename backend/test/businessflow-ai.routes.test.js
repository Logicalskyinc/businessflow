import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-publishable-key";

const { app } = await import("../src/server.js");
const server = app.listen(0);
await new Promise(resolve => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test("BusinessFlow AI health identifies the first-party engine honestly", async () => {
  const response = await fetch(baseUrl + "/api/v1/ai/health");
  const body = await response.json();
  assert.equal(response.status,200);
  assert.equal(body.engine,"businessflow_ai_rules_v1");
  assert.equal(body.externalProviderRequired,false);
  assert.equal(body.trainedLanguageModel,false);
});

for (const route of ["/analyze","/recommendations","/chat"]) {
  test(`BusinessFlow AI ${route} requires authentication`,async()=>{
    const response=await fetch(baseUrl+"/api/v1/ai"+route,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({business_id:"00000000-0000-4000-8000-000000000000",prompt:"Review revenue"})
    });
    assert.equal(response.status,401);
    assert.equal((await response.json()).error,"authentication_required");
  });
}

test.after(async()=>{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
