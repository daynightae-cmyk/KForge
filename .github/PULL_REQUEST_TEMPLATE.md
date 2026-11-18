# Pull request

## Summary

<!-- What changed, and why? Link the verified gap or mission. -->

## Scope

- [ ] Product runtime
- [ ] Server/API
- [ ] Desktop/Electron
- [ ] Installer/release
- [ ] Documentation only
- [ ] Dependencies/CI

## Verification

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` (or documented environment limitation)
- [ ] `npm run verify:gate`

Desktop or release-sensitive changes:

- [ ] `npm run verify:desktop`
- [ ] `npm run package:windows`
- [ ] `npm run verify:installer`

## Evidence and truth

- Tested SHA:
- Authoritative workflow run:
- Known limitations or unavailable checks:
- [ ] No capability, provider, signing, update or remote state is claimed beyond the evidence in this pull request.

## Security

- [ ] No credentials, tokens, private keys, signing certificates or `.env` values are included.
- [ ] Security-sensitive changes preserve workspace trust, authority and confirmation boundaries.
