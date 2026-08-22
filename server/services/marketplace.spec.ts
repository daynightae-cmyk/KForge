import { promises as fs } from "fs";
import { describe, expect, it } from "vitest";
import path from "path";
import { getMarketplace } from "./marketplace";

describe("KForge Marketplace adapters", () => {
  it("exposes installed local agents and tools while keeping remote data offline", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-marketplace-"));
    try {
      const marketplace = await getMarketplace(workspaceRoot, false);
      expect(marketplace.items.some((item) => item.category === "agents" && item.id === "agent:kforge:engineer" && item.installed)).toBe(true);
      expect(marketplace.items.some((item) => item.category === "tools" && item.id === "tool:kforge:read_file" && item.local)).toBe(true);
      expect(marketplace.providers.find((provider) => provider.id === "ollama-official")?.state).toBe("OFFLINE");
      expect(marketplace.providers.find((provider) => provider.id === "extension-registries")?.state).toBe("DATA_UNAVAILABLE");
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
