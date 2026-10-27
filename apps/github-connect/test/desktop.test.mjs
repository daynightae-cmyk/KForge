import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const {createGitHubConnect,permitted} = require("../../../desktop/githubConnect.cjs");

function harness() {
  const root=mkdtempSync(path.join(tmpdir(),"knoux-connect-test-"));
  const workspace=path.join(root,"workspace");mkdirSync(path.join(workspace,".kforge"),{recursive:true});
  const urls=[];
  const safeStorage={
    isEncryptionAvailable:()=>true,
    encryptString:(plain)=>Buffer.from("MOCKENCRYPTED:"+plain),
    decryptString:(buffer)=>{const s=buffer.toString();assert.ok(s.startsWith("MOCKENCRYPTED:"));return s.slice(14);}
  };
  const transport=async (url,{body}) => {
    urls.push(url);
    if(url.endsWith("/start")) return new Response(JSON.stringify({
      session_id:"x".repeat(32),session_proof:"y".repeat(44),
      authorization_url:"https://github.com/login/oauth/authorize?client_id=Iv23litajK8fn7sEhMPf&state=z",
    }),{status:201});
    const obj=JSON.parse(body);
    assert.equal(obj.session_id,"x".repeat(32));
    assert.equal(obj.session_proof,"y".repeat(44));
    if(url.endsWith("/status"))return new Response(JSON.stringify({state:"CONNECTED",account:{id:77,login:"engineer"}}));
    if(url.endsWith("/installations"))return new Response(JSON.stringify({installations:[{id:12,account:"engineer"}]}));
    if(url.endsWith("/repositories"))return new Response(JSON.stringify({repositories:[],installation_id:obj.installation_id}));
    if(url.endsWith("/disconnect"))return new Response(JSON.stringify({disconnected:true,remote_revocation:"REVOKED"}));
    throw Error("unexpected route");
  };
  const bridge=createGitHubConnect({safeStorage,userDataRoot:root,workspaceRoot:workspace,transport,external:async url=>urls.push(url)});
  return {root,workspace,bridge,urls,online:()=>writeFileSync(path.join(workspace,".kforge","local-platform.json"),JSON.stringify({mode:"online-optional"})),cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test("desktop refuses GitHub contact in offline mode",async()=>{
  const h=harness();try {
    assert.equal(permitted(h.workspace),false);
    await assert.rejects(h.bridge.start(),/Online Optional/);
    assert.equal(h.urls.length,0);
    assert.equal((await h.bridge.status()).state,"DISCONNECTED");
  } finally{h.cleanup();}
});
test("native main keeps session capability encrypted, reads installations and disconnects",async()=>{
  const h=harness();try {
    h.online();
    assert.equal((await h.bridge.start()).state,"PENDING");
    assert.ok(h.urls.some(s=>s.startsWith("https://github.com/login/oauth/authorize")));
    const credential=readFileSync(path.join(h.root,"github-connect.session"),"utf8");
    assert.ok(!credential.includes("y".repeat(44)));
    assert.equal((await h.bridge.status()).account.login,"engineer");
    assert.equal((await h.bridge.installations()).installations[0].id,12);
    assert.equal((await h.bridge.repositories(12)).installation_id,12);
    await assert.rejects(h.bridge.repositories(-1),/Invalid installation/);
    assert.equal((await h.bridge.disconnect()).remote_revocation,"REVOKED");
    assert.equal((await h.bridge.status()).state,"DISCONNECTED");
  } finally{h.cleanup();}
});
test("revoked offline network policy prevents contact and never prevents local disconnect",async()=>{
  const h=harness();try{
    h.online();await h.bridge.start();
    writeFileSync(path.join(h.workspace,".kforge","local-platform.json"),JSON.stringify({mode:"offline"}));
    assert.equal((await h.bridge.status()).state,"OFFLINE");
    const total=h.urls.length;
    const result=await h.bridge.disconnect();
    assert.equal(result.remote_revocation,"NOT_PERFORMED");
    assert.equal(h.urls.length,total);
  }finally{h.cleanup();}
});
test("native secure storage failure refuses account authorization",async()=>{
  const h=harness();try{
    h.online();
    const secure=createGitHubConnect({safeStorage:{isEncryptionAvailable:()=>false},userDataRoot:h.root,workspaceRoot:h.workspace,external:async()=>{},transport:async()=>{throw Error("not called");}});
    await assert.rejects(secure.start(),/Secure Windows credential/);
  }finally{h.cleanup();}
});
