import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execFile = promisify(execFileCallback);

async function git(repository: string, args: string[]) {
  await execFile("git", args, { cwd: repository, windowsHide: true });
}

test.describe("KForge local Git operations in production", () => {
  test("requires trust and confirmation, then stages, unstages, and commits only an isolated local repository", async ({ page }) => {
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

      const staged = await page.request.post(`${endpoint}/stage`, { data: { files: ["tracked.txt", "new.txt"], confirmed: true } });
      expect(staged.ok(), await staged.text()).toBeTruthy();
      const stagedPayload = await staged.json() as { action: string; git: { changes: Array<{ file: string; staged: boolean }> } };
      expect(stagedPayload.action).toBe("stage");
      expect(stagedPayload.git.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ file: "tracked.txt", staged: true }),
        expect.objectContaining({ file: "new.txt", staged: true }),
      ]));

      const unstaged = await page.request.post(`${endpoint}/unstage`, { data: { files: ["tracked.txt"], confirmed: true } });
      expect(unstaged.ok(), await unstaged.text()).toBeTruthy();
      const unstagedPayload = await unstaged.json() as { git: { changes: Array<{ file: string; staged: boolean }> } };
      expect(unstagedPayload.git.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ file: "tracked.txt", staged: false }),
        expect.objectContaining({ file: "new.txt", staged: true }),
      ]));

      const restaged = await page.request.post(`${endpoint}/stage`, { data: { files: ["tracked.txt"], confirmed: true } });
      expect(restaged.ok(), await restaged.text()).toBeTruthy();

      const commit = await page.request.post(`${endpoint}/commit`, { data: { message: "test: verify local Git operations", confirmed: true } });
      expect(commit.status(), await commit.text()).toBe(201);
      const commitPayload = await commit.json() as { action: string; remotePush: string; git: { commits: Array<{ subject: string }> } };
      expect(commitPayload).toMatchObject({ action: "commit", remotePush: "NOT_PERFORMED" });
      expect(commitPayload.git.commits[0]?.subject).toBe("test: verify local Git operations");
    } finally {
      await fs.rm(repository, { recursive: true, force: true });
    }
  });
});
