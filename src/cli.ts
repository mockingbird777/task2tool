#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatReport } from "./format.js";
import { lintScan } from "./lint.js";
import { publicResource, scanWorkspace } from "./scanner.js";
import { searchResources } from "./search.js";
import type { OutputFormat, ReportData, ResourceKind } from "./types.js";

const VERSION = "0.1.0";
const HELP = `Task2Tool ${VERSION} — find the right agent resource without loading every tool

Usage:
  task2tool index [directory] [--format json|markdown|html] [--output file]
  task2tool find <natural-language task> [--root directory] [--limit 10] [--format ...]
  task2tool lint [directory] [--format json|markdown|html] [--output file]

Examples:
  task2tool index . --format json --output task2tool-index.json
  task2tool find "review a pull request for security bugs" --root ~/agents
  task2tool find "query a Postgres database" --format html --output matches.html
  task2tool lint ./catalog

Options:
  -f, --format <value>  json, markdown, or html (inferred from --output when possible)
  -o, --output <path>   write atomically to a file; use - for stdout
      --root <path>     scan root for find, or override the positional directory
      --limit <number>  number of find results, 1–100 (default: 10)
  -h, --help            show help
  -v, --version         show version
`;

interface ParsedArguments {
  positionals: string[];
  options: Map<string, string>;
}

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const valueOptions = new Map([["-f", "format"], ["--format", "format"], ["-o", "output"], ["--output", "output"], ["--root", "root"], ["--limit", "limit"]]);
  let positionalOnly = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? "";
    if (argument === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && argument.startsWith("--") && argument.includes("=")) {
      const separator = argument.indexOf("=");
      const flag = argument.slice(0, separator);
      const key = valueOptions.get(flag);
      if (!key) throw new Error(`Unknown option: ${flag}`);
      const value = argument.slice(separator + 1);
      if (!value) throw new Error(`Option ${flag} requires a value.`);
      options.set(key, value);
      continue;
    }
    if (!positionalOnly && argument.startsWith("-")) {
      const key = valueOptions.get(argument);
      if (!key) throw new Error(`Unknown option: ${argument}`);
      const value = arguments_[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`Option ${argument} requires a value.`);
      options.set(key, value);
      index += 1;
      continue;
    }
    positionals.push(argument);
  }
  return { positionals, options };
}

function chooseFormat(explicit: string | undefined, output: string | undefined): OutputFormat {
  if (explicit) {
    if (explicit === "md") return "markdown";
    if (explicit === "json" || explicit === "markdown" || explicit === "html") return explicit;
    throw new Error(`Unsupported format '${explicit}'. Choose json, markdown, or html.`);
  }
  const extension = output ? extname(output).toLocaleLowerCase("en-US") : "";
  if (extension === ".json") return "json";
  if (extension === ".html" || extension === ".htm") return "html";
  return "markdown";
}

async function writeOutput(content: string, outputPath: string | undefined, stdout: NodeJS.WritableStream): Promise<void> {
  if (!outputPath || outputPath === "-") {
    stdout.write(content);
    return;
  }
  const target = resolve(outputPath);
  const temporary = `${target}.task2tool-${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  stdout.write(`Wrote ${target}\n`);
}

function resourceSummary(resources: readonly { kind: ResourceKind }[]): Record<string, number> {
  const summary: Record<string, number> = { resources: resources.length };
  for (const kind of ["skill", "agent", "prompt", "mcp-server", "catalog"] as const) {
    const count = resources.filter((resource) => resource.kind === kind).length;
    if (count > 0) summary[kind] = count;
  }
  return summary;
}

export async function runCli(
  arguments_: readonly string[],
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr
): Promise<number> {
  if (arguments_.includes("--help") || arguments_.includes("-h") || arguments_.length === 0) {
    stdout.write(HELP);
    return 0;
  }
  if (arguments_.includes("--version") || arguments_.includes("-v")) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  try {
    const command = arguments_[0];
    if (command !== "index" && command !== "find" && command !== "lint") throw new Error(`Unknown command '${command ?? ""}'. Run task2tool --help.`);
    const parsed = parseArguments(arguments_.slice(1));
    const outputPath = parsed.options.get("output");
    const format = chooseFormat(parsed.options.get("format"), outputPath);
    let report: ReportData;
    let exitCode = 0;

    if (command === "find") {
      if (parsed.positionals.length === 0) throw new Error("The find command requires a natural-language task.");
      const query = parsed.positionals.join(" ");
      const root = parsed.options.get("root") ?? ".";
      const rawLimit = parsed.options.get("limit") ?? "10";
      if (!/^\d+$/u.test(rawLimit)) throw new Error("Limit must be an integer between 1 and 100.");
      const limit = Number(rawLimit);
      const scan = await scanWorkspace(root);
      const hits = searchResources(scan.resources, query, limit);
      report = {
        command,
        title: "Relevant capabilities for your task",
        root: scan.root,
        query,
        hits,
        summary: { matches: hits.length, scannedResources: scan.resources.length, filesVisited: scan.filesVisited }
      };
    } else {
      if (parsed.positionals.length > 1) throw new Error(`${command} accepts at most one directory.`);
      const root = parsed.options.get("root") ?? parsed.positionals[0] ?? ".";
      const scan = await scanWorkspace(root);
      if (command === "index") {
        const resources = scan.resources.map(publicResource);
        report = {
          command,
          title: "Local agent capability index",
          root: scan.root,
          resources,
          summary: { ...resourceSummary(resources), filesVisited: scan.filesVisited }
        };
      } else {
        const issues = lintScan(scan);
        const errors = issues.filter((issue) => issue.severity === "error").length;
        const warnings = issues.length - errors;
        report = {
          command,
          title: issues.length === 0 ? "Catalog health: excellent" : "Catalog health report",
          root: scan.root,
          issues,
          summary: { resources: scan.resources.length, errors, warnings, filesVisited: scan.filesVisited }
        };
        if (errors > 0) exitCode = 1;
      }
    }
    await writeOutput(formatReport(report, format), outputPath, stdout);
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`task2tool: ${message}\n`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);

function sameExecutable(left: string, right: string): boolean {
  if (!left) return false;
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return left === right;
  }
}

if (sameExecutable(invokedPath, modulePath)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
