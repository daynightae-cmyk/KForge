"use strict";
const fs = require("node:fs"), path = require("node:path");
const BASE = "https://connect.knoux.store", CLIENT_ID = "Iv23litajK8fn7sEhMPf";
function permitted(workspaceRoot) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".kforge", "local-platform.json"), "utf8"));
    return v.mode === "online-optional" || v.mode === "online";
  } catch { return false; }
}
function createGitHubConnect({ safeStorage, userDataRoot, workspaceRoot, external, transport = fetch }) {
  const destination = path.join(userDataRoot, "github-connect.session");
  function read() {
    if (!fs.existsSync(destination)) return null;
    if (!safeStorage.isEncryptionAvailable()) throw Error("Secure Windows credential storage unavailable");
    const v = JSON.parse(fs.readFileSync(destination, "utf8"));
    if (v.version !== 1 || typeof v.encrypted !== "string" || v.encrypted.length > 4096) throw Error("Invalid local GitHub session");
    const session = JSON.parse(safeStorage.decryptString(Buffer.from(v.encrypted, "base64")));
    if (!/^[\w-]{32,96}$/.test(session.session_id||"") || !/^[\w-]{40,128}$/.test(session.session_proof||"")) throw Error("Invalid GitHub credentials");
    return session;
  }
  function clear() { if (fs.existsSync(destination)) fs.rmSync(destination); }
  function persist(session) {
    if (!safeStorage.isEncryptionAvailable()) throw Error("Secure Windows credential storage unavailable");
    fs.mkdirSync(userDataRoot,{recursive:true});
    const encrypted=safeStorage.encryptString(JSON.stringify(session)).toString("base64");
    const temp=destination+"."+process.pid+".tmp";
    try {fs.writeFileSync(temp,JSON.stringify({version:1,encrypted}),{flag:"wx",mode:0o600});fs.renameSync(temp,destination);}
    finally {if(fs.existsSync(temp)) fs.rmSync(temp);}
  }
  async function call(endpoint,data) {
    if (!/^\/api\/(?:auth\/github|github)\/[\w-]+$/.test(endpoint)) throw Error("Endpoint not allowed");
    const response=await transport(BASE+endpoint,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify(data),signal:AbortSignal.timeout(14000)});
    const body=await response.json().catch(()=>({}));
    if(!response.ok) throw Error(typeof body.code==="string"&&/^[A-Z_]+$/.test(body.code)?body.code:"GITHUB_CONNECT_UNAVAILABLE");
    return body;
  }
  function requireOnline() { if(!permitted(workspaceRoot)) throw Error("Enable Online Optional or Online in KForge System settings before GitHub contact."); }
  function credentials(){const s=read();if(!s) throw Error("GitHub account not connected");return s;}
  return Object.freeze({
    async start() {
      requireOnline();
      if(!safeStorage.isEncryptionAvailable()) throw Error("Secure Windows credential storage unavailable");
      const result=await call("/api/auth/github/start",{});
      const url=new URL(result.authorization_url);
      if(url.protocol!=="https:"||url.hostname!=="github.com"||url.pathname!=="/login/oauth/authorize"||url.searchParams.get("client_id")!==CLIENT_ID) throw Error("Untrusted GitHub authorization destination");
      const session={session_id:result.session_id,session_proof:result.session_proof};
      if(!/^[\w-]{32,96}$/.test(session.session_id||"")|| !/^[\w-]{40,128}$/.test(session.session_proof||"")) throw Error("Invalid server pairing reply");
      persist(session);
      try {await external(url.toString());} catch {clear();throw Error("Could not open system browser");}
      return {state:"PENDING",message:"Authorize in your browser, then choose Check Connection."};
    },
    async status() {
      const s=read();if(!s) return {state:"DISCONNECTED",account:null};
      if(!permitted(workspaceRoot)) return {state:"OFFLINE",account:null};
      try {return await call("/api/auth/github/status",s);} catch{return {state:"UNKNOWN",account:null,message:"GitHub Connect service unavailable or session invalid."};}
    },
    async installations(){requireOnline();return call("/api/github/installations",credentials());},
    async repositories(installationId){
      requireOnline();if(!Number.isSafeInteger(installationId)||installationId<1) throw Error("Invalid installation");
      return call("/api/github/repositories",{...credentials(),installation_id:installationId});
    },
    async disconnect() {
      const s=read();if(!s)return {disconnected:true,remote_revocation:"NOT_REQUIRED"};
      let result={disconnected:true,remote_revocation:"NOT_PERFORMED",detail:"Local session removed. Remote token may remain valid; revoke under GitHub Authorized Apps."};
      try {if(permitted(workspaceRoot))result=await call("/api/auth/github/disconnect",s);}
      finally {clear();}
      return result;
    },
  });
}
module.exports={createGitHubConnect,permitted};
