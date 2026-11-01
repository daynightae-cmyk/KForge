import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { makeHandler } from "../src/router.mjs";
import { encryptionKey, pkceChallenge, randomToken, safeEquals, seal, sha256, unseal, verifyWebhook, webhookSignature } from "../src/crypto.mjs";

class MemoryStore {
  map = new Map(); rates = new Map();
  async set(key, value, ttl, nx = false) {
    if (nx && this.map.has(key)) return false;
    this.map.set(key, JSON.parse(JSON.stringify(value))); return true;
  }
  async get(key) { return this.map.has(key) ? structuredClone(this.map.get(key)) : null; }
  async consume(key) { const r=await this.get(key); this.map.delete(key); return r; }
  async del(key) { this.map.delete(key); }
  async replaceIf(key, oldValue, newValue) {
    if (JSON.stringify(this.map.get(key)) !== JSON.stringify(oldValue)) return false;
    this.map.set(key, structuredClone(newValue)); return true;
  }
  async deleteIf(key, oldValue) {
    if (JSON.stringify(this.map.get(key)) !== JSON.stringify(oldValue)) return false;
    this.map.delete(key); return true;
  }
  async limit(key, n) { const count=(this.rates.get(key) || 0)+1;this.rates.set(key,count);return count<=n; }
  async ping() { return true; }
}
const env={
  KFORGE_GITHUB_APP_ID:"5488053",
  KFORGE_GITHUB_CLIENT_ID:"Iv23litajK8fn7sEhMPf",
  KFORGE_GITHUB_CLIENT_SECRET:"s".repeat(40),
  KFORGE_PUBLIC_BASE_URL:"https://connect.knoux.store",
  KFORGE_SESSION_ENCRYPTION_KEY:randomBytes(32).toString("hex"),
  KFORGE_GITHUB_WEBHOOK_SECRET:"w".repeat(50),
  UPSTASH_REDIS_REST_URL:"https://unit-test.upstash.io", UPSTASH_REDIS_REST_TOKEN:"TEST_ONLY"
};
const account={ id:12345,login:"engineer", avatar_url:"https://avatars.githubusercontent.com/u/12345",html_url:"https://github.com/engineer" };
function fixture() {
  const store=new MemoryStore();
  const calls=[];
  let epoch=Date.now();
  const exchange=async(params)=>{
    calls.push({type:"exchange",params});
    if(params.grant_type==="refresh_token") return {access_token:"refreshed-token",refresh_token:"rotated-secret",expires_in:28800,refresh_token_expires_in:14000000};
    return {access_token:"top-secret-token",refresh_token:"top-secret-refresh",expires_in:28800,refresh_token_expires_in:14000000};
  };
  const apiGet=async(token,path)=>{
    calls.push({type:"api",token,path});
    if(path==="/user") return account;
    throw Error("Unexpected path "+path);
  };
  const apiPage=async(token,path)=>{
    calls.push({type:"api-page",token,path});
    if(path==="/user/installations?per_page=50&page=1") return {status:200,data:{installations:[{id:900,account:{login:"engineer"},target_type:"User",repository_selection:"selected"}],total_count:1}};
    if(path==="/user/installations/900/repositories?per_page=50&page=1") return {status:200,data:{repositories:[{id:2,full_name:"engineer/disposable-repo",private:true,default_branch:"main",html_url:"https://github.com/engineer/disposable-repo",permissions:{contents:"write"}}],total_count:1}};
    if(path.startsWith("/user/installations/")) return {status:404,data:null};
    if(path.startsWith("/user/installations?")) return {status:404,data:null};
    throw Error("Unexpected paged path "+path);
  };
  const handler=makeHandler({env,store,exchange,apiGet,apiPage,revoke:async()=>true,now:()=>epoch});
  async function send(path, body={},headers={}) {
    const res=await handler(new Request("https://connect.knoux.store"+path,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)}));
    return {res,value:await res.json()};
  }
  async function startAndAuthorize() {
    const start=await send("/api/auth/github/start");
    assert.equal(start.res.status,201);
    const location=new URL(start.value.authorization_url);
    assert.equal(location.origin,"https://github.com");
    assert.equal(location.searchParams.get("code_challenge_method"),"S256");
    const state=location.searchParams.get("state");
    const response=await handler(new Request("https://connect.knoux.store/auth/github/callback?code=valid-code&state="+state));
    assert.equal(response.status,200);
    return {start:start.value,location,state,response};
  }
  return {store,calls,handler,send,startAndAuthorize,advance:(ms)=>{epoch+=ms;}};
}

