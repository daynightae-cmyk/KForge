import { encryptionKey, pkceChallenge, randomToken, safeEquals, seal, sha256, unseal, verifyWebhook } from "./crypto.mjs";
import { RedisStore } from "./store.mjs";
import { githubGet, githubToken, githubRevoke, publicAccount } from "./github.mjs";

const SESSION_TTL = 60 * 60 * 24 * 30;
const PENDING_TTL = 600;
const MAX_JSON = 4096;
const MAX_WEBHOOK = 1024 * 1024;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" },
});
const reject = (code, status = 400) => json({ ok: false, code }, status);
const html = (content, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>KNOuX Forge Connect</title></head><body><main><h1>KNOuX Forge Connect</h1><p>${content}</p><p>Return to the KNOuX Forge desktop application.</p></main></body></html>`, {
  status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" },
});
const validSessionId = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{32,96}$/.test(id);
const validProof = (proof) => typeof proof === "string" && /^[a-zA-Z0-9_-]{40,128}$/.test(proof);
const sessionKey = (id) => `kforge:gh:session:${id}`;
const hasKeys = (env) => env.KFORGE_GITHUB_APP_ID === "5488053"
  && env.KFORGE_GITHUB_CLIENT_ID === "Iv23litajK8fn7sEhMPf"
  && typeof env.KFORGE_GITHUB_CLIENT_SECRET === "string" && env.KFORGE_GITHUB_CLIENT_SECRET.length >= 20
  && typeof env.KFORGE_GITHUB_WEBHOOK_SECRET === "string" && env.KFORGE_GITHUB_WEBHOOK_SECRET.length >= 32
  && env.KFORGE_PUBLIC_BASE_URL === "https://connect.knoux.store"
  && typeof env.UPSTASH_REDIS_REST_URL === "string" && env.UPSTASH_REDIS_REST_URL.startsWith("https://")
  && Boolean(env.UPSTASH_REDIS_REST_TOKEN);
const originBlocked = (req) => req.headers.has("origin") || req.headers.has("referer");
const method = (req, expected) => req.method === expected;
const forbiddenBrowser = (req) => req.method === "POST" && originBlocked(req);

async function readLimited(request, limit) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(declared) || declared < 0 || declared > limit) throw new RangeError("Payload too large");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError("Payload too large"); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}
async function bodyJson(request) {
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) throw new Error("JSON required");
  const bytes = await readLimited(request, MAX_JSON);
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Invalid payload");
  return parsed;
}

export function makeHandler({ env = process.env, store: providedStore, exchange = githubToken, apiGet = githubGet, revoke = githubRevoke, now = () => Date.now() } = {}) {
  const setupKey = () => encryptionKey(env.KFORGE_SESSION_ENCRYPTION_KEY);
  const store = () => providedStore || new RedisStore(env);
  const clientInfo = (req) => sha256((req.headers.get("x-vercel-forwarded-for") || "unknown").slice(0, 130));

  async function authorized(request, data) {
    if (!validSessionId(data.session_id) || !validProof(data.session_proof)) return null;
    const db = store();
    const key = sessionKey(data.session_id);
    const session = await db.get(key);
    if (!session || !safeEquals(sha256(data.session_proof), session.proofHash)) return null;
    return { session, key, db };
  }
  async function usableToken(connection) {
    const key = setupKey();
    const original = connection.session;
    if (original.state !== "CONNECTED" || !original.encrypted) throw new Error("Session not connected");
    const tokens = unseal(key, original.encrypted, connection.key);
    if (tokens.expiry > now() + 90_000) return tokens.access_token;
    if (!tokens.refresh_token || tokens.refresh_expiry <= now() + 120_000) throw new Error("Authorization expired; reconnect required");
    const lockKey = connection.key + ":refresh-lock";
    const nonce = randomToken();
    if (!await connection.db.set(lockKey, nonce, 30, true)) throw new Error("Token refresh underway; retry");
    try {
      const fresh = await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }, env);
      if (!fresh.refresh_token || !Number.isFinite(fresh.expires_in) || !Number.isFinite(fresh.refresh_token_expires_in) || fresh.expires_in <= 0 || fresh.refresh_token_expires_in <= 0) throw new Error("GitHub refresh response was incomplete");
      const updated = {
        ...original,
        encrypted: seal(key, {
          access_token: fresh.access_token,
          refresh_token: fresh.refresh_token,
          expiry: now() + fresh.expires_in * 1000,
          refresh_expiry: now() + fresh.refresh_token_expires_in * 1000,
        }, connection.key),
      };
      if (!await connection.db.replaceIf(connection.key, original, updated, SESSION_TTL)) throw new Error("Session changed during refresh");
      connection.session = updated;
      return fresh.access_token;
    } finally { await connection.db.deleteIf(lockKey, nonce).catch(() => {}); }
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    try {
      if (pathname === "/health" && method(request, "GET")) {
        if (!hasKeys(env)) return json({ service: "KNOuX Forge Connect", state: "NOT_CONFIGURED" }, 503);
        setupKey();
        const ready = await store().ping();
        return json({ service: "KNOuX Forge Connect", state: ready ? "READY" : "STORE_UNAVAILABLE" }, ready ? 200 : 503);
      }
      if (pathname === "/github/setup" && method(request, "GET")) {
        // installation_id in the URL is untrusted and never grants a session.
        return html("The GitHub App installation request was received. Verify installation access from the connected desktop session.");
      }
      if (pathname === "/auth/github/callback" && method(request, "GET")) {
        if (!hasKeys(env)) return html("Service configuration is unavailable.", 503);
        const state = url.searchParams.get("state");
        if (!state || !/^[\w-]{32,96}$/.test(state)) return html("Invalid authorization state.", 400);
        const db = store(), pending = await db.consume(`kforge:gh:state:${state}`);
        if (!pending) return html("Authorization expired or was already used.", 400);
        const current = await db.get(sessionKey(pending.id));
        if (!current || current.state !== "PENDING") return html("Authorization session is no longer active.", 409);
        const code = url.searchParams.get("code");
        if (!code || url.searchParams.has("error")) {
          await db.replaceIf(sessionKey(pending.id), current, { ...current, state: "DENIED" }, PENDING_TTL);
          return html("GitHub authorization was cancelled or denied.", 400);
        }
        try {
          if (!/^[a-zA-Z0-9_-]{4,300}$/.test(code)) throw new Error("Invalid code format");
          const token = await exchange({
            code, redirect_uri: env.KFORGE_PUBLIC_BASE_URL + "/auth/github/callback",
            code_verifier: pending.verifier,
          }, env);
          if (!token.refresh_token || !Number.isFinite(token.expires_in) || !Number.isFinite(token.refresh_token_expires_in)) throw new Error("Expiring GitHub user credentials are required");
          const account = publicAccount(await apiGet(token.access_token, "/user"));
          if (!Number.isSafeInteger(account.id) || !/^[\w-]{1,39}$/.test(account.login || "")) throw new Error("Account identity unavailable");
          const encrypted = seal(setupKey(), {
            access_token: token.access_token, refresh_token: token.refresh_token,
            expiry: now() + token.expires_in * 1000,
            refresh_expiry: now() + token.refresh_token_expires_in * 1000,
          }, sessionKey(pending.id));
          const committed = await db.replaceIf(sessionKey(pending.id), current,
            { ...current, state: "CONNECTED", account, encrypted }, SESSION_TTL);
          return committed ? html("GitHub authorization succeeded. Your desktop can now retrieve account status.") : html("Authorization session was cancelled.", 409);
        } catch {
          await db.replaceIf(sessionKey(pending.id), current, { ...current, state: "FAILED" }, PENDING_TTL);
          return html("GitHub authorization failed. Please restart the connection in the desktop application.", 502);
        }
      }
      if (pathname === "/api/github/webhook" && method(request, "POST")) {
        if (typeof env.KFORGE_GITHUB_WEBHOOK_SECRET !== "string" || env.KFORGE_GITHUB_WEBHOOK_SECRET.length < 32) return reject("WEBHOOK_UNCONFIGURED", 503);
        const raw = await readLimited(request, MAX_WEBHOOK);
        const signature = request.headers.get("x-hub-signature-256");
        if (!verifyWebhook(env.KFORGE_GITHUB_WEBHOOK_SECRET, raw, signature)) return reject("INVALID_SIGNATURE", 401);
        const delivery = request.headers.get("x-github-delivery") || "";
        const event = request.headers.get("x-github-event") || "";
        if (!/^[\w-]{16,100}$/.test(delivery) || !/^[a-z_]{1,40}$/.test(event)) return reject("INVALID_DELIVERY");
        const payload = JSON.parse(raw.toString("utf8"));
        const repo = payload.repository?.full_name;
        const record = { event, receivedAt: new Date(now()).toISOString(), installationId: payload.installation?.id || null,
          repository: typeof repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null,
          action: typeof payload.action === "string" ? payload.action.slice(0, 60) : null,
          state: "RECEIVED_UNPROCESSED" };
        const first = await store().set(`kforge:gh:delivery:${delivery}`, record, 604800, true);
        return json({ accepted: true, duplicate: !first, processing: "RECORDED_ONLY" }, first ? 202 : 200);
      }
      if (!pathname.startsWith("/api/auth/github/") && !pathname.startsWith("/api/github/")) return reject("NOT_FOUND", 404);
      if (!method(request, "POST")) return reject("METHOD_NOT_ALLOWED", 405);
      if (forbiddenBrowser(request)) return reject("BROWSER_ORIGIN_FORBIDDEN", 403);
      if (!hasKeys(env)) return reject("SERVICE_NOT_CONFIGURED", 503);
      setupKey();
      const db = store();
      const body = await bodyJson(request);
      if (pathname === "/api/auth/github/start") {
        if (!await db.limit("kforge:gh:rate:" + clientInfo(request), 15, 3600)) return reject("RATE_LIMITED", 429);
        const id = randomToken(24), proof = randomToken(32), state = randomToken(32), verifier = randomToken(32);
        const session = { proofHash: sha256(proof), state: "PENDING", createdAt: now() };
        if (!await db.set(sessionKey(id), session, PENDING_TTL, true)) return reject("SESSION_COLLISION", 503);
        if (!await db.set(`kforge:gh:state:${state}`, { id, verifier }, PENDING_TTL, true)) {
          await db.del(sessionKey(id)); return reject("STATE_COLLISION", 503);
        }
        const auth = new URL("https://github.com/login/oauth/authorize");
        for (const [key, value] of Object.entries({
          client_id: env.KFORGE_GITHUB_CLIENT_ID,
          redirect_uri: env.KFORGE_PUBLIC_BASE_URL + "/auth/github/callback",
          state, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256",
        })) auth.searchParams.set(key, value);
        return json({ state: "PENDING", session_id: id, session_proof: proof, authorization_url: auth.toString(), expires_in: PENDING_TTL }, 201);
      }
      const connection = await authorized(request, body);
      if (!connection) return reject("NOT_AUTHORIZED", 401);
      if (pathname === "/api/auth/github/status") {
        const s = connection.session;
        return json({ state: s.state, account: s.state === "CONNECTED" ? s.account : null });
      }
      if (pathname === "/api/auth/github/disconnect") {
        let remoteRevocation = "NOT_REQUIRED";
        if (connection.session.state === "CONNECTED") {
          try {
            const tokens = unseal(setupKey(), connection.session.encrypted, connection.key);
            remoteRevocation = await revoke(tokens.access_token, env) ? "REVOKED" : "FAILED";
          } catch { remoteRevocation = "FAILED"; }
        }
        const deleted = await connection.db.deleteIf(connection.key, connection.session);
        return json({ disconnected: deleted, remote_revocation: remoteRevocation,
          detail: remoteRevocation === "FAILED" ? "Local session invalidated; review authorized GitHub Apps to revoke remaining credentials." : null }, deleted ? 200 : 409);
      }
      if (pathname === "/api/github/account") {
        const token = await usableToken(connection);
        return json({ state: "CONNECTED", account: publicAccount(await apiGet(token, "/user")) });
      }
      if (pathname === "/api/github/installations") {
        const token = await usableToken(connection);
        const result = await apiGet(token, "/user/installations?per_page=50");
        return json({ installations: (result.installations || []).slice(0, 50).map(i => ({
          id: i.id, account: i.account?.login || null, target_type: i.target_type || null,
          repository_selection: i.repository_selection || null,
        })), total_count: result.total_count, pagination: "FIRST_PAGE_ONLY" });
      }
      if (pathname === "/api/github/repositories") {
        const id = Number(body.installation_id);
        if (!Number.isSafeInteger(id) || id < 1) return reject("INVALID_INSTALLATION");
        const token = await usableToken(connection);
        const access = await apiGet(token, "/user/installations?per_page=100");
        if (!(access.installations || []).some(i => i.id === id)) return reject("INSTALLATION_NOT_ALLOWED", 403);
        const result = await apiGet(token, `/user/installations/${id}/repositories?per_page=50`);
        return json({ installation_id: id, repositories: (result.repositories || []).slice(0, 50).map(r => ({
          id: r.id, full_name: r.full_name, private: r.private, default_branch: r.default_branch,
          html_url: r.html_url, permissions: r.permissions || {},
        })), total_count: result.total_count, pagination: "FIRST_PAGE_ONLY" });
      }
      return reject("NOT_FOUND", 404);
    } catch (error) {
      if (error instanceof RangeError) return reject("PAYLOAD_TOO_LARGE", 413);
      if (error instanceof SyntaxError) return reject("INVALID_JSON", 400);
      // Never echo secrets, response bodies, URLs, upstream messages, or stack traces.
      return reject("SERVICE_OPERATION_FAILED", 503);
    }
  };
}
