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

Repository automation could not independently prove that GitHub Private Vulnerability Reporting is enabled because the connected GitHub integration does not expose that administration endpoint. Therefore the current repository truth is:

`PRIVATE_VULNERABILITY_REPORTING=ADMIN_ACTION_REQUIRED`

`PRIVATE_VULNERABILITY_REPORTING_VERIFICATION=UNVERIFIED`

A repository administrator must verify or enable **Settings → Code security and analysis → Private vulnerability reporting**. When the repository Security page actually exposes **Advisories → Report a vulnerability**, that private workflow is the preferred reporting channel. The presence of this document alone must not be interpreted as proof that the button is enabled.

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

## Dependency Security

Dependency updates must preserve reproducible locked installation, vulnerability auditing, reviewed lifecycle scripts, immutable GitHub Actions references where required, TypeScript verification, lint verification, automated tests, production build verification, browser acceptance, and Windows packaging verification.

Routine Dependabot version updates intentionally exclude semver-major migrations. Breaking majors are reviewed one at a time. Security fixes are not to be disabled by that maintenance policy. Lifecycle-script allowlisting remains exact and reviewed; a blocked unreviewed lifecycle script is a security control working as designed.

## Disclosure

Allow maintainers reasonable time to investigate and remediate a reported vulnerability before publishing technical details publicly. Confirmed vulnerabilities should be fixed, tested, and released with appropriate evidence before public disclosure whenever practical.

## Security Principle

> No security, provider, execution, signing, or release state may be promoted beyond the evidence that actually proves it.
