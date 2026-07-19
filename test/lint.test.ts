import assert from "node:assert/strict";
import test from "node:test";
import { lintScan } from "../src/lint.js";
import type { ScanResult } from "../src/types.js";

test("detects duplicate ids and missing descriptions", () => {
  const scan: ScanResult = {
    root: "/tmp/catalog", filesVisited: 2, diagnostics: [],
    resources: [
      { id: "catalog:same", name: "One", kind: "catalog", description: "", tags: [], path: "a.json", corpus: "" },
      { id: "catalog:same", name: "Two", kind: "catalog", description: "Useful", tags: [], path: "b.json", corpus: "" }
    ]
  };
  const issues = lintScan(scan);
  assert.equal(issues.filter((issue) => issue.code === "DUPLICATE_ID").length, 2);
  assert.equal(issues.filter((issue) => issue.code === "DESCRIPTION_MISSING").length, 1);
  assert.equal(issues[0]?.severity, "error");
});

test("preserves and sorts scanner diagnostics", () => {
  const scan: ScanResult = {
    root: "/tmp/catalog", filesVisited: 0, resources: [],
    diagnostics: [
      { severity: "warning", code: "W", message: "warning", path: "z" },
      { severity: "error", code: "E", message: "error", path: "a" }
    ]
  };
  assert.deepEqual(lintScan(scan).map((issue) => issue.code), ["E", "W"]);
});
