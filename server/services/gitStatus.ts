export interface GitFileChange {
  file: string;
  originalFile?: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

const STATUS_CODES = new Set([" ", "M", "A", "D", "R", "C", "U", "!", "?", "T"]);

/**
 * Parse `git status --porcelain=v1 -z`.
 *
 * The NUL-delimited form is the only form that can be read without guessing:
 * paths arrive verbatim (no C-style quoting, no escaped unicode or spaces), and
 * a rename/copy emits its destination record followed by the original path as
 * the next entry.
 *
 * A line-oriented reader that trims the whole buffer eats the first character
 * of the first path, because porcelain v1 starts every record with the two
 * index/worktree status columns.
 */
export function parseGitStatusPorcelainZ(output: string): GitFileChange[] {
  const changes: GitFileChange[] = [];
  if (!output) return changes;
  const tokens = output.split("\0");
  // `git status --branch -z` prefixes the listing with a `## ...` header.
  let cursor = tokens[0] && tokens[0].startsWith("## ") ? 1 : 0;
  for (; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (!token) continue;
    const indexStatus = token[0];
    const worktreeStatus = token[1];
    if (token[2] !== " " || !STATUS_CODES.has(indexStatus) || !STATUS_CODES.has(worktreeStatus)) continue;
    const file = token.slice(3);
    if (!file) continue;
    const renamed = indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C";
    const originalFile = renamed ? tokens[cursor + 1] : undefined;
    if (renamed && originalFile) cursor += 1;
    changes.push({
      file,
      ...(originalFile ? { originalFile } : {}),
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== " " && indexStatus !== "?" && indexStatus !== "!",
      unstaged: worktreeStatus !== " " && worktreeStatus !== "!",
      untracked: indexStatus === "?" && worktreeStatus === "?",
    });
  }
  return changes;
}

/** Render parsed changes back into porcelain v1's human-readable shape. */
export function formatGitStatusChanges(changes: GitFileChange[]): string {
  return changes.map((entry) => {
    if (!entry.originalFile) return `${entry.indexStatus}${entry.worktreeStatus} ${entry.file}`;
    return `${entry.indexStatus}${entry.worktreeStatus} ${entry.originalFile} -> ${entry.file}`;
  }).join("\n");
}