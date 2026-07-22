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
  assert.doesNotMatch(markdown, /<img|<script|javascript:/u);
  assert.match(markdown, /&lt;script&gt;/u);
});

test("Markdown output cannot break out of a table cell or code span", () => {
  const report: ReportData = {
    command: "index", title: "Unsafe", root: ".", summary: { resources: 1 },
    resources: [{
      id: "prompt:unsafe", name: "[click](javascript:alert(1))", kind: "prompt",
      description: "</td></tr><script>alert(2)</script>", tags: ["` | injected"],
      path: "` | </td><img src=x onerror=alert(3)>.prompt.md"
    }]
  };
  const markdown = formatReport(report, "markdown");
  assert.doesNotMatch(markdown, /<script|<img|<\/td>|\]\(javascript:/u);
  assert.match(markdown, /\\\[click\\\]\\\(javascript:alert\\\(1\\\)\\\)/u);
});

test("empty search reports have useful empty states", () => {
  const report: ReportData = { command: "find", title: "Matches", root: ".", query: "rare task", hits: [], summary: { matches: 0 } };
  assert.match(formatReport(report, "markdown"), /No matching resources/u);
  assert.match(formatReport(report, "html"), /Nothing to show yet/u);
});

test("composition reports disclose additions, gaps, and lexical limits safely", () => {
  const report: ReportData = {
    command: "compose",
    title: "Composition",
    root: ".",
    query: `review ${MALICIOUS}`,
    summary: { selectedResources: 1, lexicalCoveragePercent: 50 },
    composition: {
      queryTerms: ["review", "missing<script>"],
      coveredTerms: ["review"],
      uncoveredTerms: ["missing<script>"],
      lexicalCoveragePercent: 50,
      picks: [{
        resource: REPORT.resources![0]!, score: 2, matchedTerms: ["review"],
        newTerms: ["review"], cumulativeCoveragePercent: 50
      }]
    }
  };
  const json = formatReport(report, "json");
  const markdown = formatReport(report, "markdown");
  const html = formatReport(report, "html");
  assert.equal(JSON.parse(json).schemaVersion, "1.1");
  assert.match(markdown, /Newly covered terms/u);
  assert.match(markdown, /Still uncovered/u);
  assert.match(markdown, /not a semantic capability guarantee/u);
  assert.match(html, /Cumulative lexical coverage/u);
  assert.match(html, /Still uncovered: missing&lt;script&gt;/u);
  assert.match(html, /not a semantic capability guarantee/u);
  assert.doesNotMatch(html, /<img src=x|<script>alert/u);
});
