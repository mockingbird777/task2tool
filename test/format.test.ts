import assert from "node:assert/strict";
import test from "node:test";
import { formatReport } from "../src/format.js";
import type { ReportData } from "../src/types.js";

const MALICIOUS = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
const REPORT: ReportData = {
  command: "index",
  title: `Shelf ${MALICIOUS}`,
  root: "/tmp/<unsafe>",
  resources: [{
    id: "prompt:x", name: MALICIOUS, kind: "prompt", description: `Use | pipes ${MALICIOUS}`,
    tags: ["xss<script>"], path: "bad|name.prompt.md", details: { locator: `javascript:${MALICIOUS}` }
  }],
  summary: { resources: 1 }
};

test("HTML output escapes untrusted resource data", () => {
  const html = formatReport(REPORT, "html");
  assert.doesNotMatch(html, /<img src=x|<script>alert/u);
  assert.match(html, /&lt;script&gt;alert/u);
  assert.match(html, /Content-Security-Policy/u);
});

test("JSON output neutralizes HTML-significant characters", () => {
  const json = formatReport(REPORT, "json");
  assert.doesNotMatch(json, /<script>/u);
  assert.match(json, /\\u003cscript\\u003e/u);
  assert.equal(JSON.parse(json).resources[0].kind, "prompt");
});

test("Markdown tables escape pipes and backticks", () => {
  const markdown = formatReport(REPORT, "markdown");
  assert.match(markdown, /Use \\| pipes/u);
  assert.match(markdown, /bad\\\|name/u);
});

test("empty search reports have useful empty states", () => {
  const report: ReportData = { command: "find", title: "Matches", root: ".", query: "rare task", hits: [], summary: { matches: 0 } };
  assert.match(formatReport(report, "markdown"), /No matching resources/u);
  assert.match(formatReport(report, "html"), /Nothing to show yet/u);
});
