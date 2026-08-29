import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

test.describe("KForge structured GitHub remote workbench", () => {
  test.setTimeout(90_000);

  test("renders repository, PR, issue, Actions and release evidence without remote mutation", async ({ page }) => {
    const repository = await mkdtemp(path.join(os.tmpdir(), "kforge-github-remote-"));
    try {
      await writeFile(path.join(repository, "package.json"), JSON.stringify({ name: "github-remote-fixture", private: true, version: "1.0.0" }), "utf8");
      const opened = await page.request.post("/api/workspace/projects/open", { data: { path: repository } });
      expect(opened.ok(), await opened.text()).toBeTruthy();
      const { project } = await opened.json() as { project: { id: string } };
      const endpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/github`;
      const methods: string[] = [];
      const headSha = "812331994cd33cd182e0c589911ad658731e3857";

      await page.route(`**${endpoint}`, async (route) => {
        methods.push(route.request().method());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            slug: "acme/kforge-fixture",
            connection: { state: "AVAILABLE", authenticated: true, reason: "Authenticated read access available." },
            repository: {
              full_name: "acme/kforge-fixture",
              html_url: "https://github.com/acme/kforge-fixture",
              description: "Structured remote acceptance fixture",
              private: false,
              visibility: "public",
              default_branch: "main",
              open_issues_count: 2,
              forks_count: 3,
              stargazers_count: 7,
            },
            branches: [{ name: "main", protected: true, commit: { sha: headSha } }],
            commits: [{ sha: headSha, html_url: `https://github.com/acme/kforge-fixture/commit/${headSha}`, commit: { message: "verified remote fixture", author: { date: "2026-08-29T12:00:00Z" } } }],
            issues: [
              { id: 31, number: 31, title: "Preview log overflow", state: "open", html_url: "https://github.com/acme/kforge-fixture/issues/31", user: { login: "qa" }, labels: [{ name: "bug" }], updated_at: "2026-08-29T12:10:00Z" },
              { id: 12, number: 12, title: "PR mirror entry", state: "open", pull_request: { url: "https://api.github.com/repos/acme/kforge-fixture/pulls/12" } },
            ],
            pullRequests: [{ id: 12, number: 12, title: "Fix preview race", state: "open", draft: false, html_url: "https://github.com/acme/kforge-fixture/pull/12", user: { login: "dev" }, head: { ref: "fix/preview" }, base: { ref: "main" }, updated_at: "2026-08-29T12:20:00Z" }],
            actions: { workflow_runs: [{ id: 93, run_number: 93, name: "KForge Verification Gate", status: "completed", conclusion: "success", html_url: "https://github.com/acme/kforge-fixture/actions/runs/93", head_branch: "main", head_sha: headSha, event: "push", actor: { login: "ci" }, updated_at: "2026-08-29T12:30:00Z" }] },
            checks: {
              state: "AVAILABLE",
              commitSha: headSha,
              reason: "Real checks retrieved.",
              checkRuns: { check_runs: [{ id: 1, name: "aggregate verification gate", status: "completed", conclusion: "success" }] },
              status: { state: "success", statuses: [] },
            },
            releases: [{ id: 1, tag_name: "v0.2.0", name: "KForge 0.2.0", draft: false, prerelease: false, html_url: "https://github.com/acme/kforge-fixture/releases/tag/v0.2.0", published_at: "2026-08-29T12:40:00Z" }],
            sources: {
              repository: { label: "Repository", state: "AVAILABLE", reason: "Repository evidence retrieved.", fetchedAt: "2026-08-29T12:45:00Z" },
              pullRequests: { label: "Pull requests", state: "AVAILABLE", reason: "PR evidence retrieved.", fetchedAt: "2026-08-29T12:45:00Z" },
              actions: { label: "Actions", state: "AVAILABLE", reason: "Workflow evidence retrieved.", fetchedAt: "2026-08-29T12:45:00Z" },
            },
            transparency: { execution: "REMOTE", network: "REQUIRED", dataClasses: ["METADATA", "CREDENTIAL_REFERENCE"], provider: "GitHub CLI", destination: "https://api.github.com/repos/acme/kforge-fixture", purpose: "Read GitHub engineering and Checks evidence.", result: "SUCCEEDED" },
          }),
        });
      });

      await page.goto("/workspace", { waitUntil: "domcontentloaded" });
      await setProjectContext(page, project.id);

      await selectExplorerView(page, "Remote / Git", "GitHub");
      const workbench = page.locator('section[aria-label="KForge GitHub Remote Workbench"]');
      await expect(workbench).toBeVisible();
      await expect(workbench).toContainText("acme/kforge-fixture");
      await expect(page.locator('section[aria-label="GitHub repository overview"]')).toContainText("Structured remote acceptance fixture");
      await expect(page.locator('section[aria-label="GitHub checks and CI evidence"]')).toContainText("KForge Verification Gate");
      await expect(page.locator('section[aria-label="GitHub checks and CI evidence"]')).toContainText("aggregate verification gate");
      await expect(page.locator('section[aria-label="GitHub network transparency"]')).toContainText("GitHub CLI");
      await expect(page.locator('section[aria-label="GitHub network transparency"]')).toContainText("https://api.github.com/repos/acme/kforge-fixture");

      await selectExplorerView(page, "Remote / Git", "Pull Requests");
      await expect(page.locator('section[aria-label="GitHub pull requests"]')).toContainText("Fix preview race");
      await expect(page.locator('section[aria-label="GitHub pull requests"]')).toContainText("fix/preview → main");

      await selectExplorerView(page, "Remote / Git", "Issues");
      const issues = page.locator('section[aria-label="GitHub issues"]');
      await expect(issues).toContainText("Preview log overflow");
      await expect(issues).not.toContainText("PR mirror entry");

      await selectExplorerView(page, "Remote / Git", "Actions");
      const actions = page.locator('section[aria-label="GitHub Actions runs"]');
      await expect(actions).toContainText("Run #93");
      await expect(actions).toContainText("SUCCESS");
      await expect(actions).toContainText("81233199");

      await selectExplorerView(page, "Remote / Git", "Releases");
      const releases = page.locator('section[aria-label="GitHub releases"]');
      await expect(releases).toContainText("v0.2.0");
      await expect(releases).toContainText("KForge 0.2.0");
      await expect(releases).toContainText("PUBLISHED");

      await workbench.getByRole("button", { name: "Refresh remote", exact: true }).click();
      await expect(workbench).toContainText("AVAILABLE");
      expect(methods.length).toBeGreaterThanOrEqual(2);
      expect(new Set(methods)).toEqual(new Set(["GET"]));
    } finally {
      await rm(repository, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    }
  });
});
