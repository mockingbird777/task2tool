import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { RESOURCE_KINDS, type LintIssue, type ResourceKind, type ScanResult, type ScannedResource } from "./types.js";
import { uniqueSorted } from "./text.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage", ".task2tool"]);
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 1_048_576;
const MAX_CORPUS_CHARACTERS = 65_536;
const MAX_TOTAL_INPUT_BYTES = 67_108_864;
const MAX_TOTAL_CORPUS_CHARACTERS = 16_777_216;
const MAX_RESOURCES = 20_000;
const MAX_ENTRIES_PER_DOCUMENT = 5_000;
const MAX_DIAGNOSTICS = 1_000;
const MAX_LIST_ITEMS = 256;

export interface ScanLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalInputBytes: number;
  maxTotalCorpusCharacters: number;
  maxResources: number;
  maxEntriesPerDocument: number;
  maxDiagnostics: number;
}

const DEFAULT_LIMITS: ScanLimits = {
  maxFiles: MAX_FILES,
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalInputBytes: MAX_TOTAL_INPUT_BYTES,
  maxTotalCorpusCharacters: MAX_TOTAL_CORPUS_CHARACTERS,
  maxResources: MAX_RESOURCES,
  maxEntriesPerDocument: MAX_ENTRIES_PER_DOCUMENT,
  maxDiagnostics: MAX_DIAGNOSTICS
};

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
    return uniqueSorted(value.slice(0, MAX_LIST_ITEMS).flatMap((item) => typeof item === "string" ? [item] : []));
  }
  if (typeof value !== "string") return [];
  const unwrapped = value.trim().replace(/^\[/u, "").replace(/\]$/u, "");
  return uniqueSorted(unwrapped.split(",", MAX_LIST_ITEMS).map((item) => item.trim().replace(/^['"]|['"]$/gu, "")));
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
  const headings: string[] = [];
  for (const line of lines) {
    const match = /^#{1,3}\s+(.+?)\s*#*$/u.exec(line.trim());
    if (match?.[1]) headings.push(match[1].trim());
    if (headings.length >= 12) break;
  }
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
  // GitHub Copilot instruction conventions are prompt resources too.
  if (lower === "copilot-instructions.md" || lower.endsWith(".instructions.md")) return "prompt";
  return undefined;
}

function markdownResource(content: string, resourcePath: string, kind: ResourceKind): ScannedResource {
  const { metadata, body } = parseFrontmatter(content);
  const summary = markdownSummary(body);
  const fallback = basename(resourcePath).replace(/\.(skill|agent|prompt|instructions)?\.md$/iu, "");
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

type AddDiagnostic = (issue: LintIssue) => void;

function mcpResources(
  value: Record<string, unknown>,
  resourcePath: string,
  addDiagnostic: AddDiagnostic,
  maxEntries: number
): ScannedResource[] {
  const rawServers = value["mcpServers"];
  if (!recordValue(rawServers)) return [];
  const resources: ScannedResource[] = [];
  const serverNames = Object.keys(rawServers).sort();
  if (serverNames.length > maxEntries) {
    addDiagnostic({ severity: "warning", code: "ENTRY_LIMIT_REACHED", message: `MCP configuration exceeds the ${maxEntries} entry processing limit.`, path: resourcePath });
  }

  for (const serverName of serverNames.slice(0, maxEntries)) {
    const rawServer = rawServers[serverName];
    if (!recordValue(rawServer)) {
      addDiagnostic({ severity: "error", code: "INVALID_MCP_SERVER", message: `MCP server '${serverName}' must be an object.`, path: resourcePath });
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
      addDiagnostic({ severity: "warning", code: "MCP_LAUNCH_MISSING", message: `MCP server '${serverName}' has no command, transport, or URL.`, path: resourcePath });
    }

    const environment = rawServer["env"];
    if (recordValue(environment)) {
      for (const [key, secretValue] of Object.entries(environment)) {
        if (!/(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/iu.test(key) || secretValue === "") continue;
        const isReference = typeof secretValue === "string"
          && (/^\$\{[^}]+\}$/u.test(secretValue) || /^\$[A-Z_][A-Z0-9_]*$/u.test(secretValue));
        if (!isReference) {
          addDiagnostic({
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

function catalogResources(
  value: Record<string, unknown>,
  resourcePath: string,
  addDiagnostic: AddDiagnostic,
  maxEntries: number
): ScannedResource[] {
  const rawResources = value["resources"];
  const looksLikeCatalog = Array.isArray(rawResources)
    && (value["$schema"] === "https://raw.githubusercontent.com/mockingbird777/task2tool/main/schema/catalog-v1.schema.json" || value["catalogVersion"] !== undefined || value["name"] !== undefined);
  if (!looksLikeCatalog || !Array.isArray(rawResources)) return [];
  const resources: ScannedResource[] = [];
  if (rawResources.length > maxEntries) {
    addDiagnostic({ severity: "warning", code: "ENTRY_LIMIT_REACHED", message: `Catalog exceeds the ${maxEntries} entry processing limit.`, path: resourcePath });
  }

  for (const [index, rawResource] of rawResources.slice(0, maxEntries).entries()) {
    if (!recordValue(rawResource)) {
      addDiagnostic({ severity: "error", code: "INVALID_CATALOG_ENTRY", message: `Catalog entry ${index} must be an object.`, path: resourcePath });
      continue;
    }
    const name = cleanString(rawResource["name"]) ?? "";
    const kind = asResourceKind(rawResource["kind"]);
    const description = cleanString(rawResource["description"]) ?? "";
    const tags = uniqueSorted([kind, ...stringList(rawResource["tags"]), ...stringList(rawResource["capabilities"])]);
    const explicitId = cleanString(rawResource["id"]);
    const id = explicitId ? `catalog:${slug(explicitId)}` : `${kind}:${resourcePath.toLocaleLowerCase("en-US")}#${slug(name || String(index))}`;
    const locator = cleanString(rawResource["path"]) ?? cleanString(rawResource["url"]);
    if (!name) addDiagnostic({ severity: "error", code: "NAME_MISSING", message: `Catalog entry ${index} has no name.`, path: resourcePath, resourceId: id });
    if (!description) addDiagnostic({ severity: "warning", code: "DESCRIPTION_MISSING", message: `Catalog entry '${name || index}' has no description.`, path: resourcePath, resourceId: id });
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

export async function scanWorkspace(rootInput: string, limitOverrides: Partial<ScanLimits> = {}): Promise<ScanResult> {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Scan limit '${name}' must be a positive safe integer.`);
  }
  const root = resolve(rootInput);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new Error(`Scan root is not a directory: ${rootInput}`);
  const resources: ScannedResource[] = [];
  const diagnostics: LintIssue[] = [];
  let filesVisited = 0;
  let totalInputBytes = 0;
  let totalCorpusCharacters = 0;
  let halted = false;
  let corpusLimitReported = false;

  const addDiagnostic: AddDiagnostic = (issue) => {
    if (diagnostics.length < limits.maxDiagnostics) {
      diagnostics.push(issue);
      return;
    }
    if (!diagnostics.some((diagnostic) => diagnostic.code === "DIAGNOSTICS_TRUNCATED")) {
      diagnostics.push({ severity: "warning", code: "DIAGNOSTICS_TRUNCATED", message: `Diagnostics exceed the ${limits.maxDiagnostics} issue reporting limit.`, path: "." });
    }
  };

  function appendResources(discovered: readonly ScannedResource[]): void {
    for (const discoveredResource of discovered) {
      if (resources.length >= limits.maxResources) {
        addDiagnostic({ severity: "warning", code: "RESOURCE_LIMIT_REACHED", message: `Scan exceeds the ${limits.maxResources} resource limit.`, path: discoveredResource.path });
        halted = true;
        return;
      }
      const remainingCorpus = Math.max(0, limits.maxTotalCorpusCharacters - totalCorpusCharacters);
      const corpus = discoveredResource.corpus.slice(0, remainingCorpus);
      if (corpus.length < discoveredResource.corpus.length && !corpusLimitReported) {
        addDiagnostic({ severity: "warning", code: "CORPUS_LIMIT_REACHED", message: `Search text exceeds the ${limits.maxTotalCorpusCharacters} character aggregate limit; later resource metadata remains indexed.`, path: discoveredResource.path });
        corpusLimitReported = true;
      }
      totalCorpusCharacters += corpus.length;
      resources.push(corpus === discoveredResource.corpus ? discoveredResource : { ...discoveredResource, corpus });
    }
  }

  async function visit(directory: string): Promise<void> {
    if (halted) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      if (halted) return;
      if (filesVisited >= limits.maxFiles) {
        addDiagnostic({ severity: "warning", code: "FILE_LIMIT_REACHED", message: `Scan exceeds the ${limits.maxFiles} file traversal limit.`, path: toPosix(relative(root, directory)) || "." });
        halted = true;
        return;
      }
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
      if (fileStat.size > limits.maxFileBytes) {
        if (kind || candidateJson(entry.name)) addDiagnostic({ severity: "warning", code: "FILE_TOO_LARGE", message: `File exceeds the ${limits.maxFileBytes} byte scan limit.`, path: resourcePath });
        continue;
      }
      if (totalInputBytes + fileStat.size > limits.maxTotalInputBytes) {
        addDiagnostic({ severity: "warning", code: "INPUT_LIMIT_REACHED", message: `Scan exceeds the ${limits.maxTotalInputBytes} byte aggregate input limit.`, path: resourcePath });
        halted = true;
        return;
      }
      totalInputBytes += fileStat.size;
      const content = await readFile(absolutePath, "utf8");
      if (kind) {
        const resource = markdownResource(content, resourcePath, kind);
        if (!resource.description) addDiagnostic({ severity: "warning", code: "DESCRIPTION_MISSING", message: `Resource '${resource.name}' has no description.`, path: resourcePath, resourceId: resource.id });
        appendResources([resource]);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch {
        if (candidateJson(entry.name)) addDiagnostic({ severity: "error", code: "INVALID_JSON", message: "Candidate catalog or MCP configuration is not valid JSON.", path: resourcePath });
        continue;
      }
      if (!recordValue(parsed)) continue;
      appendResources(mcpResources(parsed, resourcePath, addDiagnostic, limits.maxEntriesPerDocument));
      if (!halted) appendResources(catalogResources(parsed, resourcePath, addDiagnostic, limits.maxEntriesPerDocument));
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
