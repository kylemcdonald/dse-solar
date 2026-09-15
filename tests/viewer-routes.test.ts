import assert from "node:assert/strict";
import test from "node:test";
import { parseViewerPath, tabsForProject, viewerHref } from "../app/viewerRoutes";

test("every visible project tab has a unique route that resolves back to its view", () => {
  const paths = new Set<string>();
  for (const project of ["dse", "polowat"] as const) {
    for (const tab of tabsForProject(project)) {
      const href = viewerHref(project, tab.id);
      assert.ok(!paths.has(href));
      paths.add(href);
      assert.deepEqual(parseViewerPath(href), { project, mode: tab.id });
    }
  }
  assert.equal(paths.size, 14);
  assert.equal(viewerHref("polowat", "cost"), "/polowat/costs");
});

test("project switches preserve shared tabs and fall back for Fiji-only tabs", () => {
  assert.equal(viewerHref("polowat", "bom"), "/polowat/bom");
  assert.equal(viewerHref("polowat", "simple"), "/polowat/diagram");
  assert.equal(viewerHref("polowat", "cables"), "/polowat/diagram");
  assert.deepEqual(parseViewerPath("/"), { project: "dse", mode: "diagram" });
  assert.deepEqual(parseViewerPath("/fiji"), { project: "dse", mode: "diagram" });
  assert.deepEqual(parseViewerPath("/polowat/"), { project: "polowat", mode: "diagram" });
  for (const invalid of ["/polowat/simple", "/polowat/cables", "/fiji/unknown", "/dse/bom", "/unknown/bom", "/fiji/bom/extra", "/fiji//bom"]) {
    assert.equal(parseViewerPath(invalid), null, invalid);
  }
});
