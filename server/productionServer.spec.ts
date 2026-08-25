import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { startKForgeProductionServer } from "./productionServer";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

async function makeApplicationRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "kforge-production-server-"));
  temporaryRoots.push(root);
  await Promise.all([
    mkdir(path.join(root, "fixtures", "marketplace-first-party"), { recursive: true }),
    mkdir(path.join(root, "fixtures", "marketplace-first-party-v110"), { recursive: true }),
    mkdir(path.join(root, "dist", "spa"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, "fixtures", "marketplace-first-party", "manifest.json"), "{}"),
    writeFile(path.join(root, "fixtures", "marketplace-first-party-v110", "manifest.json"), "{}"),
    writeFile(path.join(root, "dist", "spa", "index.html"), "<!doctype html><title>KForge test</title><main>Local workspace</main>"),
  ]);
  return root;
}

describe("KForge production server", () => {
  it("serves the existing API and SPA over an allocated loopback port", async () => {
    const applicationRoot = await makeApplicationRoot();
    const runtime = await startKForgeProductionServer({ applicationRoot, host: "127.0.0.1", port: 0 });
    try {
      expect(runtime.host).toBe("127.0.0.1");
      expect(runtime.port).toBeGreaterThan(0);
      const ping = await fetch(`${runtime.url}/api/ping`);
      expect(ping.status).toBe(200);
      await expect(ping.json()).resolves.toEqual({ message: "KForge server is online." });
      const application = await fetch(`${runtime.url}/workspace`);
      expect(application.status).toBe(200);
      await expect(application.text()).resolves.toContain("Local workspace");
    } finally {
      await runtime.close();
    }
  });
});
