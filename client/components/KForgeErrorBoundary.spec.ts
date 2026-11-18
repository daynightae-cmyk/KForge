import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KForgeErrorBoundary, KForgeErrorFallback } from "./KForgeErrorBoundary";

describe("KForge renderer error boundary", () => {
  it("renders an accessible recovery surface with a support reference", () => {
    const html = renderToStaticMarkup(createElement(KForgeErrorFallback, { errorId: "KF-TEST-1", onReload: () => undefined }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("KNOuX Forge could not render this view.");
    expect(html).toContain("KF-TEST-1");
    expect(html).toContain("Reload workbench");
    expect(html).toContain("Return to start");
  });

  it("renders the workbench while no renderer failure is recorded", () => {
    const html = renderToStaticMarkup(createElement(KForgeErrorBoundary, null, createElement("p", null, "workbench ready")));
    expect(html).toContain("workbench ready");
  });
});
