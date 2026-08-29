import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

const execFile = promisify(execFileCallback);

async function git(repository: string, args: string[]) {
  return execFile("git", args, { cwd: repository, windowsHide: true });
}

test.describe("KForge local Git operations in production", () => {
  test.setTimeout(90_000);

  test("requires trust and confirmation, then stages, unstages, and commits through the visible Git Workbench only inside an isolated local repository", async ({ page }) => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-git-acceptance-"));
    try {
      await git(repository, ["init"]);
      await git(repository, ["config", "user.name", "KForge Acceptance"]);
      await git(repository, ["config", "user.email", "acceptance@kforge.local"]);
      await fs.writeFile(path.join(repository, "tracked.txt"), "initial\n", "utf8");
      await git(repository, ["add", "--", "tracked.txt"]);
      await git(repository, ["commit", "-m", "initial fixture"]);
      await fs.writeFile(path.join(repository, "tracked.txt"), "updated\n", "utf8");
      await fs.writeFile(path.join(repository, "new.txt"), "new local file\n", "utf8");
      const branch = (await git(repository, ["branch", "--show-current"])).stdout.trim();

      const opened = await page.request.post("/api/workspace/projects/open", { data: { path: repository } });
      expect(opened.ok(), await opened.text()).toBeTruthy();
      const { project } = await opened.json() as { project: { id: string } };
      const endpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/git`;

      const blocked = await page.request.post(`${endpoint}/stage`, { data: { files: ["tracked.txt"], confirmed: true } });
      expect(blocked.status()).toBe(428);

      const trusted = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, { data: { confirmed: true } });
      expect(trusted.ok(), await trusted.text()).toBeTruthy();

      const unsafe = await page.request.post(`${endpoint}/stage`, { data: { files: ["../outside.txt"], confirmed: true } });
      expect(unsafe.status()).toBe(400);

      await page.goto("/workspace", { waitUntil: "domcontentloaded" });
      await setProjectContext(page, project.id);
      await selectExplorerView(page, "Remote / Git", "Git");

      const workbench = page.locator('section[aria-label="KForge Git Workbench"]');
      await expect(workbench).toBeVisible();
      await expect(workbench).toContainText(branch);
      await expect(workbench).toContainText("TRUSTED");
      await expect(workbench).toContainText("No remote configured · local Git operations only");

      const trackedRow = workbench.locator('[data-git-file="tracked.txt"]');
      const newRow = workbench.locator('[data-git-file="new.txt"]');
      await expect(trackedRow).toBeVisible();
      await expect(newRow).toBeVisible();
      await trackedRow.getByRole("checkbox").check();
      await newRow.getByRole("checkbox").check();

      const stageResponse = page.waitForResponse((response) => response.url().endsWith(`${endpoint}/stage`) && response.request().method() === "POST");
      page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.accept(); });
      await workbench.getByRole("button", { name: "Stage selected", exact: true }).click();
      expect((await stageResponse).ok()).toBeTruthy();
      await expect(trackedRow).toContainText("STAGED");
      await expect(newRow).toContainText("STAGED");

      await trackedRow.getByRole("checkbox").check();
      const unstageResponse = page.waitForResponse((response) => response.url().endsWith(`${endpoint}/unstage`) && response.request().method() === "POST");
      page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.accept(); });
      await workbench.getByRole("button", { name: "Unstage selected", exact: true }).click();
      expect((await unstageResponse).ok()).toBeTruthy();
      await expect(trackedRow).toContainText("MODIFIED");
      await expect(newRow).toContainText("STAGED");

      await trackedRow.getByRole("checkbox").check();
      const restageResponse = page.waitForResponse((response) => response.url().endsWith(`${endpoint}/stage`) && response.request().method() === "POST");
      page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.accept(); });
      await workbench.getByRole("button", { name: "Stage selected", exact: true }).click();
      expect((await restageResponse).ok()).toBeTruthy();
      await expect(trackedRow).toContainText("STAGED");
      await expect(newRow).toContainText("STAGED");

      await workbench.getByLabel("Git commit message").fill("test: verify local Git workbench");
      const commitResponse = page.waitForResponse((response) => response.url().endsWith(`${endpoint}/commit`) && response.request().method() === "POST");
      page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.accept(); });
      await workbench.getByRole("button", { name: "Commit staged", exact: true }).click();
      const committed = await commitResponse;
      expect(committed.status(), await committed.text()).toBe(201);
      const commitPayload = await committed.json() as { action: string; remotePush: string; git: { commits: Array<{ subject: string }>; changes: unknown[] } };
      expect(commitPayload).toMatchObject({ action: "commit", remotePush: "NOT_PERFORMED" });
      expect(commitPayload.git.commits[0]?.subject).toBe("test: verify local Git workbench");
      expect(commitPayload.git.changes).toEqual([]);
      await expect(workbench).toContainText("Working tree is clean.");

      await selectExplorerView(page, "Remote / Git", "Commits");
      const commitHistory = page.locator('section[aria-label="Local commit history"]');
      await expect(commitHistory).toContainText("test: verify local Git workbench");

      await selectExplorerView(page, "Remote / Git", "Branches");
      const branches = page.locator('section[aria-label="Local branches"]');
      const currentBranch = branches.locator("div").filter({ hasText: branch }).filter({ hasText: "CURRENT" }).first();
      await expect(currentBranch).toBeVisible();

      const finalGit = await page.request.get(endpoint);
      expect(finalGit.ok(), await finalGit.text()).toBeTruthy();
      const finalPayload = await finalGit.json() as { changes: unknown[]; commits: Array<{ subject: string }> };
      expect(finalPayload.changes).toEqual([]);
      expect(finalPayload.commits[0]?.subject).toBe("test: verify local Git workbench");
    } finally {
      await fs.rm(repository, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    }
  });
});
