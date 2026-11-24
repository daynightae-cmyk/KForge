import { describe, expect, it } from "vitest";
import { parseGitStatusPorcelainZ, formatGitStatusChanges } from "./gitStatus";

describe("git status porcelain -z parsing", () => {
  it("keeps a leading column for the FIRST record instead of trimming it", () => {
    const output = " M alpha.txt\0M  delta.txt\0?? new.txt\0";
    const changes = parseGitStatusPorcelainZ(output);
    expect(changes.map((entry) => entry.file)).toEqual(["alpha.txt", "delta.txt", "new.txt"]);
    expect(changes[0]).toMatchObject({ indexStatus: " ", worktreeStatus: "M", staged: false, unstaged: true, untracked: false });
    expect(changes[1]).toMatchObject({ indexStatus: "M", worktreeStatus: " ", staged: true, unstaged: false });
  });

  it("reads the original path of a staged rename from its own token", () => {
    const output = "R  moved file.txt\0base.txt\0?? other.txt\0";
    const changes = parseGitStatusPorcelainZ(output);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ file: "moved file.txt", originalFile: "base.txt", staged: true, untracked: false });
    expect(changes[1]).toMatchObject({ file: "other.txt", untracked: true });
  });

  it("skips the branch header and parses the records that follow it", () => {
    const output = "## main\0 M alpha.txt\0";
    expect(parseGitStatusPorcelainZ(output)).toMatchObject([{ file: "alpha.txt", worktreeStatus: "M" }]);
    expect(parseGitStatusPorcelainZ("## main\0")).toEqual([]);
  });

  it("preserves spaces, quotes and unicode in a path", () => {
    const output = "?? my folder/a \"quoted\" file.txt\0?? unicode-\u00f8.txt\0";
    expect(parseGitStatusPorcelainZ(output).map((entry) => entry.file)).toEqual(["my folder/a \"quoted\" file.txt", "unicode-\u00f8.txt"]);
  });

  it("renders the parsed truth back into porcelain v1 text", () => {
    const changes = parseGitStatusPorcelainZ("R  new.txt\0old.txt\0 M kept.txt\0");
    expect(formatGitStatusChanges(changes)).toBe("R  old.txt -> new.txt\n M kept.txt");
  });

  it("returns no changes for an empty or header-only buffer", () => {
    expect(parseGitStatusPorcelainZ("")).toEqual([]);
    expect(parseGitStatusPorcelainZ("## main\0")).toEqual([]);
  });
});

