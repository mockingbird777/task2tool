import type { LintIssue, ScanResult } from "./types.js";

export function lintScan(scan: ScanResult): LintIssue[] {
  const issues = [...scan.diagnostics];
  const ids = new Map<string, string[]>();

  for (const resource of scan.resources) {
    const paths = ids.get(resource.id) ?? [];
    paths.push(resource.path);
    ids.set(resource.id, paths);
    if (!resource.name.trim()) {
      issues.push({ severity: "error", code: "NAME_MISSING", message: "Resource has no display name.", path: resource.path, resourceId: resource.id });
    }
    if (!resource.description.trim()) {
      issues.push({ severity: "warning", code: "DESCRIPTION_MISSING", message: `Resource '${resource.name}' has no description.`, path: resource.path, resourceId: resource.id });
    }
    if (resource.description.length > 360) {
      issues.push({ severity: "warning", code: "DESCRIPTION_LONG", message: `Resource '${resource.name}' has a description longer than 360 characters.`, path: resource.path, resourceId: resource.id });
    }
  }

  for (const [id, paths] of ids) {
    if (paths.length < 2) continue;
    for (const path of paths) {
      issues.push({ severity: "error", code: "DUPLICATE_ID", message: `Resource id '${id}' appears ${paths.length} times.`, path, resourceId: id });
    }
  }

  const deduplicated = [...new Map(issues.map((issue) => [
    `${issue.severity}:${issue.code}:${issue.path}:${issue.resourceId ?? ""}`,
    issue
  ])).values()];
  deduplicated.sort((left, right) => {
    const severityOrder = left.severity === right.severity ? 0 : left.severity === "error" ? -1 : 1;
    return severityOrder || `${left.path}:${left.code}:${left.message}`.localeCompare(`${right.path}:${right.code}:${right.message}`, "en");
  });
  return deduplicated;
}
