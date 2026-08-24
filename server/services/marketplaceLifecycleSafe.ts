import { promises as fs } from "fs";
import path from "path";
import type { InstallResult } from "./marketplace";
import { updatePackage as updatePackageTransaction } from "./marketplace";

function validateOperationId(operationId: string): string {
  if (!/^op-[A-Za-z0-9-]+$/.test(operationId)) throw new Error("Invalid Marketplace operation ID returned by the lifecycle transaction.");
  return operationId;
}

async function findOperationDirectories(root: string, operationId: string): Promise<string[]> {
  const matches: string[] = [];
  const queue = [path.resolve(root)];

  while (queue.length > 0) {
    const current = queue.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.resolve(current, entry.name);
      const relative = path.relative(root, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Marketplace cleanup traversal escaped the workspace state root.");
      if (entry.name === operationId) matches.push(candidate);
      else queue.push(candidate);
    }
  }

  return matches;
}

async function assertRemoved(candidate: string, operationId: string): Promise<void> {
  try {
    await fs.access(candidate);
    throw new Error(`Marketplace operation cleanup failed for ${operationId}: ${candidate} still exists.`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw error;
  }
}

async function cleanupOperationState(workspaceRoot: string, operationId: string): Promise<void> {
  const safeOperationId = validateOperationId(operationId);
  const stateRoot = path.resolve(workspaceRoot, ".kforge");
  const candidates = await findOperationDirectories(stateRoot, safeOperationId);

  await Promise.all(candidates.map(async (candidate) => {
    await fs.rm(candidate, { recursive: true, force: true });
    await assertRemoved(candidate, safeOperationId);
  }));
}

/**
 * Canonical update entry point for HTTP/runtime callers.
 *
 * The lower-level transaction already rolls back registry/package mutations.
 * This boundary additionally guarantees that operation-scoped temporary state
 * is removed even when validation fails before the transaction's inner
 * rollback/finally block is reached. Cleanup discovers the operation directory
 * beneath the bounded workspace state root instead of duplicating the internal
 * marketplace/staging layout. Discovery scans once; removal verification is a
 * targeted existence check on each discovered operation directory.
 */
export async function updatePackageSafely(workspaceRoot: string, itemId: string, newVersionManifestPath?: string): Promise<InstallResult> {
  const result = await updatePackageTransaction(workspaceRoot, itemId, newVersionManifestPath);
  await cleanupOperationState(workspaceRoot, result.operationId);
  return result;
}
