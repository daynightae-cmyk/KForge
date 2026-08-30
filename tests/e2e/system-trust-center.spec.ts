import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

test.describe("KForge specialized Trust Center", () => {
  test.setTimeout(120_000);
  let projectPath = "";

  test.afterEach(async () => {
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
    projectPath = "";
  });

  test("keeps opening observational and grants local trust only after explicit confirmation", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-trust-center-"));
    await mkdir(path.join(projectPath, "src"), { recursive: true });
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({
      name: "kforge-trust-center-fixture",
      private: true,
      version: "1.0.0",
      scripts: {
        lint: "node -e \"console.log('lint')\"",
        test: "node -e \"console.log('test')\"",
        build: "node -e \"console.log('build')\"",
      },
    }, null, 2), "utf8");
    await writeFile(path.join(projectPath, "src", "index.js"), "export const trustFixture = true;\n", "utf8");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string; trust: string } }).project;
    expect(project.trust).toBe("untrusted");

    const sourceBefore = await readFile(path.join(projectPath, "src", "index.js"), "utf8");
    const packageBefore = await readFile(path.join(projectPath, "package.json"), "utf8");
    let trustPosts = 0;
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === `/api/workspace/projects/${project.id}/trust`) trustPosts += 1;
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "System", "Trust");

    const center = page.getByRole("region", { name: "KForge Trust Center", exact: true });
    await expect(center).toBeVisible();
    await expect(center).toHaveAttribute("data-project-trust", "untrusted");
    await expect(center).toContainText("Trust never implies");
    await expect(center).toContainText("NO_IMPLICIT_NETWORK_CONTACT");
    await expect(center).toContainText("NOT_EXPOSED_BY_CURRENT_WORKSPACE_API");
    expect(trustPosts).toBe(0);

    await center.getByRole("button", { name: "Refresh evidence", exact: true }).click();
    await expect(center).toHaveAttribute("data-project-trust", "untrusted");
    expect(trustPosts).toBe(0);

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("Remote writes remain separately confirmation-gated");
      await dialog.accept();
    });
    const trustResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/trust`) && response.request().method() === "POST");
    await center.getByRole("button", { name: "Trust project with confirmation", exact: true }).click();
    expect((await trustResponse).ok()).toBeTruthy();

    await expect(center).toHaveAttribute("data-project-trust", "trusted", { timeout: 30_000 });
    await expect(center).toContainText("LOCAL_EXECUTION_ENABLED");
    await expect(center).toContainText("AVAILABLE");
    await expect(center.getByRole("status")).toContainText("Project trust granted");
    expect(trustPosts).toBe(1);
    expect(externalRequests).toEqual([]);
    expect(await readFile(path.join(projectPath, "src", "index.js"), "utf8")).toBe(sourceBefore);
    expect(await readFile(path.join(projectPath, "package.json"), "utf8")).toBe(packageBefore);
  });
});
