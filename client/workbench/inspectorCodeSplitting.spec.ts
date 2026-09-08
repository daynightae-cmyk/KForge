import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("Canonical Inspector code splitting", () => {
  it("keeps the canonical inspector outside the Workbench core and nests specialized inspectors", () => {
    const workbench = read("./KForgeWorkbench.tsx");
    const surfaces = read("./surfaces.tsx");
    const inspector = read("./CanonicalInspector.tsx");
    expect(workbench).toContain('lazy(() => import("./CanonicalInspector"))');
    expect(workbench).toContain("<Suspense fallback=");
    expect(surfaces).not.toContain("CanonicalInspector");
    expect(surfaces).not.toContain("KForgeInspector");
    expect(inspector).toContain('import("@/components/ui/KForgeInspector")');
    expect(inspector).toContain('import("./PreviewRuntimeInspector")');
  });
});
