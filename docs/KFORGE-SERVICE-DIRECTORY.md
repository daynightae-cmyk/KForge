# KNOuX Forge service directory

The canonical information architecture of KForge lives in
`client/workbench/serviceDirectory.ts`. It is the single source of truth for
every user-facing destination in the workbench.

```
DOMAIN -> SECTION -> SERVICE -> PRIMARY ACTION -> HANDLER -> API
```

## Why this exists

The workbench exposes nine Activity Bar domains. Each domain owns a scoped
Explorer, and each Explorer entry is a **service**: one destination with one
owner, one description, one primary action and one real API contract. The
directory states that mapping once so the Explorer, the command palette, the
project service catalogue, the Inspector and the documentation cannot drift
apart.

An API endpoint is an implementation contract, not a service. The directory
therefore describes destinations a user can reach, not all registered routes.

## Contract of a service

| Field | Meaning |
| --- | --- |
| `activity` / `group` | The domain and the named section inside the domain. |
| `description` | What the service does, in product language. |
| `capability` | The user outcome the service delivers. |
| `context` | `global`, `project` or `optional`: the prerequisite of the destination, never a readiness claim. |
| `primaryAction` | The one action that best represents the service. |
| `handler` | The React module that owns the implementation. |
| `api` | The API contract the handler executes against. |

`client/workbench/serviceDirectory.spec.ts` enforces the contract:

- every navigable destination in `client/workbench/navigation.ts` has exactly
  one service entry, and every service has a destination;
- every declared `api` value is a route the Express server actually registers;
- every established contextual target still resolves to its owning service;
- the command palette can find a service by label, by domain and by intent.

`client/workbench/serviceAvailability.ts` derives the real availability of a
service from evidence KForge already owns: project presence, project trust,
the registered action descriptors, the Preview runtime state, provider
configuration, agent tool permissions and the operating mode. A service that
has no evidence is never reported as ready.

## Adding a service

1. Add the destination to `client/workbench/navigation.ts` with a meaningful
   section name, and classify it in `client/workbench/surfaceTypes.ts`.
2. Add the service entry in `client/workbench/serviceDirectory.ts` with a real
   description, capability, primary action, handler and API contract.
3. Implement the surface. The directory is a description of real behaviour; it
   must never describe work that does not exist.
4. Add the matching evidence test. The service inventory marks a destination
   `E2E_VERIFIED` only when an automated browser test opens it.

## Presentation

Every capability that is presented as a card uses the shared contract in
`client/components/ui/KForgeServiceCard.tsx`:

- identity (icon, title, category),
- description and capability,
- a truthful availability state with the evidence behind it,
- one primary action and only genuinely available secondary actions,
- the real result of the last operation,
- the prerequisite the user still has to satisfy.

The Online catalog item card (`client/components/ui/KForgeCapabilityCard.tsx`)
is the catalog skin of the same contract, so a package, a tool and a workbench
service are never presented by two competing card systems.
