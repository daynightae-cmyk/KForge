import { promises as fs } from "fs";
import path from "path";
import ts from "typescript";

const ROOTS = ["client", "server", "shared", "tests"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".kforge",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  "target",
  "vendor",
  "bin",
  "obj",
]);

const issues = [];
let scannedFiles = 0;

function lineAndColumn(text, offset) {
  const prefix = text.slice(0, offset);
  const lines = prefix.split(/\r?\n/);
  return { line: lines.length, column: lines.at(-1)?.length + 1 || 1 };
}

function addIssue(file, text, offset, rule, message) {
  const location = lineAndColumn(text, Math.max(0, offset));
  issues.push({ file, line: location.line, column: location.column, rule, message });
}

function scriptKind(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

async function lintFile(absolutePath) {
  const relative = path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
  const text = await fs.readFile(absolutePath, "utf8");
  scannedFiles += 1;

  for (const marker of ["<<<<<<<", "=======", ">>>>>>>"]) {
    const index = text.indexOf(marker);
    if (index >= 0) addIssue(relative, text, index, "merge-conflict-marker", `Unresolved merge marker '${marker}' found.`);
  }

  for (const directive of ["@ts-ignore", "@ts-nocheck"]) {
    const index = text.indexOf(directive);
    if (index >= 0) addIssue(relative, text, index, "typescript-suppression", `${directive} is not allowed in checked source; fix or narrowly type the code instead.`);
  }

  const debuggerPattern = /\bdebugger\s*;/g;
  for (const match of text.matchAll(debuggerPattern)) {
    addIssue(relative, text, match.index || 0, "debugger", "debugger statements are not allowed in committed source.");
  }

  const sourceFile = ts.createSourceFile(
    relative,
    text,
    ts.ScriptTarget.ES2020,
    true,
    scriptKind(relative),
  );
  const diagnostics = sourceFile.parseDiagnostics || [];
  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    addIssue(relative, text, diagnostic.start || 0, "syntax", message);
  }
}

async function walk(directory) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".config") continue;
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) await lintFile(absolute);
  }
}

for (const root of ROOTS) await walk(path.resolve(process.cwd(), root));

if (issues.length) {
  console.error(`KForge lint failed with ${issues.length} issue(s) across ${scannedFiles} checked source file(s).`);
  for (const issue of issues) {
    console.error(`${issue.file}:${issue.line}:${issue.column} [${issue.rule}] ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`KForge lint passed: ${scannedFiles} source file(s) checked; no syntax, merge-marker, debugger, or TypeScript-suppression violations found.`);
}
