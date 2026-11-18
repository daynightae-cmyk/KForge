# Contributing to KNOuX Forge

KNOuX Forge is a local-first engineering command center. Contributions must preserve its evidence-first contract: a rendered surface is not proof of a working service, and a passing check is evidence only for its exact commit and tested scope.

## Before you start

1. Read [`AGENTS.md`](AGENTS.md) for the repository authority, architecture and change discipline.
2. Read [`RUN.md`](RUN.md) for the supported development, verification and packaging workflows.
3. Read [`SECURITY.md`](SECURITY.md) before touching trust, permissions, execution, providers or release behavior.
4. Read [`docs/KFORGE-CAPABILITY-MATRIX.md`](docs/KFORGE-CAPABILITY-MATRIX.md) before claiming that a capability is complete.

## Working rules

- `main` is authoritative. Do not create a parallel product shell or a duplicate capability center.
- Do not reintroduce removed starter/demo contracts or decorative mock data in production surfaces.
- Reuse canonical services and routes instead of adding parallel implementations.
- Never fabricate provider connectivity, credentials, runtime readiness, signing, updates or remote evidence.
- Keep `package.json` and `package-lock.json` synchronized through npm. Do not hand-edit the lockfile.
- Do not weaken `npm audit`, add broad vulnerability ignores, or bypass the exact lifecycle-script allowlist.
- Do not commit credentials, tokens, private keys, signing certificates or `.env` values.

## Verification

Run the repository-native checks for any substantive change:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run verify:gate
```

Desktop and release-sensitive changes must also preserve:

```bash
npm run verify:desktop
npm run package:windows
npm run verify:installer
```

GitHub Actions `KForge Verification Gate` is the authoritative cross-platform evidence. A local pass does not replace a green gate on the exact final SHA.

## Documentation

- Use the existing documents in `docs/` as the source of truth.
- Keep dated evidence clearly dated; do not rewrite a historical result into a current claim.
- When behavior changes, update the capability matrix and the relevant verification contract in the same change.
- `server/services/repositoryDocumentationTruth.spec.ts` enforces several documentation contracts. Fix the document, not the test.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow [`SECURITY.md`](SECURITY.md) and use GitHub Private Vulnerability Reporting.
