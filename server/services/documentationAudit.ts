import { promises as fs } from "fs";
import path from "path";
import type { ProjectProfile } from "../../shared/workspace";

export type DocumentationSeverity = "high" | "medium" | "low";

export interface DocumentationFinding {
  id: string;
  sourceDocument: string;
  claim: string;
  evidence: string;
  actualState: string;
  severity: DocumentationSeverity;
  suggestedFix: string;
  fix?: { before: string; after: string };
}

export interface DocumentationAudit {
  auditedAt: string;
  documents: string[];
  findings: DocumentationFinding[];
}

const documentNames = ["README.md", "AGENTS.md", "ARCHITECTURE.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "CHANGELOG", ".env.example"];
const commandPattern = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:-]+)/gi;
const markdownLinkPattern = /\[[^\]]+\]\(([^)#][^)]*)\)/g;

function idFor(document: string, kind: string, token: string) {
  return `documentation:${document}:${kind}:${Buffer.from(token).toString("base64url").slice(0, 24)}`;
}

async function exists(file: string) {
  try { await fs.access(file); return true; } catch { return false; }
}

function isMarkdownCommandContext(text: string, index: number) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const prefix = text.slice(lineStart, index);
  const inlineCode = (prefix.match(/`/g) || []).length % 2 === 1;
  return inlineCode || /^\s*$/.test(prefix);
}

function commandForScript(profile: ProjectProfile, script: string) {
  const manager = profile.packageManager || "npm";
  if (manager === "yarn") return `yarn ${script}`;
  if (manager === "pnpm") return `pnpm run ${script}`;
  if (manager === "bun") return `bun run ${script}`;
  return `npm run ${script}`;
}

export async function auditDocumentation(projectPath: string, profile: ProjectProfile): Promise<DocumentationAudit> {
  const documents = (await Promise.all(documentNames.map(async (name) => (await exists(path.join(projectPath, name))) ? name : undefined))).filter((entry): entry is string => Boolean(entry));
  const findings: DocumentationFinding[] = [];
  for (const document of documents.filter((name) => name !== ".env.example")) {
    const absolute = path.join(projectPath, document);
    const text = await fs.readFile(absolute, "utf8").catch(() => "");
    for (const match of text.matchAll(commandPattern)) {
      if (!isMarkdownCommandContext(text, match.index || 0)) continue;
      const whole = match[0];
      const script = match[1];
      if (script === "install" || script === "ci" || profile.scripts[script]) continue;
      const suggested = profile.commands.dev || profile.commands.test || profile.commands.build;
      findings.push({
        id: idFor(document, "missing-script", whole),
        sourceDocument: document,
        claim: whole,
        evidence: `The document names the '${script}' script.`,
        actualState: `package metadata does not define scripts.${script}.`,
        severity: "high",
        suggestedFix: suggested ? `Replace with the detected command '${suggested}' or document that the step is unavailable.` : "Remove the command or add an explicit script to project metadata.",
        fix: suggested ? { before: whole, after: suggested } : undefined,
      });
    }
    for (const match of text.matchAll(markdownLinkPattern)) {
      const target = match[1].trim();
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      const relative = target.split(/[?#]/)[0];
      if (!relative || await exists(path.resolve(projectPath, path.dirname(document), relative))) continue;
      findings.push({
        id: idFor(document, "missing-link", target),
        sourceDocument: document,
        claim: target,
        evidence: `Markdown link target '${target}' is referenced by ${document}.`,
        actualState: "The linked local path does not exist.",
        severity: "medium",
        suggestedFix: "Correct the link target or remove the stale reference.",
      });
    }
  }
  if (profile.envFiles.length && !documents.includes(".env.example")) {
    findings.push({
      id: "documentation:missing-env-example",
      sourceDocument: "project root",
      claim: "Environment configuration is present.",
      evidence: `Detected environment files: ${profile.envFiles.join(", ")}.`,
      actualState: ".env.example is not present.",
      severity: "medium",
      suggestedFix: "Add a redacted .env.example describing required variable names only.",
    });
  }
  if (profile.scripts.dev && documents.includes("README.md")) {
    const readme = await fs.readFile(path.join(projectPath, "README.md"), "utf8").catch(() => "");
    if (!/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start)\b/i.test(readme)) {
      findings.push({
        id: "documentation:readme-missing-dev-setup",
        sourceDocument: "README.md",
        claim: "No detected development command is documented.",
        evidence: `package metadata defines scripts.dev as '${profile.scripts.dev}'.`,
        actualState: "README.md has no npm/pnpm/yarn/bun dev or start command.",
        severity: "low",
        suggestedFix: `Document '${commandForScript(profile, "dev")}' in setup instructions.`,
      });
    }
  }
  return { auditedAt: new Date().toISOString(), documents, findings };
}

export async function previewDocumentationFix(projectPath: string, audit: DocumentationAudit, findingId: string) {
  const finding = audit.findings.find((entry) => entry.id === findingId);
  if (!finding?.fix) return { finding, patch: undefined, reason: "This finding requires manual review; no exact safe text replacement is available." };
  const documentPath = path.resolve(projectPath, finding.sourceDocument);
  if (!documentPath.startsWith(path.resolve(projectPath) + path.sep)) return { finding, patch: undefined, reason: "Unsafe documentation path." };
  const text = await fs.readFile(documentPath, "utf8").catch(() => "");
  const occurrences = text.split(finding.fix.before).length - 1;
  if (occurrences === 0) return { finding, patch: undefined, reason: "The documented claim no longer matches the preview source." };
  if (occurrences !== 1) return { finding, patch: undefined, reason: "The documented claim is not unique, so KForge will not apply an ambiguous replacement." };
  return { finding, patch: { document: finding.sourceDocument, before: finding.fix.before, after: finding.fix.after } };
}

export async function applyDocumentationFix(projectPath: string, profile: ProjectProfile, audit: DocumentationAudit, findingId: string) {
  const preview = await previewDocumentationFix(projectPath, audit, findingId);
  if (!preview.patch) return { ...preview, applied: false, verified: false };
  const target = path.resolve(projectPath, preview.patch.document);
  const text = await fs.readFile(target, "utf8");
  const next = text.replace(preview.patch.before, preview.patch.after);
  const temporary = `${target}.kforge-tmp`;
  await fs.writeFile(temporary, next, "utf8");
  await fs.rename(temporary, target);
  const verifiedAudit = await auditDocumentation(projectPath, profile);
  return { ...preview, applied: true, verified: !verifiedAudit.findings.some((entry) => entry.id === findingId), verification: verifiedAudit };
}
