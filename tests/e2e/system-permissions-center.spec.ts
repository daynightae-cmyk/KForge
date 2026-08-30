import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

test.describe("KForge System Permissions Center", () => {
  test.setTimeout(120_000);
  let projectPath = "";

  test.afterEach(async () => {
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
    projectPath = "";
  });

  test("shows derived tool authority without executing tools or inventing grants", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-permissions-center-"));
    await mkdir(path.join(projectPath, "src"), { recursive: true });
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({
      name: "kforge-permissions-center-fixture",
      private: true,
      version: "1.0.0",
      scripts: {
        lint: "node -e \"console.log('PERMISSIONS_LINT_SHOULD_NOT_RUN')\"",
        test: "node -e \"console.log('PERMISSIONS_TEST_SHOULD_NOT_RUN')\"",
        build: "node -e \"console.log('PERMISSIONS_BUILD_SHOULD_NOT_RUN')\"",
      },
    }, null, 2), "utf8");
    await writeFile(path.join(projectPath, "src", "index.js"), "export const permissionFixture = true;\n", "utf8");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string; trust: string } }).project;
    expect(project.trust).toBe("untrusted");

    const sourceBefore = await readFile(path.join(projectPath, "src", "index.js"), "utf8");
    const packageBefore = await readFile(path.join(projectPath, "package.json"), "utf8");
    let toolGets = 0;
    let toolPosts = 0;
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === `/api/workspace/projects/${project.id}/agent/tools`) {
        if (request.method() === "GET") toolGets += 1;
        if (request.method() === "POST") toolPosts += 1;
      }
      if (url.pathname.startsWith(`/api/workspace/projects/${project.id}/agent/tools/`) && request.method() === "POST") toolPosts += 1;
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "System", "Permissions");

    const center = page.getByRole("region", { name: "KForge Permissions Center", exact: true });
    await expect(center).toBeVisible();
    await expect(center).toHaveAttribute("data-project-trust", "untrusted");
    await expect(center).toContainText("Observed authority only");
    await expect(center).toContainText("never grants authority or executes a tool");
    await expect(center.getByRole("region", { name: "Permission matrix", exact: true })).toBeVisible();

    const listFiles = center.locator('[data-tool-name="list_files"]');
    await expect(listFiles).toHaveAttribute("data-tool-permission", "read-only");
    await expect(listFiles).toHaveAttribute("data-tool-status", "AVAILABLE");
    await expect(listFiles).toContainText("VERIFIED");

    const testTool = center.locator('[data-tool-name="test"]');
    await expect(testTool).toHaveAttribute("data-tool-permission", "safe");
    await expect(testTool).toHaveAttribute("data-tool-status", "UNAVAILABLE");
    await expect(testTool).toContainText("Project trust is required");
    await expect(testTool).toContainText("DETECTED");

    const blockedStop = center.locator('[data-tool-name="stop"]');
    await expect(blockedStop).toHaveAttribute("data-tool-permission", "blocked");
    await expect(blockedStop).toHaveAttribute("data-tool-status", "BLOCKED");
    await expect(blockedStop).toContainText("does not claim to manage processes it did not create");

    expect(toolGets).toBeGreaterThanOrEqual(1);
    expect(toolPosts).toBe(0);
    await center.getByRole("button", { name: "Refresh evidence", exact: true }).click();
    await expect.poll(() => toolGets).toBeGreaterThanOrEqual(2);
    expect(toolPosts).toBe(0);

    const trusted = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, { data: { confirmed: true } });
    expect(trusted.ok(), await trusted.text()).toBeTruthy();
    await center.getByRole("button", { name: "Refresh evidence", exact: true }).click();

    await expect(testTool).toHaveAttribute("data-tool-status", "AVAILABLE");
    await expect(testTool).not.toContainText("Project trust is required");

    const formatTool = center.locator('[data-tool-name="format"]');
    await expect(formatTool).toHaveAttribute("data-tool-permission", "safe-write");
    await expect(formatTool).toHaveAttribute("data-tool-status", "UNAVAILABLE");
    await expect(formatTool).toContainText("No confirmed format execution handler is registered");
    await expect(formatTool).toContainText("REQUIRED");

    const gitCommit = center.locator('[data-tool-name="git_commit"]');
    await expect(gitCommit).toHaveAttribute("data-tool-permission", "dangerous");
    await expect(gitCommit).toHaveAttribute("data-tool-status", "UNAVAILABLE");
    await expect(gitCommit).toContainText("No commit mutation handler is registered");

    expect(toolPosts).toBe(0);
    expect(externalRequests).toEqual([]);
    expect(await readFile(path.join(projectPath, "src", "index.js"), "utf8")).toBe(sourceBefore);
    expect(await readFile(path.join(projectPath, "package.json"), "utf8")).toBe(packageBefore);
  });
});
