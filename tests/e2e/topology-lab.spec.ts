import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

test.describe("KForge Preview Experience 5.0 topology lab", () => {
  test.setTimeout(180_000);
  let projectPath = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) await request.post(`/api/workspace/projects/${encodeURIComponent(projectId)}/topology/stop`).catch(() => undefined);
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
    projectPath = ""; projectId = "";
  });

  test("discovers, runs, inspects, persists, isolates restarts, propagates failure, and stops a real multi-process app", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-topology-e2e-"));
    await mkdir(path.join(projectPath, ".kforge"), { recursive: true });
    const argv = (file: string) => [process.execPath, file];
    await writeFile(path.join(projectPath, ".kforge", "topology.json"), JSON.stringify({ services: [
      { id: "api", name: "Orders API", kind: "api", command: argv("api.cjs"), health: { type: "HTTP", path: "/health" } },
      { id: "web", name: "Web App", kind: "frontend", command: argv("web.cjs"), dependencies: ["api"], health: { type: "HTTP" }, browserEntrypoint: "/", browserLabel: "Web App" },
      { id: "admin", name: "Admin App", kind: "admin", command: argv("admin.cjs"), dependencies: ["api"], health: { type: "HTTP" }, browserEntrypoint: "/", browserLabel: "Admin" },
      { id: "worker", name: "Queue Worker", kind: "worker", command: argv("worker.cjs"), health: { type: "PROCESS" } },
    ] }, null, 2), "utf8");
    const server = (label: string, crash = false) => [
      "const http=require('node:http'); const port=Number(process.env.PORT);",
      `http.createServer((req,res)=>{if(${crash}&&req.url==='/crash'){res.end('crashing');setTimeout(()=>process.exit(23),20);return;}res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html lang=\"en\"><head><title>${label}</title></head><body><h1>${label}</h1><p id=\"port\">'+port+'</p></body></html>')}).listen(port,'127.0.0.1',()=>console.log('${label}_READY:'+port));`,
    ].join("\n");
    await writeFile(path.join(projectPath, "api.cjs"), server("API", true), "utf8");
    await writeFile(path.join(projectPath, "web.cjs"), server("WEB_APP"), "utf8");
    await writeFile(path.join(projectPath, "admin.cjs"), server("ADMIN_APP"), "utf8");
    await writeFile(path.join(projectPath, "worker.cjs"), "console.log('WORKER_LOOP_READY');setInterval(()=>{},1000);", "utf8");

    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    projectId = (await opened.json() as { project: { id: string } }).project.id;

    const untrusted = await page.request.post(`/api/workspace/projects/${projectId}/topology/start`);
    expect(untrusted.status()).toBe(428);
    expect((await page.request.post(`/api/workspace/projects/${projectId}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, projectId);
    await selectExplorerView(page, "Developer Tools", "Preview");
    const workbench = page.getByRole("region", { name: "KForge Preview Workbench", exact: true });
    await expect(workbench).toHaveAttribute("data-preview-experience", "5");
    const lab = workbench.getByRole("region", { name: "Runtime Topology Lab", exact: true });
    await expect(lab).toHaveAttribute("data-topology-state", "DISCOVERED");
    await expect(lab.getByRole("region", { name: "Topology services", exact: true })).toContainText("Orders API");
    await expect(lab.getByRole("region", { name: "Proven topology relationships", exact: true })).toContainText("CONFIGURED_DEPENDENCY");

    const startResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${projectId}/topology/start`) && response.request().method() === "POST");
    await lab.getByRole("button", { name: "Start topology", exact: true }).click();
    expect((await startResponse).status()).toBe(202);
    await expect(lab).toHaveAttribute("data-topology-state", /HEALTHY|RUNNING/, { timeout: 45_000 });
    const started = await (await page.request.get(`/api/workspace/projects/${projectId}/topology`)).json() as { session: { id: string; services: Array<{ id: string; processId: number; port: { allocated?: number }; state: string }> } };
    const webBefore = started.session.services.find((service) => service.id === "web")!;
    const apiBefore = started.session.services.find((service) => service.id === "api")!;
    await expect(page.frameLocator('iframe[title="Orders API topology Preview"], iframe[title="Web App topology Preview"]').locator("h1")).toBeVisible();

    await lab.getByLabel("Topology browser entrypoint").selectOption("admin");
    await expect(page.frameLocator('iframe[title="Admin App topology Preview"]').locator("h1")).toHaveText("ADMIN_APP");
    await expect(page.getByRole("complementary", { name: "Persistent Preview Dock", exact: true })).toContainText("Admin");

    const restart = await page.request.post(`/api/workspace/projects/${projectId}/topology/services/admin/restart`);
    expect(restart.status()).toBe(202);
    const afterAdminRestart = (await restart.json() as { session: { services: Array<{ id: string; processId: number }> } }).session;
    expect(afterAdminRestart.services.find((service) => service.id === "web")?.processId).toBe(webBefore.processId);
    expect(afterAdminRestart.services.find((service) => service.id === "api")?.processId).toBe(apiBefore.processId);

    await selectExplorerView(page, "AI", "Agents");
    const persistent = page.getByRole("complementary", { name: "Persistent Preview Dock", exact: true });
    await expect(persistent).toContainText("Admin");
    const unchanged = await (await page.request.get(`/api/workspace/projects/${projectId}/topology`)).json() as { session: { id: string; services: Array<{ id: string; processId: number }> } };
    expect(unchanged.session.id).toBe(started.session.id);
    expect(unchanged.session.services.find((service) => service.id === "web")?.processId).toBe(webBefore.processId);

    await page.request.get(`http://127.0.0.1:${apiBefore.port.allocated}/crash`);
    await expect.poll(async () => {
      const result = await (await page.request.post(`/api/workspace/projects/${projectId}/topology/health`)).json() as { session: { state: string; services: Array<{ id: string; state: string }>; problems: Array<{ kind: string; serviceId?: string }> } };
      return { state: result.session.state, api: result.session.services.find((service) => service.id === "api")?.state, web: result.session.services.find((service) => service.id === "web")?.state, problems: result.session.problems.map((item) => `${item.serviceId}:${item.kind}`) };
    }, { timeout: 30_000 }).toMatchObject({ state: "DEGRADED", api: "FAILED", web: "DEGRADED", problems: expect.arrayContaining(["api:UNEXPECTED_EXIT", "web:DEPENDENCY_UNAVAILABLE"]) });

    await selectExplorerView(page, "Developer Tools", "Preview");
    await lab.getByRole("button", { name: "Topology console", exact: true }).click();
    await expect(lab.getByRole("region", { name: "Topology evidence dock", exact: true })).toContainText("[WORKER] WORKER_LOOP_READY");
    await lab.getByRole("button", { name: /^Topology issues/ }).click();
    await expect(lab.getByRole("region", { name: "Topology evidence dock", exact: true })).toContainText("UNEXPECTED_EXIT");

    const axe = await new AxeBuilder({ page }).include('[aria-label="Runtime Topology Lab"]').analyze();
    expect(axe.violations, axe.violations.map((entry) => `${entry.id}: ${entry.help}`).join("\n")).toEqual([]);

    const stop = await page.request.post(`/api/workspace/projects/${projectId}/topology/stop`);
    expect(stop.ok(), await stop.text()).toBeTruthy();
    const stopped = (await stop.json() as { session: { state: string; services: Array<{ id: string; state: string }> } }).session;
    expect(stopped.state).toBe("STOPPED");
    expect(stopped.services.filter((service) => service.id !== "api").every((service) => service.state === "STOPPED")).toBe(true);
  });
});
