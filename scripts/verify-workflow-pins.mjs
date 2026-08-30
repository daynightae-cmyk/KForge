import { promises as fs } from "node:fs";
import path from "node:path";

const workflowsDirectory = path.join(process.cwd(), ".github", "workflows");
const workflowFiles = (await fs.readdir(workflowsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
  .map((entry) => path.join(workflowsDirectory, entry.name))
  .sort();

const violations = [];
let externalActions = 0;

for (const filePath of workflowFiles) {
  const source = await fs.readFile(filePath, "utf8");
  const relativePath = path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
    if (!match) continue;

    const spec = match[1].trim();
    if (spec.startsWith("./")) continue;

    if (spec.startsWith("docker://")) {
      externalActions += 1;
      if (!/@sha256:[0-9a-f]{64}$/i.test(spec)) {
        violations.push(`${relativePath}:${index + 1} docker action must use an immutable sha256 digest: ${spec}`);
      }
      continue;
    }

    externalActions += 1;
    const atIndex = spec.lastIndexOf("@");
    const ref = atIndex >= 0 ? spec.slice(atIndex + 1) : "";
    if (!/^[0-9a-f]{40}$/i.test(ref)) {
      violations.push(`${relativePath}:${index + 1} action must be pinned to a full 40-character commit SHA: ${spec}`);
    }
  }
}

if (workflowFiles.length === 0) {
  violations.push("No workflow files were found under .github/workflows; pin verification cannot establish CI supply-chain evidence.");
}
if (externalActions === 0) {
  violations.push("No external workflow actions were discovered; pin verification has no external action evidence to validate.");
}

if (violations.length > 0) {
  console.error("KForge workflow pin verification: FAIL");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`KForge workflow pin verification: PASS (${externalActions} external action reference(s) across ${workflowFiles.length} workflow file(s)).`);
}
