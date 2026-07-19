import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { RESOURCE_KINDS, type LintIssue, type ResourceKind, type ScanResult, type ScannedResource } from "./types.js";
import { uniqueSorted } from "./text.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage", ".task2tool"]);
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 1_048_576;
const MAX_CORPUS_CHARACTERS = 65_536;

interface MarkdownMetadata {
  name?: string;
  description?: string;
  tags: string[];
}

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean || undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueSorted(value.flatMap((item) => typeof item === "string" ? [item] : []));
  }
  if (typeof value !== "string") return [];
  const unwrapped = value.trim().replace(/^\[/u, "").replace(/\]$/u, "");
  return uniqueSorted(unwrapped.split(",").map((item) => item.trim().replace(/^['"]|['"]$/gu, "")));
}

function parseFrontmatter(content: string): { metadata: MarkdownMetadata; body: string } {
  const metadata: MarkdownMetadata = { tags: [] };
  const normalized = content.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return { metadata, body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return { metadata, body: normalized };

  const header = normalized.slice(4, end);
  for (const line of header.split("\n")) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/u.exec(line);
    if (!match) continue;
    const key = (match[1] ?? "").toLocaleLowerCase("en-US");
    const value = (match[2] ?? "").trim().replace(/^['"]|['"]$/gu, "");
    if (key === "name" && value) metadata.name = value;
    if ((key === "description" || key === "summary") && value) metadata.description = value;
    if (key === "tags" || key === "keywords") metadata.tags.push(...stringList(value));
  }
  metadata.tags = uniqueSorted(metadata.tags);
  return { metadata, body: normalized.slice(end + 5) };
}

function markdownSummary(body: string): { heading?: string; description?: string; headings: string[] } {
  const lines = body.split("\n");
  const headings = lines
    .flatMap((line) => {
      const match = /^#{1,3}\s+(.+?)\s*#*$/u.exec(line.trim());
      return match?.[1] ? [match[1].trim()] : [];
    })
    .slice(0, 12);
  const heading = headings[0];
  const paragraph: string[] = [];
  let inCode = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !line || line.startsWith("#") || line.startsWith("<!--")) {
      if (paragraph.length > 0 && !line) break;
      continue;
    }
    if (/^[-*+]\s/u.test(line) || /^\d+[.)]\s/u.test(line)) continue;
    paragraph.push(line);
    if (paragraph.join(" ").length >= 280) break;
  }

  const description = cleanString(paragraph.join(" "))?.slice(0, 360);
  return { ...(heading ? { heading } : {}), ...(description ? { description } : {}), headings };
}

function slug(value: string): string {
  const clean = value.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "");
  return clean || createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function markdownKind(fileName: string): ResourceKind | undefined {
  const lower = fileName.toLocaleLowerCase("en-US");
  if (lower === "skill.md" || lower.endsWith(".skill.md")) return "skill";
  if (lower.endsWith(".agent.md")) return "agent";
  if (lower.endsWith(".prompt.md")) return "prompt";
  return undefined;
}

function markdownResource(content: string, resourcePath: string, kind: ResourceKind): ScannedResource {
  const { metadata, body } = parseFrontmatter(content);
  const summary = markdownSummary(body);
  const fallback = basename(resourcePath).replace(/\.(skill|agent|prompt)?\.md$/iu, "");
  const name = metadata.name ?? summary.heading ?? fallback;
  const description = metadata.description ?? summary.description ?? "";
  const details = summary.headings.length > 1 ? { sections: summary.headings.slice(1, 7).join(", ") } : undefined;
  return {
    id: `${kind}:${resourcePath.toLocaleLowerCase("en-US")}`,
    name,
    kind,
    description,
    tags: uniqueSorted([kind, ...metadata.tags]),
    path: resourcePath,
    ...(details ? { details } : {}),
    corpus: `${name}\n${description}\n${metadata.tags.join(" ")}\n${summary.headings.join(" ")}\n${body.slice(0, MAX_CORPUS_CHARACTERS)}`
  };
}

function candidateJson(fileName: string): boolean {
  const lower = fileName.toLocaleLowerCase("en-US");
  return lower === "mcp.json" || lower === ".mcp.json" || lower === "mcp-config.json"
    || lower === "task2tool.json" || lower === "catalog.json" || lower.endsWith(".catalog.json");
}

function mcpResources(value: Record<string, unknown>, resourcePath: string, diagnostics: LintIssue[]): ScannedResource[] {
  const rawServers = value["mcpServers"];
  if (!recordValue(rawServers)) return [];
  const resources: ScannedResource[] = [];

  for (const serverName of Object.keys(rawServers).sort()) {
    const rawServer = rawServers[serverName];
    if (!recordValue(rawServer)) {
      diagnostics.push({ severity: "error", code: "INVALID_MCP_SERVER", message: `MCP server '${serverName}' must be an object.`, path: resourcePath });
      continue;
    }
    const description = cleanString(rawServer["description"]) ?? `MCP server configuration for ${serverName}.`;
    const command = cleanString(rawServer["command"]);
    const transport = cleanString(rawServer["transport"]) ?? cleanString(rawServer["type"]);
    const tags = uniqueSorted(["mcp", "server", ...stringList(rawServer["tags"]), ...(transport ? [transport] : [])]);
    const details: Record<string, string> = {};
    if (command) details["command"] = command;
    if (transport) details["transport"] = transport;
    if (!command && !transport && typeof rawServer["url"] !== "string") {
      diagnostics.push({ severity: "warning", code: "MCP_LAUNCH_MISSING", message: `MCP server '${serverName}' has no command, transport, or URL.`, path: resourcePath });
    }

    const environment = rawServer["env"];
    if (recordValue(environment)) {
      for (const [key, secretValue] of Object.entries(environment)) {
        if (!/(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/iu.test(key) || typeof secretValue !== "string") continue;
        if (secretValue && !/^\$\{[^}]+\}$/u.test(secretValue) && !/^\$[A-Z_][A-Z0-9_]*$/u.test(secretValue)) {
          diagnostics.push({
            severity: "warning",
            code: "INLINE_SECRET",
            message: `Environment value '${key}' for '${serverName}' looks inline; reference an environment variable instead.`,
            path: resourcePath,
            resourceId: `mcp-server:${resourcePath.toLocaleLowerCase("en-US")}#${slug(serverName)}`
          });
        }
      }
    }

    resources.push({
      id: `mcp-server:${resourcePath.toLocaleLowerCase("en-US")}#${slug(serverName)}`,
      name: serverName,
      kind: "mcp-server",
      description,
      tags,
      path: resourcePath,
      ...(Object.keys(details).length > 0 ? { details } : {}),
      corpus: `${serverName}\n${description}\n${tags.join(" ")}\n${command ?? ""}\n${transport ?? ""}`
    });
  }
  return resources;
}

function asResourceKind(value: unknown): ResourceKind {
  return typeof value === "string" && (RESOURCE_KINDS as readonly string[]).includes(value) ? value as ResourceKind : "catalog";
}

function catalogResources(value: Record<string, unknown>, resourcePath: string, diagnostics: LintIssue[]): ScannedResource[] {
  const rawResources = value["resources"];
  const looksLikeCatalog = Array.isArray(rawResources)
    && (value["$schema"] === "https://raw.githubusercontent.com/mockingbird777/task2tool/main/schema/catalog-v1.schema.json" || value["catalogVersion"] !== undefined || value["name"] !== undefined);
  if (!looksLikeCatalog || !Array.isArray(rawResources)) return [];
  const resources: ScannedResource[] = [];

  for (const [index, rawResource] of rawResources.entries()) {
    if (!recordValue(rawResource)) {
      diagnostics.push({ severity: "error", code: "INVALID_CATALOG_ENTRY", message: `Catalog entry ${index} must be an object.`, path: resourcePath });
      continue;
    }
    const name = cleanString(rawResource["name"]) ?? "";
    const kind = asResourceKind(rawResource["kind"]);
    const description = cleanString(rawResource["description"]) ?? "";
    const tags = uniqueSorted([kind, ...stringList(rawResource["tags"]), ...stringList(rawResource["capabilities"])]);
    const explicitId = cleanString(rawResource["id"]);
    const id = explicitId ? `catalog:${slug(explicitId)}` : `${kind}:${resourcePath.toLocaleLowerCase("en-US")}#${slug(name || String(index))}`;
    const locator = cleanString(rawResource["path"]) ?? cleanString(rawResource["url"]);
    if (!name) diagnostics.push({ severity: "error", code: "NAME_MISSING", message: `Catalog entry ${index} has no name.`, path: resourcePath, resourceId: id });
    if (!description) diagnostics.push({ severity: "warning", code: "DESCRIPTION_MISSING", message: `Catalog entry '${name || index}' has no description.`, path: resourcePath, resourceId: id });
    resources.push({
      id,
      name: name || `Entry ${index + 1}`,
      kind,
      description,
      tags,
      path: resourcePath,
      ...(locator ? { details: { locator } } : {}),
      corpus: `${name}\n${description}\n${tags.join(" ")}\n${stringList(rawResource["capabilities"]).join(" ")}`
    });
  }
  return resources;
}

export async function scanWorkspace(rootInput: string): Promise<ScanResult> {
  const root = resolve(rootInput);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new Error(`Scan root is not a directory: ${rootInput}`);
  const resources: ScannedResource[] = [];
  const diagnostics: LintIssue[] = [];
  let filesVisited = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      if (filesVisited >= MAX_FILES) return;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      filesVisited += 1;
      const resourcePath = toPosix(relative(root, absolutePath));
      const kind = markdownKind(entry.name);
      const isJson = extname(entry.name).toLocaleLowerCase("en-US") === ".json";
      if (!kind && !isJson) continue;
      const fileStat = await lstat(absolutePath);
      if (fileStat.size > MAX_FILE_BYTES) {
        if (kind || candidateJson(entry.name)) diagnostics.push({ severity: "warning", code: "FILE_TOO_LARGE", message: `File exceeds the ${MAX_FILE_BYTES} byte scan limit.`, path: resourcePath });
        continue;
      }
      const content = await readFile(absolutePath, "utf8");
      if (kind) {
        const resource = markdownResource(content, resourcePath, kind);
        if (!resource.description) diagnostics.push({ severity: "warning", code: "DESCRIPTION_MISSING", message: `Resource '${resource.name}' has no description.`, path: resourcePath, resourceId: resource.id });
        resources.push(resource);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch {
        if (candidateJson(entry.name)) diagnostics.push({ severity: "error", code: "INVALID_JSON", message: "Candidate catalog or MCP configuration is not valid JSON.", path: resourcePath });
        continue;
      }
      if (!recordValue(parsed)) continue;
      resources.push(...mcpResources(parsed, resourcePath, diagnostics));
      resources.push(...catalogResources(parsed, resourcePath, diagnostics));
    }
  }

  await visit(root);
  resources.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  diagnostics.sort((left, right) => `${left.path}:${left.code}:${left.message}`.localeCompare(`${right.path}:${right.code}:${right.message}`, "en"));
  return { root: toPosix(root), resources, diagnostics, filesVisited };
}

export function publicResource(resource: ScannedResource): import("./types.js").AgentResource {
  const { corpus: _corpus, ...publicFields } = resource;
  return publicFields;
}
