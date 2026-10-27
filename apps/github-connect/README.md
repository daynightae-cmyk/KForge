# KNOuX Forge Connect — production GitHub App backend (restricted until configured)

This is a **server-only** Node.js 24 / Vercel Functions service, isolated from the Windows Electron renderer and existing KForge Git engines. The source handles confidential OAuth credentials; it is **not a browser-rendered frontend**.

## Exact Vercel setup

| Setting | Value |
|---|---|
| Project | `knoux-forge-connect` |
| Repository | `daynightae-cmyk/KForge` (link only after review) |
| Production branch | `main` (only after CI acceptance) |
| Root Directory | `apps/github-connect` |
| Preset | **Other** / `framework: null` |
| Build Command | none |
| Output Directory | none |
| Runtime | Node.js 24.x |
| Production domain | `connect.knoux.store` |

`api/index.mjs` is the Vercel Function entry point. The `vercel.json` rewrites map public callback/setup and namespaced API routes to that one handler. This is not the KForge Express desktop engine.

### Server-only environment

| Key | Configuration |
|---|---|
| `KFORGE_GITHUB_APP_ID` | `5488053` (nonsecret) |
| `KFORGE_GITHUB_CLIENT_ID` | `Iv23litajK8fn7sEhMPf` (nonsecret) |
| `KFORGE_GITHUB_CLIENT_SECRET` | GitHub App Client Secret, **Vercel sensitive production environment only** |
| `KFORGE_GITHUB_WEBHOOK_SECRET` | Exact existing GitHub Webhook HMAC secret, **Vercel sensitive only** |
| `KFORGE_SESSION_ENCRYPTION_KEY` | 32 random bytes as **64 lowercase hex characters**, Vercel sensitive only |
| `KFORGE_PUBLIC_BASE_URL` | `https://connect.knoux.store` |
| `UPSTASH_REDIS_REST_URL` | Production, TLS-only durable Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash **standard** server-only token, Vercel sensitive only |

No secret is bundled with KForge Windows/Electron, stored in this repository, used in a Vercel public build, or printed in logs. Do **not** provision a short-lived scratch Redis for production.

**Strong encryption key:** Use PowerShell `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()` on a supported .NET version, or a portable script using Node `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Place the result directly in protected Vercel environment settings (not in chat or Git).

## Routing and behavior

| Method and path | Behavior |
|---|---|
| GET `/health` | 200 READY **only** when configuration is complete and durable store PING works; otherwise 503 |
| POST `/api/auth/github/start` | Native-only sign-in request; returns one-time desktop pairing id/proof + official GitHub browser URL |
| GET `/auth/github/callback` | Validates single-use OAuth state, PKCE verifier, actual GitHub token exchange and identity; renders static completion state |
| POST `/api/auth/github/status` | Reads connected status; no credentials returned to renderer |
| POST `/api/auth/github/disconnect` | Revokes GitHub token through configured app; drops server session and reports real revocation result |
| POST `/api/github/account` | Reads current user identity through authenticated GitHub API |
| POST `/api/github/installations` | Enumerates first page of installations visible to the actual user |
| POST `/api/github/repositories` | Verifies installation is in this user's accessible set before returning its first repository page |
| GET `/github/setup` | Safe informational page; does not falsely mark an installation connected |
| POST `/api/github/webhook` | Verifies raw HMAC-SHA256, consumes delivery idempotently (7-day TTL) and records receipt, **not executed sync** |

The service uses persistent Redis GETDEL for single-use OAuth state, CAS for refresh/disconnect, and SET NX for replay prevention. Session access and refresh tokens are encrypted with AES-256-GCM using the session key as authenticated additional data. Missing secrets or persistent storage fail **closed**.

## Required production acceptance before enabling Webhook Active

1. Store all secrets directly in Vercel, provision a permanent encrypted session store, and link the reviewed protected `main` branch.
2. Follow the actual Vercel DNS recommendation in Namecheap (without touching unrelated KNOUX domains). Confirm certificate and HTTPS on `connect.knoux.store`.
3. Run `node --test test/*.test.mjs` in this directory and root KForge quality gates.
4. Test real GitHub OAuth with a permitted account and confirm the actual app/installation permissions.
5. Verify real token expiration/refresh/revocation and replay behavior under concurrent requests.
6. Test GitHub signed Webhook delivery and invalid signature rejection, and inspect idempotent receipt evidence.
7. Test the Windows installed Electron flow, secure credential persistence and policy gating.
8. Only after receiving real evidence, enable GitHub webhook Active. Do **not** claim repository sync complete just because an event was recorded.

## Known limits that must not be hidden

- This backend does **not** perform repository Fetch/Pull/Push or local Git mutations. Reuse KForge's existing Git services for those operations with explicit project trust, safe credentials and confirmation.
- The webhook currently **records** a verified event; an external background dispatch/processing pipeline and desktop notification channel are still required for actual synchronization.
- Installation Setup is informational, not a completed installation-to-user binding workflow.
- Listing uses bounded first-page API calls; full cursor/pagination support is a follow-up.
- Production DNS, confidential values and a live end-to-end authorization cannot be tested using source code alone.

Status until real end-to-end verification: **IMPLEMENTED-NOT-VERIFIED / BLOCKED**. No fake readiness labels.
