# Security Policy

## KNOuX Forge Security Policy

Security is a core product boundary in KNOuX Forge. The application can access developer workspaces, local processes, Git operations, Preview runtimes, tool execution, and optional remote providers, so security state must never be promoted beyond evidence.

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |
| < 0.1.0 | ❌ |

Only the latest revision of the actively maintained release line receives security fixes.

## Reporting a Vulnerability

Do **not** disclose a suspected vulnerability through a public Issue, Discussion, Pull Request, or other public channel.

GitHub Private Vulnerability Reporting is enabled for this repository and is the preferred reporting channel. Open **Security → Advisories → Report a vulnerability** to start a private report.

`PRIVATE_VULNERABILITY_REPORTING=ENABLED`

`PRIVATE_VULNERABILITY_REPORTING_VERIFICATION=VERIFIED_VIA_GITHUB_API_2026-11-18`

If the private advisory workflow is temporarily unavailable, contact the maintainer through the corporate contact details in the repository README rather than opening a public issue.

Include enough information to reproduce and evaluate the issue without unrelated private data or credentials:

- affected KNOuX Forge version or commit SHA
- affected operating system
- affected component or file
- reproduction steps
- expected and observed behavior
- security impact
- relevant logs with secrets removed
- proof-of-concept details when safe

Never include passwords, access tokens, API keys, private certificates, signing keys, or unrelated user data.

## Security Scope

Reports are especially relevant when they involve:

- arbitrary command execution or shell-boundary bypass
- command execution outside the trusted workspace
- path traversal, symlink escape, or null-byte path manipulation
- privilege, project-trust, or permission bypass
- stale authorization or confirmation replay
- unintended process control
- Electron renderer-to-Node privilege exposure or unsafe IPC
- unrestricted external navigation or origin confusion
- secret or credential leakage
- insufficient log, trace, or evidence redaction
- remote-provider credential exposure
- unauthorized filesystem or Git access
- dependency or supply-chain compromise
- installer or release-integrity failure
- code-signing verification bypass
- incorrect elevation of release trust state
- any security control reporting false success

## Local-First Security Model

The absence of a cloud account, remote provider, or external authentication service must not weaken local security boundaries. Sensitive operations remain governed by explicit workspace trust, scoped execution authority, bounded filesystem access, process ownership, confirmation for dangerous actions, secret redaction, truthful provider states, and evidence-backed runtime/release status.

A missing credential or unavailable provider must never be represented as connected, verified, or successful.

## Secrets and Credentials

Secrets must never be committed to the repository. This includes API keys, access tokens, passwords, private keys, `.pfx`/`.p12` certificates, certificate passwords, provider credentials, and production environment files.

Provider credentials use the KForge credential boundary. On supported Windows desktop execution, persisted credentials are protected with the current-user OS protection mechanism; normal provider summaries, execution history, request inspectors, logs, traces, and project files must not contain plaintext provider keys. Where OS-protected persistence is unavailable, KForge must remain fail-closed or use explicitly ephemeral/environment-backed credentials rather than plaintext disk fallback.

## Windows Release Trust

KNOuX Forge distinguishes two independent facts:

1. whether signing material was configured during the build; and
2. what Authenticode state is observed on the actual artifact.

An existing EXE must be inspected as an artifact. A `Valid` Authenticode result must not be rewritten to `UNSIGNED` merely because the verification machine lacks CI signing secrets.

A `TRUSTED_RELEASE` still requires a valid Authenticode signature, signer identity evidence, artifact hash/provenance evidence, and every other configured release gate. Current absence of a production code-signing certificate must be reported as a blocker, not bypassed.

## Runtime HTTP and Desktop Hardening

The packaged Electron shell and the standalone production browser runtime serve the same built workbench under the same restrictive content security policy:

`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`

The policy permits only loopback Preview frames, blocks remote script and object embedding, forbids framing the KForge shell, and is asserted by automated tests. Development keeps Vite HMR usable and is not presented as the production policy. HSTS is intentionally not applied because the runtime is loopback HTTP only; adding it there would be header decoration rather than a transport boundary.

Production responses also set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy` that disables camera, microphone, geolocation, payment, USB, serial, HID and Bluetooth access.

Unhandled route failures terminate in a generic JSON boundary. The caller receives a stable error code and a generic message; stacks, absolute paths, request bodies and credential values stay server-side. Deliberate 4xx statuses are preserved, but their internal failure text is not echoed.

Desktop diagnostics are bounded: `desktop.log` rotates at 5 MB and keeps one `.1` backup, so a long-running or noisy Preview session cannot grow user data without limit. Rotation is best-effort and must never prevent the application from starting.

Desktop process lifecycle is fail-closed: the renderer is sandboxed with context isolation and no Node integration, permission requests are denied, navigation and external opens are validated, and only one product instance may run. Fatal main-process failures are redacted into the diagnostic log before the application exits; renderer crashes offer bounded reload recovery, and repeated crashes end in a clean quit that directs the operator to restart rather than leaving an unresponsive shell. Window placement is convenience state: it is validated against attached displays and ignored when corrupt or unreachable.

## Repository Security Controls

Verified on 2026-11-18:

- GitHub Private Vulnerability Reporting: **enabled**.
- Secret scanning and push protection: **enabled**.
- Dependabot alerts and Dependabot security updates: **enabled**.
- CodeQL code scanning: **enabled**; open findings remain classified and are not claimed as fixed without evidence.
- GitHub Actions references in the verification workflow remain pinned to immutable commit SHAs.
- `main` blocks force pushes and deletion and requires both verification gates; administrator bypass remains an explicit owner recovery path, so a green workflow proves the tested SHA rather than administrative enforcement.

Repository settings that require a paid GitHub security plan are not claimed as active. A security control is documented as enabled only after its actual state is observable.

## Dependency Security

Dependency updates must preserve reproducible locked installation, vulnerability auditing, reviewed lifecycle scripts, immutable GitHub Actions references where required, TypeScript verification, lint verification, automated tests, production build verification, browser acceptance, and Windows packaging verification.

Routine Dependabot version updates intentionally exclude semver-major migrations. Breaking majors are reviewed one at a time. Security fixes are not to be disabled by that maintenance policy. Lifecycle-script allowlisting remains exact and reviewed; a blocked unreviewed lifecycle script is a security control working as designed.

The production dependency graph must remain at **0 vulnerabilities** under `npm audit --omit=dev`. Development-only transitive findings are tracked and upgraded deliberately; they are never converted into a false production-clean claim. Historical research archives and test fixtures must not introduce third-party lockfiles whose vulnerable dependency ranges pollute the product security signal.

## Disclosure

Allow maintainers reasonable time to investigate and remediate a reported vulnerability before publishing technical details publicly. Confirmed vulnerabilities should be fixed, tested, and released with appropriate evidence before public disclosure whenever practical.

## Security Principle

> No security, provider, execution, signing, or release state may be promoted beyond the evidence that actually proves it.
