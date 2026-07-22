import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";

function capture(): { stream: Writable; read: () => string } {
  const chunks: string[] = [];
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } }),
    read: () => chunks.join("")
  };
}

test("CLI indexes and finds a real temporary catalog", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "task2tool-cli-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "review.prompt.md"), "# Review Helper\n\nReview code for security vulnerabilities.\n");
  const output = capture();
  const errors = capture();
  assert.equal(await runCli(["index", root, "--format", "json"], output.stream, errors.stream), 0);
  const indexed = JSON.parse(output.read()) as { resources: unknown[] };
  assert.equal(indexed.resources.length, 1);

  const found = capture();
  assert.equal(await runCli(["find", "security code review", "--root", root, "--format", "json"], found.stream, errors.stream), 0);
  const result = JSON.parse(found.read()) as { hits: Array<{ resource: { name: string } }> };
  assert.equal(result.hits[0]?.resource.name, "Review Helper");

  const composed = capture();
  assert.equal(await runCli(["compose", "security review release", "--root", root, "--format", "json"], composed.stream, errors.stream), 0);
  const composition = JSON.parse(composed.read()) as {
    schemaVersion: string;
    composition: { picks: Array<{ resource: { name: string }; newTerms: string[] }>; uncoveredTerms: string[] };
  };
  assert.equal(composition.schemaVersion, "1.2");
  assert.equal(composition.composition.picks[0]?.resource.name, "Review Helper");
  assert.ok(composition.composition.uncoveredTerms.includes("release"));
});

test("CLI prints concise validation errors", async () => {
  const output = capture();
  const errors = capture();
  assert.equal(await runCli(["find", "task", "--limit", "0"], output.stream, errors.stream), 2);
  assert.match(errors.read(), /^task2tool: Limit must/u);
  assert.doesNotMatch(errors.read(), /\n\s+at /u);
});

test("CLI errors remove terminal-active control sequences", async () => {
  const output = capture();
  const errors = capture();
  const maliciousCommand = `bad\u001b]52;c;Zm9v\u0007\u001b]8;;https://malicious.invalid\u001b\\link\u001b]8;;\u001b\\\u009b31m`;
  assert.equal(await runCli([maliciousCommand], output.stream, errors.stream), 2);
  assert.doesNotMatch(errors.read(), /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u);
  assert.doesNotMatch(errors.read(), /(?:\]52|Zm9v|malicious\.invalid|\]8;;|31m)/u);
  assert.match(errors.read(), /^task2tool: Unknown command/u);
});

test("default Markdown stdout removes complete OSC sequences from scanned metadata", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "task2tool-terminal-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const oscClipboard = `\u001b]52;c;Zm9v\u0007`;
  const oscLink = `\u001b]8;;https://malicious.invalid\u001b\\`;
  const oscClose = `\u001b]8;;\u001b\\`;
  await writeFile(join(root, "unsafe.prompt.md"), `# Safe${oscClipboard}Title\n\n${oscLink}Visible${oscClose}\n`);
  const output = capture();
  const errors = capture();

  assert.equal(await runCli(["index", root], output.stream, errors.stream), 0, errors.read());
  const markdown = output.read();
  assert.doesNotMatch(markdown, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u);
  assert.doesNotMatch(markdown, /(?:\]52|Zm9v|malicious\.invalid|\]8;;)/u);
  assert.match(markdown, /SafeTitle/u);
  assert.match(markdown, /Visible/u);
});

test("CLI exposes help and version without scanning", async () => {
  const help = capture();
  const errors = capture();
  assert.equal(await runCli(["--help"], help.stream, errors.stream), 0);
  assert.match(help.read(), /task2tool find/u);
  assert.match(help.read(), /task2tool compose/u);
  const version = capture();
  assert.equal(await runCli(["--version"], version.stream, errors.stream), 0);
  assert.equal(version.read(), "0.3.0\n");
});

test("CLI demo finds useful bundled examples without setup", async () => {
  const output = capture();
  const errors = capture();
  assert.equal(await runCli(["demo", "--format", "json"], output.stream, errors.stream), 0, errors.read());
  const result = JSON.parse(output.read()) as {
    query: string;
    summary: { matches: number; scannedResources: number };
    hits: Array<{ resource: { name: string } }>;
  };
  assert.equal(result.query, "review a pull request for security and reliability bugs");
  assert.ok(result.summary.scannedResources >= 5);
  assert.ok(result.summary.matches >= 1);
  assert.equal(result.hits[0]?.resource.name, "Pull Request Risk Reviewer");
});

test("CLI runs when invoked through an npm-style binary symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "task2tool-bin-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const link = join(root, "task2tool");
  await symlink(fileURLToPath(new URL("../src/cli.js", import.meta.url)), link);

  const result = spawnSync(process.execPath, [link, "--version"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "0.3.0\n");
});
