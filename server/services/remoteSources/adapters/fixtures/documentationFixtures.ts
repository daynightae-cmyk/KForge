/**
 * Deterministic Remote Documentation fixtures (Slice 6).
 *
 * Shapes follow the allowlisted provider documents: OpenAPI JSON with
 * info.title/info.version, and plain-text llms-style documents with a
 * leading heading. Unit tests MUST NOT require live provider network;
 * these fixtures are the contract stand-ins. Optional live tests stay
 * behind KFORGE_LIVE_PROVIDER_TESTS=1.
 */

export const DOCS_OPENAPI_FIXTURE = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Fixture Provider API", version: "1.4.0" },
  paths: {
    "/models": {
      get: { summary: "List models", description: "Returns catalog models with pagination and search support." },
    },
  },
});

export const DOCS_LLMS_FIXTURE = [
  "# Fixture Provider Reference",
  "",
  "Search models with pagination support.",
  "Authentication uses bearer tokens kept server-side.",
  "",
  "## Pagination",
  "",
  "Cursor pagination with opaque tokens.",
].join("\n");

export const DOCS_UNKNOWN_SHAPE_FIXTURE = "plain text without structure";
