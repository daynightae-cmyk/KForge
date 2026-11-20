import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge authorized release execution", () => {
  test.setTimeout(300_000);

  test("builds a real artifact, hashes it, persists provenance, and reloads the record in a fresh workbench session", async ({ page }) => {
    const repository = await mkdtemp(path.join(os.tmpdir(), "kforge-release-execution-"));
    try {
      await writeFile(path.join(repository, "package.json"), JSON.stringify({
        name: "kforge-release-execution-fixture",
        private: true,
        version: "1.0.0",
        scripts: { build: "node build.mjs" },
      }, null, 2), "utf8");
      await writeFile(path.join(repository, "build.mjs"), `import { mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await mkdir("release", { recursive: true });
await writeFile("dist/app.js", "console.log('e2e-built');\\n");
await writeFile("release/setup.exe", "e2e-installer-v1");
`, "utf8");
      await mkdir(path.join(repository, "release", "verification"), { recursive: true });
      await writeFile(path.join(repository, "release", "verification", "package-windows.json"), JSON.stringify({
        artifactFilename: "setup.exe",
        sha256: "f".repeat(64),
        signatureState: "VALID",
      }), "utf8");
      execFileSync("git", ["init", "-q"], { cwd: repository });
      execFileSync("git", ["add", "."], { cwd: repository });
      execFileSync("git", ["-c", "user.email=kforge@example.invalid", "-c", "user.name=KForge E2E", "commit", "-qm", "release execution fixture"], { cwd: repository });
      const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();

      const externalRequests: string[] = [];
      const releaseMutations: string[] = [];
      page.on("request", (request) => {
        if (isExternalHttpRequest(request.url())) externalRequests.push(request.url());
        const pathname = new URL(request.url()).pathname;
        if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()) && /\/release(?:\/|$)/.test(pathname)) releaseMutations.push(`${request.method()} ${pathname}`);
      });

      expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
      expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
      const opened = await page.request.post("/api/workspace/projects/open", { data: { path: repository } });
      expect(opened.ok(), await opened.text()).toBeTruthy();
      const project = (await opened.json() as { project: { id: string } }).project;
      expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

      await openWorkbench(page);
      await setProjectContext(page, project.id);
      await selectExplorerView(page, "Release", "Release Preparation");
      const center = page.getByRole("region", { name: "KForge Release and Distribution Center", exact: true });
      const execution = center.getByRole("region", { name: "Authorized local release execution", exact: true });
      await expect(execution).toBeVisible();
      await expect(execution).toContainText(sourceSha);

      const reviewed = execution.locator("label").filter({ hasText: "I reviewed source SHA" }).locator('input[type="checkbox"]');
      await reviewed.check();
      const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/release/execute`) && response.request().method() === "POST", { timeout: 180_000 });
      await execution.getByRole("button", { name: "Build & verify artifact", exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);
      const payload = await response.json() as { ok: boolean; record: { id: string; sourceSha: string; artifactState: string; artifactDigest: string; artifacts: Array<{ path: string; sha256: string; size: number }>; signing: { state: string; match: string } } };
      expect(payload.ok).toBe(true);
      expect(payload.record).toMatchObject({ sourceSha, artifactState: "VERIFIED", signing: { state: "UNVERIFIED", match: "STALE_RECORD" } });
      expect(payload.record.artifacts.map((artifact) => artifact.path)).toEqual(["dist/app.js", "release/setup.exe"]);

      const installer = payload.record.artifacts.find((artifact) => artifact.path === "release/setup.exe");
      const installBytes = await readFile(path.join(repository, "release", "setup.exe"));
      expect(createHash("sha256").update(installBytes).digest("hex")).toBe(installer?.sha256);

      await expect(execution).toContainText("Release execution");
      await expect(execution).toContainText("VERIFIED");
      await expect(execution).toContainText("SIGNATURE_STALE_RECORD");
      await expect(execution).toContainText(payload.record.artifactDigest);

      const publicationPanel = center.getByRole("region", { name: "Authorized GitHub release publication", exact: true });
      await expect(publicationPanel).toContainText("verified release execution record");
      await expect(publicationPanel.getByRole("button", { name: /release with verified assets/i })).toBeDisabled();

      const readBack = await page.request.get(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/records`);
      expect(readBack.ok(), await readBack.text()).toBeTruthy();
      const records = (await readBack.json() as { records: Array<{ id: string; sourceSha: string; artifactState: string; artifactDigest: string }> }).records;
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ id: payload.record.id, sourceSha, artifactState: "VERIFIED", artifactDigest: payload.record.artifactDigest });

      // A fresh browser session proves the record is loaded from persisted
      // server evidence rather than React state left over from the build click.
      const secondPage = await page.context().newPage();
      try {
        await openWorkbench(secondPage);
        await setProjectContext(secondPage, project.id);
        await selectExplorerView(secondPage, "Release", "Release Preparation");
        const secondCenter = secondPage.getByRole("region", { name: "KForge Release and Distribution Center", exact: true });
        const secondExecution = secondCenter.getByRole("region", { name: "Authorized local release execution", exact: true });
        await expect(secondExecution, { timeout: 30_000 }).toBeVisible();
        await expect(secondExecution, { timeout: 30_000 }).toContainText("Persisted release execution records");
        await expect(secondExecution, { timeout: 30_000 }).toContainText(payload.record.sourceSha.slice(0, 12));
        await expect(secondExecution, { timeout: 30_000 }).toContainText("2 artifact(s)");
      } finally {
        await secondPage.close();
      }

      expect(releaseMutations).toEqual([`POST /api/workspace/projects/${project.id}/release/execute`]);
      expect(externalRequests, `Release execution contacted an external origin in Offline Mode:\n${externalRequests.join("\n")}`).toEqual([]);
    } finally {
      await rm(repository, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    }
  });
});
