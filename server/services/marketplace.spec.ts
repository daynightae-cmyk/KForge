import { promises as fs } from "fs";
import { describe, expect, it } from "vitest";
import path from "path";
import { getMarketplace, listMarketplaceRegistryAdapters } from "./marketplace";

describe("KForge Marketplace adapters", () => {
  it("exposes installed local agents and tools while keeping remote data offline", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-marketplace-"));
    try {
      const marketplace = await getMarketplace(workspaceRoot, false);
      expect(marketplace.items.some((item) => item.category === "agents" && item.id === "agent:kforge:engineer" && item.installed)).toBe(true);
      expect(marketplace.items.some((item) => item.category === "tools" && item.id === "tool:kforge:read_file" && item.local)).toBe(true);
      expect(marketplace.providers.find((provider) => provider.id === "ollama-official")?.state).toBe("OFFLINE");
      expect(marketplace.providers.find((provider) => provider.id === "extension-registries")?.state).toBe("OFFLINE");
      expect(marketplace.adapters.find((adapter) => adapter.id === "ollama-official")?.configured).toBe(false);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("reports an unconfigured remote registry as DATA_UNAVAILABLE in Online Optional mode", () => {
    const remote = listMarketplaceRegistryAdapters(true).find((adapter) => adapter.id === "ollama-official");
    expect(remote).toMatchObject({ kind: "remote", configured: false, state: "DATA_UNAVAILABLE" });
    expect(remote?.capabilities).toEqual(expect.arrayContaining(["catalog", "version", "changelog", "install"]));
    expect(remote?.detail).toContain("no remote catalog adapter is configured");
  });
});
