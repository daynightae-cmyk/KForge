import express from "express";
import { once } from "events";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import providerCommandRouter from "./providerCommandRouter";
import { makeProjectSummary } from "./workspace";
import { __injectCredentialVaultRuntimeForTests, type VaultRuntime } from "../services/credentialVault";
import type { ProviderContextFileDisclosure, ProviderContextInspection } from "../../shared/providerCommandCenter";

/**
 * Context disclosure acceptance for the AI engineering session.
 *
 * Proves the two properties this journey promises:
 *   1. the operator can read the exact bounded bytes a session sends, and
 *   2. that read path is never an arbitrary filesystem-read oracle and always
 *      carries the same redaction the provider actually receives.
 *
 * A deterministic vault seam keeps this hermetic on Windows; the real OS DPAPI
 * round trip is covered separately by credentialVault.dpapi-real.spec.ts.
 */

/** Local built-in provider: no credential is stored, so no vault write is needed. */
const LOCAL_PROVIDER_ID = "ollama";

function deterministicVaultRuntime(): VaultRuntime {
  const prefix = "DPAPIv1::";
  return {
    platform: "win32",
    protect: (plaintext) => prefix + Buffer.from(plaintext, "utf8").toString("base64"),
    unprotect: (protectedValue) => {
      if (!protectedValue.startsWith(prefix)) throw new Error("Credential protection did not produce a valid protected payload.");
      return Buffer.from(protectedValue.slice(prefix.length), "base64").toString("utf8");
    },
  };
}

