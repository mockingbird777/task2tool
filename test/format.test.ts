import assert from "node:assert/strict";
import test from "node:test";
import { formatReport } from "../src/format.js";
import { stripTerminalControls } from "../src/text.js";
import type { ReportData } from "../src/types.js";

const MALICIOUS = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
const TERMINAL_PAYLOAD = `safe\u001b]52;c;Zm9v\u0007middle\u009d0;C1TITLE\u009c\u001bP1;2|DCS_PAYLOAD\u001b\\\u001b]8;;https://malicious.invalid\u001b\\link\u001b]8;;\u001b\\\u009b31m\u001b(0unsafe`;
const TERMINAL_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
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

test("terminal sanitizer removes every disallowed C0/C1 code point and preserves controlled whitespace", () => {
  const controls = [
    ...Array.from({ length: 32 }, (_, code) => code),
    ...Array.from({ length: 33 }, (_, offset) => offset + 127)
  ].filter((code) => code !== 0x09 && code !== 0x0a && code !== 0x0d)
    .map((code) => String.fromCharCode(code))
    .join("");
  assert.doesNotMatch(stripTerminalControls(`before${controls}after`), TERMINAL_CONTROLS);
  assert.equal(stripTerminalControls("tab\tline\nreturn\r"), "tab\tline\nreturn\r");
  assert.equal(stripTerminalControls(`A\u001b]0;title\u0018VISIBLE`), "AVISIBLE");
  assert.equal(stripTerminalControls(`A\u001b[31\u001aVISIBLE`), "AVISIBLE");
});

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

test("human-readable reports remove terminal-active C0 and C1 controls", () => {
  const report: ReportData = {
    command: "index",
    title: TERMINAL_PAYLOAD,
    root: ".",
    summary: { resources: 1 },
    resources: [{
      id: "prompt:terminal",
      name: TERMINAL_PAYLOAD,
      kind: "prompt",
      description: TERMINAL_PAYLOAD,
      tags: [TERMINAL_PAYLOAD],
      path: TERMINAL_PAYLOAD
    }]
  };
  const markdown = formatReport(report, "markdown");
  const html = formatReport(report, "html");
  const json = formatReport(report, "json");
  assert.doesNotMatch(markdown, TERMINAL_CONTROLS);
  assert.doesNotMatch(html, TERMINAL_CONTROLS);
  assert.doesNotMatch(json, TERMINAL_CONTROLS);
  assert.doesNotMatch(markdown, /(?:\]52|Zm9v|C1TITLE|DCS_PAYLOAD|malicious\.invalid|\]8;;|31m|\(0)/u);
  assert.doesNotMatch(html, /(?:\]52|Zm9v|C1TITLE|DCS_PAYLOAD|malicious\.invalid|\]8;;|31m|\(0)/u);
  assert.match(markdown, /safemiddlelinkunsafe/u);
  assert.match(json, /\\u009b31m/u);
  assert.equal((JSON.parse(json) as { resources: Array<{ name: string }> }).resources[0]?.name, TERMINAL_PAYLOAD);
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
      queryBoundary: { evaluatedTermLimit: 256, totalTerms: 2, truncated: false, ignoredTerms: [] },
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
  assert.equal(JSON.parse(json).schemaVersion, "1.2");
  assert.match(markdown, /Newly covered terms/u);
  assert.match(markdown, /Still uncovered/u);
  assert.match(markdown, /not a semantic capability guarantee/u);
  assert.match(html, /Cumulative lexical coverage/u);
  assert.match(html, /Still uncovered \(evaluated terms\): missing&lt;script&gt;/u);
  assert.match(html, /not a semantic capability guarantee/u);
  assert.doesNotMatch(html, /<img src=x|<script>alert/u);
});

test("composition reports disclose bounded query evaluation in every format", () => {
  const report: ReportData = {
    command: "compose",
    title: "Bounded composition",
    root: ".",
    query: "covered overflow",
    summary: { lexicalCoveragePercent: 50 },
    composition: {
      queryBoundary: { evaluatedTermLimit: 1, totalTerms: 2, truncated: true, ignoredTerms: ["overflow"] },
      queryTerms: ["covered"],
      coveredTerms: ["covered"],
      uncoveredTerms: [],
      lexicalCoveragePercent: 50,
      picks: []
    }
  };
  const json = JSON.parse(formatReport(report, "json")) as { composition: { queryBoundary: { ignoredTerms: string[] } } };
  const markdown = formatReport(report, "markdown");
  const html = formatReport(report, "html");
  assert.deepEqual(json.composition.queryBoundary.ignoredTerms, ["overflow"]);
  assert.match(markdown, /evaluated 1 of 2 normalized terms/u);
  assert.match(markdown, /Not evaluated:\*\* overflow/u);
  assert.match(html, /evaluated 1 of 2 normalized terms/u);
  assert.match(html, /Not evaluated: overflow/u);
});
