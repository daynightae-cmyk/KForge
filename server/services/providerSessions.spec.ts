import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { emitSessionEvent, sessionEvents, sessionPatches } from "./providerSessions";

let root = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-provider-sessions-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("provider session storage boundary", () => {
  it("records and reads events for a server-generated session identifier", async () => {
    const sessionId = randomUUID();
    await emitSessionEvent(root, sessionId, "MODEL_MESSAGE", "Operator note: first observation.");
    await emitSessionEvent(root, sessionId, "MODEL_MESSAGE", "Operator note: second observation.");
    const events = await sessionEvents(root, sessionId);
    expect(events).toHaveLength(2);
    expect(events[1].message).toBe("Operator note: second observation.");
    expect(await sessionPatches(root, sessionId)).toEqual([]);
  });

  it("refuses traversal-shaped session identifiers before any filesystem access", async () => {
    const sentinel = path.join(root, "sentinel.json");
    await fs.writeFile(sentinel, "keep", "utf8");
    for (const sessionId of ["../sentinel", "..\\sentinel", "../../etc/passwd", "not-a-uuid", `${randomUUID()}/../sentinel`]) {
      await expect(emitSessionEvent(root, sessionId, "MODEL_MESSAGE", "escape attempt")).rejects.toThrow(/Invalid provider session identifier/);
      await expect(sessionEvents(root, sessionId)).rejects.toThrow(/Invalid provider session identifier/);
      await expect(sessionPatches(root, sessionId)).rejects.toThrow(/Invalid provider session identifier/);
    }
    expect(await fs.readFile(sentinel, "utf8")).toBe("keep");
    const written = await fs.readdir(path.join(root, ".kforge", "provider-session-events")).catch(() => [] as string[]);
    expect(written).toEqual([]);
  });
});
