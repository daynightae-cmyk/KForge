import { promises as fs } from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getLocalPlatformStatus, isOptionalOnlineFeatureEnabled, isProviderRefreshEnabled, isRemoteTransferEnabled, localPlatformPolicy, setLocalPlatformMode } from "./localPlatform";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 })));
});

describe("Local Platform operating modes", () => {
  it("enforces distinct network behavior for all four modes", () => {
    expect(localPlatformPolicy("offline")).toMatchObject({ externalMetadataReads: false, remoteTransfers: false, providerRefresh: false });
    expect(localPlatformPolicy("local-first")).toMatchObject({ externalMetadataReads: true, remoteTransfers: false, providerRefresh: false });
    expect(localPlatformPolicy("online-optional")).toMatchObject({ externalMetadataReads: true, remoteTransfers: true, providerRefresh: false });
    expect(localPlatformPolicy("online")).toMatchObject({ externalMetadataReads: true, remoteTransfers: true, providerRefresh: true });
    for (const mode of ["offline", "local-first", "online-optional", "online"] as const) {
      expect(localPlatformPolicy(mode)).toMatchObject({ remoteWritesRequireConfirmation: true, openingRemoteSurfaceContactsNetwork: false });
    }
  });

  it("persists ONLINE to OFFLINE to ONLINE across fresh reads without temporary-file residue", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-platform-restart-"));
    roots.push(root);
    expect((await getLocalPlatformStatus(root)).mode).toBe("offline");

    await setLocalPlatformMode(root, "online");
    expect(await isProviderRefreshEnabled(root)).toBe(true);
    expect(await isRemoteTransferEnabled(root)).toBe(true);

    await setLocalPlatformMode(root, "offline");
    const restartedOffline = await getLocalPlatformStatus(root);
    expect(restartedOffline).toMatchObject({ mode: "offline", networkRequiredForCore: false, policy: { externalMetadataReads: false, remoteTransfers: false, providerRefresh: false } });
    expect(restartedOffline.capabilities.find((entry) => entry.id === "projects")?.state).toBe("ready");
    expect(await isOptionalOnlineFeatureEnabled(root)).toBe(false);

    await setLocalPlatformMode(root, "online");
    const reconnected = await getLocalPlatformStatus(root);
    expect(reconnected.policy).toMatchObject({ externalMetadataReads: true, remoteTransfers: true, providerRefresh: true });
    const stored = JSON.parse(await fs.readFile(path.join(root, ".kforge", "local-platform.json"), "utf8")) as { mode?: string };
    expect(stored.mode).toBe("online");
    expect((await fs.readdir(path.join(root, ".kforge"))).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  }, 30_000);

  it("falls back safely when persisted mode evidence is malformed or unsupported", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-platform-invalid-"));
    roots.push(root);
    await fs.mkdir(path.join(root, ".kforge"), { recursive: true });
    await fs.writeFile(path.join(root, ".kforge", "local-platform.json"), "{not-json", "utf8");
    expect((await getLocalPlatformStatus(root)).mode).toBe("offline");
    await fs.writeFile(path.join(root, ".kforge", "local-platform.json"), JSON.stringify({ mode: "always-online" }), "utf8");
    expect((await getLocalPlatformStatus(root)).mode).toBe("offline");
  }, 20_000);
});
