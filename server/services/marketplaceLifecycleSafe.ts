import { promises as fs } from "fs";
import path from "path";
import type { InstallResult } from "./marketplace";
import { updatePackage as updatePackageTransaction } from "./marketplace";

function stagingOperationPath(workspaceRoot: string, operationId: string): string {
  if (!/^op-[A-Za-z0-9-]+$/.test(operationId)) throw new Error("Invalid Marketplace operation ID returned by the lifecycle transaction.");
  const stagingRoot = path.resolve(workspaceRoot, ".kforge", "marketplace", "staging");
  const candidate = path.resolve(stagingRoot, operationId);
  const relative = path.relative(stagingRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Marketplace staging cleanup escaped the workspace staging root.");
  return candidate;
}

/**
 * Canonical update entry point for HTTP/runtime callers.
 *
 * The lower-level transaction already rolls back registry/package mutations.
 * This boundary additionally guarantees that the operation-specific staging
 * directory is removed even when validation fails before the transaction's
 * inner rollback/finally block is reached.
 */
export async function updatePackageSafely(workspaceRoot: string, itemId: string, newVersionManifestPath?: string): Promise<InstallResult> {
  const result = await updatePackageTransaction(workspaceRoot, itemId, newVersionManifestPath);
  const stagingDir = stagingOperationPath(workspaceRoot, result.operationId);
  await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  return result;
}