describe("Provider session context disclosure", () => {
  let workspaceRoot = "";
  let projectRoot = "";
  let server: Server | null = null;
  let baseUrl = "";
  let previousRoot: string | undefined;

  beforeEach(async () => {
    __injectCredentialVaultRuntimeForTests(deterministicVaultRuntime());
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-context-disclosure-"));
    projectRoot = path.join(workspaceRoot, "disclosure-project");
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "disclosure-project", version: "1.0.0" }), "utf8");
    await fs.writeFile(
      path.join(projectRoot, "src", "index.ts"),
      "export const marker = 'PLAIN-SOURCE-SENTINEL-9f3c';\nexport function run() { return 1; }\n",
      "utf8",
    );
    // Outside the discovered project: must never become reachable here.
    await fs.writeFile(path.join(workspaceRoot, "outside-workspace.txt"), "OUTSIDE-ROOT-SECRET-4e1a", "utf8");

    previousRoot = process.env.KFORGE_WORKSPACE_ROOT;
    process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;

    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api/workspace", providerCommandRouter);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Disclosure test server did not expose a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      server.close();
      await once(server, "close");
      server = null;
    }
    __injectCredentialVaultRuntimeForTests(null);
    if (previousRoot === undefined) delete process.env.KFORGE_WORKSPACE_ROOT;
    else process.env.KFORGE_WORKSPACE_ROOT = previousRoot;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function api<T>(segment: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}/api/workspace${segment}`, init);
    const body = await response.json().catch(() => ({})) as T;
    return { status: response.status, body };
  }

  /** Creates a session against the fixture project through the real routes. */
  async function openSession() {
    const project = await makeProjectSummary(projectRoot);
    const session = await api<{ session: { id: string } }>("/ai/command-center/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        providerId: LOCAL_PROVIDER_ID,
        modelId: "local-model",
        mode: "PLAN",
        task: "Verify context disclosure",
        contextScope: "Repository",
        disclosureConfirmed: true,
      }),
    });
    expect(session.status, `session created (got ${JSON.stringify(session.body)})`).toBe(201);
    return { sessionId: session.body.session.id, project };
  }

  function contextUrl(sessionId: string, files: string, filePath?: string) {
    const params = new URLSearchParams({ files });
    if (filePath !== undefined) params.set("path", filePath);
    return `/ai/command-center/sessions/${sessionId}/context${filePath === undefined ? "" : "/file"}?${params.toString()}`;
  }

  it("discloses the exact bytes an operator-selected context file contributes", async () => {
    const { sessionId } = await openSession();
    const context = await api<{ context: ProviderContextInspection }>(contextUrl(sessionId, "src/index.ts"));
    expect(context.status).toBe(200);
    expect(context.body.context.filesIncluded.find((file) => file.path === "src/index.ts"), "file is in the disclosed set").toBeTruthy();

    const disclosure = await api<{ disclosure: ProviderContextFileDisclosure }>(
      contextUrl(sessionId, "src/index.ts", "src/index.ts"),
    );
    expect(disclosure.status, JSON.stringify(disclosure.body)).toBe(200);
    const record = disclosure.body.disclosure;
    expect(record.content).toContain("PLAIN-SOURCE-SENTINEL-9f3c");
    expect(record.characters).toBe(record.content.length);
    expect(record.reason).toBe("operator-selected");
    expect(record.redactionApplied).toBe(false);
    expect(record.sourceTruncated).toBe(false);
    expect(new Date(record.fetchedAt).getTime(), "disclosure is timestamped").toBeGreaterThan(0);
    expect(record.path).toBe("src/index.ts");
  });

  it("keeps source bytes out of the bulk context response but reports bounded metadata", async () => {
    const { sessionId } = await openSession();
    const context = await api<{ context: ProviderContextInspection }>(contextUrl(sessionId, "src/index.ts"));
    expect(context.status).toBe(200);
    // The routine poll must never carry file bodies to the renderer.
    expect(JSON.stringify(context.body), "bulk context carries no source bodies").not.toContain("PLAIN-SOURCE-SENTINEL-9f3c");
    expect(context.body.context.filesIncluded[0]).not.toHaveProperty("content");
    expect(context.body.context.filesIncluded[0]).toHaveProperty("characters");
  });

  it("redacts private keys, credentialed URLs, provider tokens and cookie headers before disclosure", async () => {
    const secrets = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA LEAKEDPRIVATEKEYBLOCK 7HQn0Rm3xZ",
      "-----END RSA PRIVATE KEY-----",
      "DATABASE_URL=postgres://admin:S3cr3tPassword@db.internal:5432/app",
      "GH_TOKEN=ghp_1234567890abcdefghijABCDEFGHIJ12",
      "Set-Cookie: session=abcdef123456; HttpOnly",
      "Authorization: Bearer abcdefghijklmnopqrstuvwx",
    ].join("\n");
    await fs.writeFile(path.join(projectRoot, "src", "leaky.ts"), secrets, "utf8");

    const { sessionId } = await openSession();
    const disclosure = await api<{ disclosure: ProviderContextFileDisclosure }>(
      contextUrl(sessionId, "src/leaky.ts", "src/leaky.ts"),
    );
    expect(disclosure.status).toBe(200);
    const record = disclosure.body.disclosure;

    for (const value of [
      "MIIEpAIBAAKCAQEA",
      "S3cr3tPassword",
      "ghp_1234567890abcdefghijABCDEFGHIJ12",
      "abcdef123456",
      "abcdefghijklmnopqrstuvwx",
    ]) {
      expect(JSON.stringify(record), `secret value ${value} must not be disclosed`).not.toContain(value);
    }
    expect(record.redactionApplied).toBe(true);
    expect(record.redactionReasons.length, "redaction categories are reported").toBeGreaterThan(0);
    // Categories are reported; the underlying values never are.
    expect(JSON.stringify(record.redactionReasons)).not.toContain("ghp_");
  });

  it("reports redaction state for a sensitive path selected by the operator", async () => {
    await fs.writeFile(path.join(projectRoot, "src", "env-like.ts"), "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\nPORT=3000\n", "utf8");
    const { sessionId } = await openSession();
    const disclosure = await api<{ disclosure: ProviderContextFileDisclosure }>(
      contextUrl(sessionId, "src/env-like.ts", "src/env-like.ts"),
    );
    expect(disclosure.status).toBe(200);
    expect(disclosure.body.disclosure.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(disclosure.body.disclosure.redactionApplied).toBe(true);
    // The non-secret line is preserved, so disclosure stays faithful to the file.
    expect(disclosure.body.disclosure.content).toContain("PORT=3000");
  });

  it("refuses to disclose any path that is not already in the session context set", async () => {
    const { sessionId } = await openSession();
    const attempts = [
      "../outside-workspace.txt",
      "..//outside-workspace.txt",
      "src/nope.ts",
      "/etc/passwd",
      "C:/Windows/win.ini",
      "src/index.ts/../leak.ts",
      "",
    ];
    for (const attempt of attempts) {
      const response = await api<{ error: string }>(contextUrl(sessionId, "src/index.ts", attempt));
      expect(response.status, `${JSON.stringify(attempt)} is not an included path`).toBeOneOf([400, 404]);
      expect(JSON.stringify(response.body), `${JSON.stringify(attempt)} leaks nothing`).not.toContain("OUTSIDE-ROOT-SECRET-4e1a");
      expect(JSON.stringify(response.body)).not.toContain("PLAIN-SOURCE-SENTINEL-9f3c");
    }
  });

  it("rejects a disclosure request for an unknown session", async () => {
    const response = await api<{ error: string }>(contextUrl("does-not-exist", "src/index.ts", "src/index.ts"));
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Session not found");
    expect(JSON.stringify(response.body)).not.toContain("PLAIN-SOURCE-SENTINEL-9f3c");
  });

  it("discloses content that agrees with the bounded metadata the session reports", async () => {
    const { sessionId } = await openSession();
    const context = await api<{ context: ProviderContextInspection }>(contextUrl(sessionId, "src/index.ts"));
    const disclosure = await api<{ disclosure: ProviderContextFileDisclosure }>(
      contextUrl(sessionId, "src/index.ts", "src/index.ts"),
    );
    expect(context.status).toBe(200);
    expect(disclosure.status).toBe(200);

    const listed = context.body.context.filesIncluded.find((file) => file.path === "src/index.ts");
    const record = disclosure.body.disclosure;
    // What the operator inspects must be the same bounded unit the session counts.
    expect(record.characters).toBe(listed!.characters);
    expect(record.redactionApplied).toBe(listed!.redacted === true);
    expect(record.sourceTruncated).toBe(listed!.sourceTruncated === true);
    expect(context.body.context.sourceCodeIncluded).toBe(true);

    const session = await api<{ session: { id: string } }>(`/ai/command-center/sessions/${sessionId}`);
    expect(session.status, "session remains readable after disclosure").toBe(200);
  });

  /**
   * The disclosure route deliberately builds the included set without scanning the
   * project, while the context route builds it through the full agent context.
   * Both must resolve to the same membership and the same bytes, or the operator
   * could be shown content that would not actually be sent.
   */
  it("keeps the scan-free disclosure set identical to the full context set", async () => {
    await fs.writeFile(path.join(projectRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: false } }, null, 2), "utf8");
    await fs.writeFile(path.join(projectRoot, "README.md"), "# disclosure fixture\n", "utf8");
    const { sessionId } = await openSession();
    const selected = "src/index.ts";

    const context = await api<{ context: ProviderContextInspection }>(contextUrl(sessionId, selected));
    expect(context.status).toBe(200);
    const contextPaths = context.body.context.filesIncluded.map((file) => file.path);
    expect(contextPaths.length, "full context set is non-empty").toBeGreaterThan(0);

    for (const entry of context.body.context.filesIncluded) {
      const disclosure = await api<{ disclosure: ProviderContextFileDisclosure }>(contextUrl(sessionId, selected, entry.path));
      expect(disclosure.status, `${entry.path} disclosed from the identical set`).toBe(200);
      expect(disclosure.body.disclosure.characters, `${entry.path} byte count matches`).toBe(entry.characters);
      expect(disclosure.body.disclosure.redactionApplied).toBe(entry.redacted === true);
      expect(disclosure.body.disclosure.sourceTruncated).toBe(entry.sourceTruncated === true);
    }

    // A path outside the set must be refused by the disclosure route too.
    const refused = await api<{ error: string }>(contextUrl(sessionId, selected, "src/never-included.ts"));
    expect(refused.status).toBe(404);
  });

  /**
   * Guard against the disclosure route silently growing a dependency on the
   * project scan again. `selectContextFiles` takes a path, not a scan, so the
   * membership computation cannot reach `scanProject`; this asserts the response
   * stays free of scan-derived evidence, which is what made a disclosure click
   * execute the project's own typecheck and lint before.
   */
  it("keeps scan-derived evidence out of the disclosure response", async () => {
    const { sessionId } = await openSession();
    const response = await fetch(`${baseUrl}/api/workspace${contextUrl(sessionId, "src/index.ts", "src/index.ts")}`);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["destination", "disclosure", "model", "provider"]);
    for (const scanField of ["diagnostics", "technology", "git", "estimatedTokens", "totalCharacters"]) {
      expect(body, `disclosure must not carry scan-derived field ${scanField}`).not.toHaveProperty(scanField);
    }
  });
});
