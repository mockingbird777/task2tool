import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
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
});

test("CLI prints concise validation errors", async () => {
  const output = capture();
  const errors = capture();
  assert.equal(await runCli(["find", "task", "--limit", "0"], output.stream, errors.stream), 2);
  assert.match(errors.read(), /^task2tool: Limit must/u);
  assert.doesNotMatch(errors.read(), /\n\s+at /u);
});

test("CLI exposes help and version without scanning", async () => {
  const help = capture();
  const errors = capture();
  assert.equal(await runCli(["--help"], help.stream, errors.stream), 0);
  assert.match(help.read(), /task2tool find/u);
  const version = capture();
  assert.equal(await runCli(["--version"], version.stream, errors.stream), 0);
  assert.equal(version.read(), "0.1.0\n");
});
