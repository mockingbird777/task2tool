import type { AgentResource, CompositionPick, CompositionPlan, LintIssue, OutputFormat, ReportData, SearchHit } from "./types.js";
import { escapeHtml, escapeMarkdown, safeJson, terminalLine } from "./text.js";

function jsonReport(report: ReportData): string {
  const payload: Record<string, unknown> = {
    schemaVersion: report.composition ? "1.2" : "1.0",
    command: report.command,
    title: report.title,
    root: report.root
  };
  if (report.query !== undefined) payload["query"] = report.query;
  payload["summary"] = report.summary;
  if (report.resources !== undefined) payload["resources"] = report.resources;
  if (report.hits !== undefined) payload["hits"] = report.hits;
  if (report.composition !== undefined) payload["composition"] = report.composition;
  if (report.issues !== undefined) payload["issues"] = report.issues;
  return safeJson(payload);
}

function oneLine(value: string): string {
  return escapeMarkdown(terminalLine(value));
}

function summaryMarkdown(summary: Readonly<Record<string, number | string>>): string {
  const rows = Object.entries(summary).map(([key, value]) => `| ${oneLine(key)} | ${oneLine(String(value))} |`);
  return ["| Metric | Value |", "| --- | ---: |", ...rows].join("\n");
}

function resourcesMarkdown(resources: readonly AgentResource[]): string {
  if (resources.length === 0) return "_No resources found._";
  const rows = resources.map((resource) =>
    `| ${oneLine(resource.name)} | ${resource.kind} | ${oneLine(resource.description || "—")} | ${oneLine(resource.path)} | ${resource.tags.map(oneLine).join(", ")} |`
  );
  return ["| Resource | Kind | Description | Source | Tags |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

function hitsMarkdown(hits: readonly SearchHit[]): string {
  if (hits.length === 0) return "_No matching resources._";
  const rows = hits.map((hit, index) =>
    `| ${index + 1} | ${oneLine(hit.resource.name)} | ${hit.resource.kind} | ${hit.score.toFixed(3)} | ${hit.matchedTerms.map(oneLine).join(", ")} | ${oneLine(hit.resource.description || "—")} |`
  );
  return ["| # | Resource | Kind | Score | Matched | Why it may help |", "| ---: | --- | --- | ---: | --- | --- |", ...rows].join("\n");
}

function compositionMarkdown(composition: CompositionPlan): string {
  const rows = composition.picks.map((pick, index) =>
    `| ${index + 1} | ${oneLine(pick.resource.name)} | ${pick.resource.kind} | ${pick.score.toFixed(3)} | ${pick.newTerms.map(oneLine).join(", ")} | ${pick.cumulativeCoveragePercent.toFixed(1)}% |`
  );
  const table = rows.length === 0
    ? "_No local resource adds lexical coverage for this task._"
    : ["| # | Resource | Kind | Relevance | Newly covered terms | Cumulative coverage |", "| ---: | --- | --- | ---: | --- | ---: |", ...rows].join("\n");
  const uncovered = composition.uncoveredTerms.length === 0 ? "none" : composition.uncoveredTerms.map(oneLine).join(", ");
  const ignored = composition.queryBoundary.ignoredTerms.map(oneLine).join(", ");
  const boundary = composition.queryBoundary.truncated
    ? [
        "",
        `> Query boundary: evaluated ${composition.queryTerms.length} of ${composition.queryBoundary.totalTerms} normalized terms (limit ${composition.queryBoundary.evaluatedTermLimit}). Terms outside the boundary count as uncovered in the percentage.`,
        "",
        `**Not evaluated:** ${ignored}`
      ]
    : [];
  return [
    `**Lexical coverage:** ${composition.lexicalCoveragePercent.toFixed(1)}%`,
    "",
    table,
    "",
    `**Still uncovered (evaluated terms):** ${uncovered}`,
    ...boundary,
    "",
    "> Coverage is based on normalized word overlap. It is explainable retrieval, not a semantic capability guarantee."
  ].join("\n");
}

function issuesMarkdown(issues: readonly LintIssue[]): string {
  if (issues.length === 0) return "✅ No catalog issues found.";
  const rows = issues.map((issue) =>
    `| ${issue.severity.toUpperCase()} | ${issue.code} | ${oneLine(issue.path)} | ${oneLine(issue.message)} |`
  );
  return ["| Severity | Code | Source | Message |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

function markdownReport(report: ReportData): string {
  const parts = [`# ${oneLine(report.title)}`, "", summaryMarkdown(report.summary)];
  if (report.query !== undefined) parts.push("", `> Query: ${oneLine(report.query)}`);
  if (report.resources !== undefined) parts.push("", "## Indexed resources", "", resourcesMarkdown(report.resources));
  if (report.hits !== undefined) parts.push("", "## Best matches", "", hitsMarkdown(report.hits));
  if (report.composition !== undefined) parts.push("", "## Composed capability set", "", compositionMarkdown(report.composition));
  if (report.issues !== undefined) parts.push("", "## Catalog health", "", issuesMarkdown(report.issues));
  parts.push("", "_Generated locally by Task2Tool._", "");
  return parts.join("\n");
}

function summaryHtml(summary: Readonly<Record<string, number | string>>): string {
  return Object.entries(summary).map(([key, value]) =>
    `<div class="metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(key)}</span></div>`
  ).join("");
}

function tagHtml(tag: string): string {
  return `<span class="tag">${escapeHtml(tag)}</span>`;
}

function resourceCard(resource: AgentResource, score?: number, matchedTerms: readonly string[] = [], composition?: Pick<CompositionPick, "newTerms" | "cumulativeCoveragePercent">): string {
  const searchable = [resource.name, resource.kind, resource.description, resource.tags.join(" "), resource.path, composition?.newTerms.join(" ") ?? ""].join(" ").toLocaleLowerCase("en-US");
  const details = resource.details
    ? `<dl>${Object.entries(resource.details).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`
    : "";
  return `<article class="resource" data-search="${escapeHtml(searchable)}">
    <div class="resource-head"><span class="kind">${escapeHtml(resource.kind)}</span>${score === undefined ? "" : `<span class="score">${score.toFixed(3)}</span>`}</div>
    <h2>${escapeHtml(resource.name)}</h2>
    <p>${escapeHtml(resource.description || "No description provided.")}</p>
    <div class="tags">${resource.tags.map(tagHtml).join("")}</div>
    ${matchedTerms.length === 0 ? "" : `<p class="matched">Matched: ${matchedTerms.map(escapeHtml).join(", ")}</p>`}
    ${composition === undefined ? "" : `<p class="coverage"><strong>Adds:</strong> ${composition.newTerms.map(escapeHtml).join(", ")}<br><strong>Cumulative lexical coverage:</strong> ${composition.cumulativeCoveragePercent.toFixed(1)}%</p>`}
    ${details}
    <code>${escapeHtml(resource.path)}</code>
  </article>`;
}

function issueCard(issue: LintIssue): string {
  const searchable = `${issue.severity} ${issue.code} ${issue.path} ${issue.message}`.toLocaleLowerCase("en-US");
  return `<article class="issue ${issue.severity}" data-search="${escapeHtml(searchable)}">
    <div><span class="kind">${escapeHtml(issue.severity)}</span><strong>${escapeHtml(issue.code)}</strong></div>
    <p>${escapeHtml(issue.message)}</p><code>${escapeHtml(issue.path)}</code>
  </article>`;
}

function htmlReport(report: ReportData): string {
  const cards = report.composition?.picks.map((pick) => resourceCard(pick.resource, pick.score, pick.matchedTerms, pick)).join("")
    ?? report.hits?.map((hit) => resourceCard(hit.resource, hit.score, hit.matchedTerms)).join("")
    ?? report.resources?.map((resource) => resourceCard(resource)).join("")
    ?? report.issues?.map(issueCard).join("")
    ?? "";
  const empty = cards ? "" : `<div class="empty">Nothing to show yet.</div>`;
  const coverageSummary = report.composition
    ? `<section class="coverage-note"><strong>${report.composition.lexicalCoveragePercent.toFixed(1)}% lexical coverage</strong><span>Covered: ${escapeHtml(report.composition.coveredTerms.join(", ") || "none")}</span><span>Still uncovered (evaluated terms): ${escapeHtml(report.composition.uncoveredTerms.join(", ") || "none")}</span>${report.composition.queryBoundary.truncated ? `<span><strong>Query boundary:</strong> evaluated ${report.composition.queryTerms.length} of ${report.composition.queryBoundary.totalTerms} normalized terms (limit ${report.composition.queryBoundary.evaluatedTermLimit}).</span><span>Not evaluated: ${escapeHtml(report.composition.queryBoundary.ignoredTerms.join(", "))}</span>` : ""}<small>Normalized word overlap;${report.composition.queryBoundary.truncated ? " terms outside the query boundary count as uncovered;" : ""} not a semantic capability guarantee.</small></section>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>${escapeHtml(report.title)}</title><style>
:root{color-scheme:dark;--bg:#07100d;--panel:#0d1a16;--text:#edf8f1;--muted:#91a99d;--lime:#a6ff80;--aqua:#66eed1;--line:#20372e;--danger:#ff7e8d}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 18% 0,#16372b 0,transparent 35rem),var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif}main{width:min(1120px,calc(100% - 32px));margin:auto;padding:64px 0}header{display:grid;gap:18px;margin-bottom:34px}.eyebrow{color:var(--lime);font:700 12px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}h1{font-size:clamp(40px,7vw,76px);line-height:.95;letter-spacing:-.055em;margin:0;max-width:820px}header p{color:var(--muted);font-size:18px;margin:0;max-width:720px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.metric{background:#0d1a16cc;border:1px solid var(--line);border-radius:16px;padding:16px}.metric strong{display:block;color:var(--aqua);font-size:24px}.metric span{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.toolbar{position:sticky;top:12px;z-index:2;margin:24px 0}input{width:100%;padding:16px 18px;background:#0b1713e8;border:1px solid #315443;border-radius:14px;color:var(--text);font:inherit;box-shadow:0 12px 40px #0007;outline:none}input:focus{border-color:var(--lime)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}.resource,.issue{min-width:0;background:linear-gradient(145deg,#10221b,#0b1612);border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:0 16px 40px #0003}.resource:hover{border-color:#47745f;transform:translateY(-2px);transition:.18s}.resource-head{display:flex;justify-content:space-between}.kind,.score,.tag{display:inline-flex;border:1px solid #315443;border-radius:999px;padding:3px 9px;color:var(--aqua);font:700 11px/1.4 ui-monospace,monospace}.score{color:var(--lime)}h2{font-size:22px;line-height:1.15;margin:18px 0 8px}.resource p,.issue p{color:var(--muted)}.tags{display:flex;flex-wrap:wrap;gap:5px;margin:18px 0}.tag{color:#a8beb3;border-color:var(--line)}code{display:block;overflow:hidden;text-overflow:ellipsis;color:#749486;font:12px ui-monospace,monospace;white-space:nowrap}.matched,.coverage{font-size:12px!important;color:var(--aqua)!important}.coverage{border-top:1px solid var(--line);padding-top:10px}.coverage strong{color:var(--lime)}dl{border-top:1px solid var(--line);padding-top:10px}dl div{display:flex;gap:8px}dt{color:var(--muted)}dd{margin:0}.issue{grid-column:1/-1}.issue.error{border-left:3px solid var(--danger)}.issue.warning{border-left:3px solid #ffc66d}.issue strong{margin-left:10px}.empty{border:1px dashed var(--line);border-radius:20px;padding:60px;text-align:center;color:var(--muted)}footer{color:var(--muted);margin-top:36px;font-size:12px}.hidden{display:none}@media(max-width:600px){main{padding:36px 0}h1{font-size:44px}}
.coverage-note{display:grid;gap:5px;margin:20px 0;padding:16px 18px;border:1px solid #315443;border-radius:16px;background:#0b1713}.coverage-note strong{color:var(--lime)}.coverage-note span,.coverage-note small{color:var(--muted);overflow-wrap:anywhere}
</style></head><body><main><header><span class="eyebrow">Task2Tool / ${escapeHtml(report.command)}</span><h1>${escapeHtml(report.title)}</h1>
<p>${report.query === undefined ? "A compact, local view of the agent resources already on your machine." : report.command === "compose" ? `A complementary local set for “${escapeHtml(report.query)}”, selected by marginal lexical coverage.` : `Best local matches for “${escapeHtml(report.query)}”.`}</p></header>
<section class="metrics">${summaryHtml(report.summary)}</section>${coverageSummary}<div class="toolbar"><input id="filter" type="search" autocomplete="off" placeholder="Filter this report…" aria-label="Filter this report"></div>
<section class="grid" id="results">${cards}${empty}</section><footer>Generated locally by Task2Tool · no telemetry · no cloud dependency</footer></main>
<script>const input=document.getElementById('filter');const cards=[...document.querySelectorAll('[data-search]')];input.addEventListener('input',()=>{const q=input.value.toLocaleLowerCase().trim();for(const card of cards)card.classList.toggle('hidden',q&&!card.dataset.search.includes(q));});</script>
</body></html>\n`;
}

export function formatReport(report: ReportData, format: OutputFormat): string {
  if (format === "json") return jsonReport(report);
  if (format === "markdown") return markdownReport(report);
  return htmlReport(report);
}