test("cryptography uses secure compare and authenticates cipher AAD",()=>{
  assert.equal(pkceChallenge("test"),"n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg");
  assert.equal(safeEquals(sha256("alpha"),sha256("alpha")),true);
  assert.equal(safeEquals(sha256("alpha"),sha256("beta")),false);
  const key=encryptionKey(env.KFORGE_SESSION_ENCRYPTION_KEY);
  const payload=seal(key,{token:"secret"},"id1");
  assert.deepEqual(unseal(key,payload,"id1"),{token:"secret"});
  assert.throws(()=>unseal(key,payload,"id2"));
  assert.equal(randomToken(32).length>=40,true);
});
test("HMAC webhook signature rejects tampered body and mismatched signature",()=>{
  const raw=Buffer.from('{"action":"opened"}');
  assert.equal(verifyWebhook(env.KFORGE_GITHUB_WEBHOOK_SECRET,raw,webhookSignature(env.KFORGE_GITHUB_WEBHOOK_SECRET,raw)),true);
  assert.equal(verifyWebhook(env.KFORGE_GITHUB_WEBHOOK_SECRET,Buffer.from("fake"),webhookSignature(env.KFORGE_GITHUB_WEBHOOK_SECRET,raw)),false);
  assert.equal(verifyWebhook(env.KFORGE_GITHUB_WEBHOOK_SECRET,raw,"sha256=bad"),false);
});
test("missing production configuration fails closed",async()=>{
  const broken=makeHandler({env:{},store:new MemoryStore()});
  assert.equal((await broken(new Request("https://connect.knoux.store/health"))).status,503);
  assert.equal((await broken(new Request("https://connect.knoux.store/api/auth/github/start",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}))).status,503);
});
test("OAuth start generates one-time state, PKCE and non-leaking proof",async()=>{
  const f=fixture(),start=await f.send("/api/auth/github/start");
  const query=new URL(start.value.authorization_url).searchParams;
  const record=await f.store.get("kforge:gh:state:"+query.get("state"));
  assert.ok(record.verifier);
  assert.equal(query.get("code_challenge"),pkceChallenge(record.verifier));
  assert.equal(JSON.stringify(f.store.map).includes(start.value.session_proof),false);
  assert.equal(start.value.authorization_url.includes(env.KFORGE_GITHUB_CLIENT_SECRET),false);
});
test("callback exchanges code once, never returns GitHub tokens to renderer",async()=>{
  const f=fixture(),{start,state}=await f.startAndAuthorize();
  assert.equal(f.calls[0].params.code_verifier.length>=40,true);
  const status=await f.send("/api/auth/github/status",{session_id:start.session_id,session_proof:start.session_proof});
  assert.equal(status.value.state,"CONNECTED");
  assert.equal(status.value.account.login,"engineer");
  assert.equal(JSON.stringify(status.value).includes("top-secret-token"),false);
  assert.equal((await f.handler(new Request("https://connect.knoux.store/auth/github/callback?code=valid-code&state="+state))).status,400);
  const session=await f.store.get("kforge:gh:session:"+start.session_id);
  assert.equal(JSON.stringify(session).includes("top-secret-token"),false);
});
test("rejected authorization leaves truthful denied state",async()=>{
  const f=fixture(),start=(await f.send("/api/auth/github/start")).value;
  const state=new URL(start.authorization_url).searchParams.get("state");
  const r=await f.handler(new Request("https://connect.knoux.store/auth/github/callback?state="+state+"&error=access_denied"));
  assert.equal(r.status,400);
  assert.equal((await f.send("/api/auth/github/status",{session_id:start.session_id,session_proof:start.session_proof})).value.state,"DENIED");
});
test("session cannot be accessed with wrong secret and browser origin",async()=>{
  const f=fixture(),{start}=await f.startAndAuthorize();
  assert.equal((await f.send("/api/auth/github/status",{session_id:start.session_id,session_proof:randomToken()})).res.status,401);
  assert.equal((await f.send("/api/auth/github/status",{session_id:start.session_id,session_proof:start.session_proof},{origin:"https://evil.example"})).res.status,403);
  assert.equal((await f.handler(new Request("https://connect.knoux.store/api/auth/github/status"))).status,405);
});
test("available installations and repositories are bound to authorized session",async()=>{
  const f=fixture(),{start}=await f.startAndAuthorize(),auth={session_id:start.session_id,session_proof:start.session_proof};
  const installs=await f.send("/api/github/installations",auth);
  assert.equal(installs.value.installations[0].id,900);
  assert.equal(installs.value.pagination.status,"COMPLETE");
  const denied=await f.send("/api/github/repositories",{...auth,installation_id:777});
  assert.equal(denied.res.status,200);
  assert.equal(denied.value.pagination.status,"DENIED");
  assert.equal(denied.value.pagination.reason,"INSTALLATION_NOT_ACCESSIBLE");
  assert.equal((await f.send("/api/github/repositories",{...auth,installation_id:900})).value.repositories[0].full_name,"engineer/disposable-repo");
});
test("listing pagination stays bounded and reports page provenance",async()=>{
  const f=fixture(),{start}=await f.startAndAuthorize(),auth={session_id:start.session_id,session_proof:start.session_proof};
  for (const invalid of [0,-3,1.5,21,50,"abc"]) {
    const bad=await f.send("/api/github/installations",{...auth,page:invalid});
    assert.equal(bad.res.status,400);
    assert.equal(bad.value.code,"INVALID_PAGE");
    const badRepos=await f.send("/api/github/repositories",{...auth,installation_id:900,page:invalid});
    assert.equal(badRepos.res.status,400);
    assert.equal(badRepos.value.code,"INVALID_PAGE");
  }
  const first=await f.send("/api/github/installations",auth);
  assert.equal(first.value.pagination.page,1);
  assert.equal(first.value.pagination.per_page,50);
  assert.equal(first.value.pagination.status,"COMPLETE");
  const repos=await f.send("/api/github/repositories",{...auth,installation_id:900});
  assert.equal(repos.value.pagination.page,1);
  assert.equal(repos.value.pagination.status,"COMPLETE");
});
test("late-page installations authorize through the installation endpoint itself",async()=>{
  const f=fixture(),{start}=await f.startAndAuthorize(),auth={session_id:start.session_id,session_proof:start.session_proof};
  // Installation 901 was never on the first installations page. Access is decided
  // upstream per installation endpoint, not by page-1 membership.
  const res=await f.send("/api/github/repositories",{...auth,installation_id:901});
  assert.equal(res.res.status,200);
  assert.equal(res.value.pagination.status,"DENIED");
});
test("multi-page upstream returns partial truth with a validated next page",async()=>{
  const store=new MemoryStore();
  const account={ id:12345, login:"engineer", avatar_url:"https://avatars.githubusercontent.com/u/12345", html_url:"https://github.com/engineer" };
  let epoch=Date.now();
  const exchange=async()=>{
    return {access_token:"top-secret-token",refresh_token:"top-secret-refresh",expires_in:28800,refresh_token_expires_in:14000000};
  };
  const apiPage=async(token,path)=>{
    if(path==="/user/installations?per_page=50&page=1") {
      return {status:200,data:{installations:Array.from({length:50},(_,i)=>({id:i+1,account:{login:"org"+i},target_type:"Organization",repository_selection:"all"})),total_count:52}};
    }
    if(path==="/user/installations?per_page=50&page=2") {
      return {status:200,data:{installations:[{id:51,account:{login:"late-org"},target_type:"Organization",repository_selection:"all"},{id:51,account:{login:"duplicate"},target_type:"Organization",repository_selection:"all"},{id:52,account:{login:"late-org2"},target_type:"Organization",repository_selection:"all"}],total_count:52}};
    }
    throw Error("Unexpected "+path);
  };
  const apiGet=async(token,path)=>{ if(path==="/user") return account; throw Error("Unexpected "+path); };
const handler=makeHandler({env,store,exchange,apiGet,apiPage,revoke:async()=>true,now:()=>epoch});
  const start=await handler(new Request("https://connect.knoux.store/api/auth/github/start",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
  const startValue=await start.json(); epoch=Date.now();
  await handler(new Request("https://connect.knoux.store/auth/github/callback?code=valid-code&state="+new URL(startValue.authorization_url).searchParams.get("state")));
  const auth={session_id:startValue.session_id,session_proof:startValue.session_proof};
   const send=async (body)=>{ const r=await handler(new Request("https://connect.knoux.store/api/github/installations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...auth,...body})})); return r.json(); };
  const first=await send({});
  assert.equal(first.pagination.status,"PARTIAL");
  assert.equal(first.pagination.reason,"MORE_PAGES");
  assert.equal(first.pagination.next_page,2);
  assert.equal(first.total_count,52);
  assert.equal(first.installations.length,50);
  const second=await send({page:2});
  assert.equal(second.pagination.status,"COMPLETE");
  assert.equal(second.pagination.next_page,null);
  assert.equal(second.installations.length,2);
  assert.equal(second.installations.some(i=>i.id===51),true);
});
test("rate limited listing preserves retry metadata without partial claims",async()=>{
  const store=new MemoryStore();
  let epoch=Date.now();
  const exchange=async()=>({access_token:"top-secret-token",refresh_token:"top-secret-refresh",expires_in:28800,refresh_token_expires_in:14000000});
  const apiGet=async(token,path)=>{ if(path==="/user") return account; throw Error("Unexpected "+path); };
  const apiPage=async()=> new Response(null,{status:429,headers:{"retry-after":"7"}});
  const handler=makeHandler({env,store,exchange,apiGet,apiPage,revoke:async()=>true,now:()=>epoch});
  const start=await handler(new Request("https://connect.knoux.store/api/auth/github/start",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
  const startValue=await start.json(); epoch=Date.now();
  await handler(new Request("https://connect.knoux.store/auth/github/callback?code=valid-code&state="+new URL(startValue.authorization_url).searchParams.get("state")));
  const auth={session_id:startValue.session_id,session_proof:startValue.session_proof};
  const installations=await handler(new Request("https://connect.knoux.store/api/github/installations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(auth)}));
  const value=await installations.json();
  assert.equal(installations.status,200);
  assert.equal(value.pagination.status,"RATE_LIMITED");
  assert.equal(value.pagination.retry_after_seconds,7);
  assert.equal(value.installations.length,0);
  const repos=await handler(new Request("https://connect.knoux.store/api/github/repositories",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...auth,installation_id:900})}));
  const reposValue=await repos.json();
  assert.equal(reposValue.pagination.status,"RATE_LIMITED");
  assert.equal(reposValue.pagination.reason,"GITHUB_RATE_LIMITED");
});
test("malformed and unavailable upstream pages stay partial, never invented",async()=>{
  const f=fixture(),{start}=await f.startAndAuthorize(),auth={session_id:start.session_id,session_proof:start.session_proof};
  const failingStore=new MemoryStore();
  let epoch=Date.now();
  const exchange=async()=>({access_token:"top-secret-token",refresh_token:"top-secret-refresh",expires_in:28800,refresh_token_expires_in:14000000});
  const apiGet=async(token,path)=>{ if(path==="/user") return account; throw Error("Unexpected "+path); };
  const handler500=makeHandler({env:{...env},store:failingStore,exchange,apiGet,apiPage:async()=>({status:500,data:null,retryAfter:null}),revoke:async()=>true,now:()=>epoch});
  assert.equal((await handler500(new Request("https://connect.knoux.store/api/auth/github/start",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}))).status,201);
  const partialRes=await handler500(new Request("https://connect.knoux.store/api/github/installations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({session_id:"placeholder",session_proof:"placeholder"})}));
  void partialRes;
  const handlerMalformed=makeHandler({env,store:new MemoryStore(),exchange,apiGet,
    apiPage:async()=>({status:200,data:{unexpected:"shape"},retryAfter:null}),
    revoke:async()=>true,now:()=>epoch});
  const s2=await handlerMalformed(new Request("https://connect.knoux.store/api/auth/github/start",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
  const s2Value=await s2.json(); epoch=Date.now();
  await handlerMalformed(new Request("https://connect.knoux.store/auth/github/callback?code=valid-code&state="+new URL(s2Value.authorization_url).searchParams.get("state")));
  const auth2={session_id:s2Value.session_id,session_proof:s2Value.session_proof};
  const malformed=await handlerMalformed(new Request("https://connect.knoux.store/api/github/installations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(auth2)}));
  const malformedValue=await malformed.json();
  assert.equal(malformed.status,200);
  assert.equal(malformedValue.pagination.status,"PARTIAL");
  assert.equal(malformedValue.pagination.reason,"MALFORMED_RESPONSE");
  assert.equal(malformedValue.installations.length,0);
});
test("upstream transport failure fails closed without leaking detail",async()=>{
  const store=new MemoryStore();
  let epoch=Date.now();
  const exchange=async()=>({access_token:"top-secret-token",refresh_token:"top-secret-refresh",expires_in:28800,refresh_token_expires_in:14000000});
  const apiGet=async(token,path)=>{ if(path==="/user") return account; throw Error("Unexpected "+path); };
  const apiPage=async()=>{ const abort=new Error("The operation was aborted"); abort.name="AbortError"; throw abort; };
  const handler=makeHandler({env,store,exchange,apiGet,apiPage,revoke:async()=>true,now:()=>epoch});
  const start=await handler(new Request("https://connect.knoux.store/api/auth/github/start",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
  const startValue=await start.json(); epoch=Date.now();
  await handler(new Request("https://connect.knoux.store/auth/github/callback?code=valid-code&state="+new URL(startValue.authorization_url).searchParams.get("state")));
  const auth={session_id:startValue.session_id,session_proof:startValue.session_proof};
  const res=await handler(new Request("https://connect.knoux.store/api/github/installations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(auth)}));
  assert.equal(res.status,503);
  assert.equal(JSON.stringify(await res.json()).includes("aborted"),false);
});
test("token refresh rotates confidential state and preserves session",async()=>{
  const f=fixture(),{start}=await f.startAndAuthorize(),auth={session_id:start.session_id,session_proof:start.session_proof};
  f.advance(28800*1000-80_000);
  assert.equal((await f.send("/api/github/account",auth)).value.account.login,"engineer");
  assert.equal(f.calls.some(c=>c.type==="exchange"&&c.params.grant_type==="refresh_token"),true);
  assert.equal((await f.send("/api/github/account",auth)).res.status,200);
});
test("disconnect removes session without pretending remote revocation",async()=>{
  const f=fixture(),{start}=await f.startAndAuthorize(),auth={session_id:start.session_id,session_proof:start.session_proof};
  const done=await f.send("/api/auth/github/disconnect",auth);
  assert.equal(done.value.disconnected,true);
  assert.equal(done.value.remote_revocation,"REVOKED");
  assert.equal((await f.send("/api/github/account",auth)).res.status,401);
});
test("signed webhook records once without claiming repository synchronized",async()=>{
  const f=fixture(),body=Buffer.from(JSON.stringify({repository:{full_name:"engineer/repo"},action:"opened",installation:{id:900}}));
  const headers={"x-hub-signature-256":webhookSignature(env.KFORGE_GITHUB_WEBHOOK_SECRET,body),"x-github-delivery":"11111111-1111-1111-1111-111111111111","x-github-event":"pull_request","content-type":"application/json"};
  const request=()=>new Request("https://connect.knoux.store/api/github/webhook",{method:"POST",headers,body});
  const r=await f.handler(request());assert.equal(r.status,202);assert.equal((await r.json()).processing,"RECORDED_ONLY");
  const r2=await f.handler(request());assert.equal(r2.status,200);assert.equal((await r2.json()).duplicate,true);
  assert.equal((await f.store.get("kforge:gh:delivery:11111111-1111-1111-1111-111111111111")).state,"RECEIVED_UNPROCESSED");
  const bad=await f.handler(new Request("https://connect.knoux.store/api/github/webhook",{method:"POST",headers,body:"fake"}));
  assert.equal(bad.status,401);
});
test("rate limiting is durable across connection attempts",async()=>{
  const f=fixture();
  for(let i=0;i<15;i++)assert.equal((await f.send("/api/auth/github/start")).res.status,201);
  assert.equal((await f.send("/api/auth/github/start")).res.status,429);
});
test("oversized untrusted payload fails closed",async()=>{
  const f=fixture();
  const r=await f.handler(new Request("https://connect.knoux.store/api/github/webhook",{method:"POST",body:"x".repeat(1024*1024+1)}));
  assert.equal(r.status,413);
});

