# Security Policy

## KNOuX Forge Security Policy

Security is treated as a core product boundary in KNOuX Forge.

KNOuX Forge is a local-first engineering command center with access to
developer workspaces, local processes, Git operations, Preview runtimes,
tool execution, and optional remote providers.

Security reports involving these boundaries are taken seriously.

---

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅ |
| < 0.1.0 | ❌ |

Only the latest revision of the actively maintained release line receives
security fixes.

Users should always update to the latest available KNOuX Forge release.

---

## Reporting a Vulnerability

Please do **not** disclose security vulnerabilities through a public GitHub
Issue, Discussion, Pull Request, or other public channel.

Use GitHub's private vulnerability reporting mechanism:

**Repository → Security → Advisories → Report a vulnerability**

Include enough information to reproduce and evaluate the issue without
including unrelated private data or credentials.

Useful information includes:

- affected KNOuX Forge version or commit SHA
- affected operating system
- affected component or file
- reproduction steps
- expected behavior
- observed behavior
- security impact
- relevant logs with secrets removed
- proof-of-concept details when safe to provide

Never include passwords, access tokens, API keys, private certificates,
signing keys, or unrelated user data.

---

## Security Scope

Reports are especially relevant when they involve:

- arbitrary command execution
- command execution outside the trusted workspace
- path traversal or workspace-root escape
- symlink-based workspace escape
- privilege or permission bypass
- project-trust bypass
- stale authorization or confirmation replay
- unintended process control
- Electron renderer-to-Node privilege exposure
- unsafe IPC exposure
- unrestricted external navigation
- secret or credential leakage
- insufficient log redaction
- remote-provider credential exposure
- unauthorized filesystem access
- unsafe Git operations
- dependency or supply-chain compromise
- installer or release integrity
- code-signing verification bypass
- incorrect elevation of release trust state
- security controls reporting false success

---

## Local-First Security Model

KNOuX Forge is designed as a local-first application.

The absence of a cloud account, remote provider, or external authentication
service must not silently weaken local security boundaries.

Sensitive operations should remain governed by:

- explicit workspace trust
- scoped execution authority
- bounded filesystem access
- process ownership
- explicit confirmation for dangerous operations
- secret redaction
- truthful provider states
- evidence-backed release and runtime status

A missing credential or unavailable provider must never be represented as
connected, verified, or successful.

---

## Secrets and Credentials

Secrets must never be committed to the repository.

This includes:

- API keys
- access tokens
- passwords
- private keys
- `.pfx` or `.p12` signing certificates
- certificate passwords
- provider credentials
- production environment files

KNOuX Forge configuration should use environment variables and protected
GitHub Actions secrets where applicable.

Security reports and diagnostic evidence must redact secret values.

---

## Windows Release Trust

KNOuX Forge distinguishes between unsigned and trusted releases.

An unsigned installer must not claim:

- Trusted Publisher status
- valid Authenticode identity
- SmartScreen reputation
- trusted code-signing status

`TRUSTED_RELEASE` status requires successful cryptographic signing and
verification.

Unsigned development or release-candidate artifacts must identify themselves
truthfully as unsigned.

---

## Dependency Security

The project uses automated dependency and CI verification.

Dependency updates must preserve:

- reproducible locked installation
- dependency vulnerability auditing
- reviewed lifecycle scripts
- immutable GitHub Actions references where required
- TypeScript verification
- lint verification
- automated tests
- production build verification
- browser acceptance tests
- Windows packaging verification

Security controls must not be weakened merely to make CI pass.

---

## Disclosure

Please allow maintainers reasonable time to investigate and remediate a
reported vulnerability before publishing technical details publicly.

Confirmed vulnerabilities should be fixed, tested, and released with
appropriate security evidence before public disclosure whenever practical.

---

## Security Principle

KNOuX Forge follows a simple rule:

> No security, provider, execution, signing, or release state may be promoted
> beyond the evidence that actually proves it.
