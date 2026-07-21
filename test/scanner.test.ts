import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publicResource, scanWorkspace } from "../src/scanner.js";

async function workspace(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "task2tool-test-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("recursively discovers supported Markdown resources in deterministic order", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "z.prompt.md"), "# Zed\n\nWrite reliable release notes.\n");
  await writeFile(join(root, "nested", "SKILL.md"), "---\nname: Audit Skill\ntags: [security, review]\n---\n# Audit\n\nReview a patch for security defects.\n");

  const first = await scanWorkspace(root);
  const second = await scanWorkspace(root);
  assert.deepEqual(first.resources, second.resources);
  assert.deepEqual(first.resources.map((resource) => resource.kind), ["prompt", "skill"]);
  const skill = first.resources.find((resource) => resource.kind === "skill");
  assert.equal(skill?.name, "Audit Skill");
  assert.match(skill?.description ?? "", /security defects/u);
});

test("ignores node_modules, .git, dist, and symbolic links", async (t) => {
  const root = await workspace(t);
  const outside = await workspace(t);
  for (const directory of ["node_modules", ".git", "dist"]) {
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, `${directory.replace(".", "")}.prompt.md`), "# Ignore me\n\nNot a resource.\n");
  }
  await writeFile(join(root, "real.prompt.md"), "# Real\n\nA real prompt.\n");
  await writeFile(join(outside, "outside.prompt.md"), "# Outside\n\nMust not cross the scan root.\n");
  await symlink(join(root, "real.prompt.md"), join(root, "linked.prompt.md"));
  await symlink(outside, join(root, "linked-directory"));
  const scan = await scanWorkspace(root);
  assert.equal(scan.resources.length, 1);
  assert.equal(scan.resources[0]?.name, "Real");
});

test("extracts MCP servers without exposing arguments or environment values", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "mcp.json"), JSON.stringify({
    mcpServers: {
      database: {
        description: "Query a private database safely.",
        command: "node",
        args: ["server.js", "--password", "do-not-index"],
        env: { DATABASE_PASSWORD: "super-secret" }
      }
    }
  }));
  const scan = await scanWorkspace(root);
  assert.equal(scan.resources.length, 1);
  const exposed = JSON.stringify(publicResource(scan.resources[0]!));
  assert.doesNotMatch(exposed, /super-secret|do-not-index/u);
  assert.equal(scan.diagnostics[0]?.code, "INLINE_SECRET");
});

test("accepts environment-variable references without a secret warning", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, ".mcp.json"), JSON.stringify({
    mcpServers: { github: { command: "npx", env: { API_TOKEN: "${GITHUB_TOKEN}" } } }
  }));
  const scan = await scanWorkspace(root);
  assert.equal(scan.resources.length, 1);
  assert.equal(scan.diagnostics.some((issue) => issue.code === "INLINE_SECRET"), false);
});

test("warns about non-string inline secrets without exporting their values", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "mcp.json"), JSON.stringify({
    mcpServers: { service: { command: "node", env: { API_KEY: 123456789 } } }
  }));
  const scan = await scanWorkspace(root);
  assert.equal(scan.diagnostics.some((issue) => issue.code === "INLINE_SECRET"), true);
  assert.doesNotMatch(JSON.stringify(publicResource(scan.resources[0]!)), /123456789/u);
});

test("reports malformed candidate catalogs but ignores unrelated malformed JSON", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "catalog.json"), "{broken");
  await writeFile(join(root, "scratch.json"), "{also broken");
  const scan = await scanWorkspace(root);
  assert.deepEqual(scan.diagnostics.map((issue) => issue.path), ["catalog.json"]);
  assert.equal(scan.diagnostics[0]?.code, "INVALID_JSON");
});

test("reads ARD-inspired catalogs and normalizes tags", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "team.catalog.json"), JSON.stringify({
    catalogVersion: 1,
    name: "Team",
    resources: [{ id: "release", name: "Release Captain", kind: "agent", description: "Coordinates safe releases.", tags: ["release", "release"], capabilities: ["changelog"] }]
  }));
  const scan = await scanWorkspace(root);
  assert.equal(scan.resources[0]?.id, "catalog:release");
  assert.deepEqual(scan.resources[0]?.tags, ["agent", "changelog", "release"]);
});

test("rejects a file as scan root", async (t) => {
  const root = await workspace(t);
  const file = join(root, "SKILL.md");
  await writeFile(file, "# Not a directory");
  await assert.rejects(scanWorkspace(file), /not a directory/u);
});

test("enforces aggregate input and corpus limits deterministically", async (t) => {
  const root = await workspace(t);
  const first = "# Alpha\n\n" + "security review ".repeat(20);
  const second = "# Beta\n\n" + "incident response ".repeat(20);
  await writeFile(join(root, "a.prompt.md"), first);
  await writeFile(join(root, "b.prompt.md"), second);

  const inputLimited = await scanWorkspace(root, { maxTotalInputBytes: Buffer.byteLength(first) });
  assert.deepEqual(inputLimited.resources.map((resource) => resource.name), ["Alpha"]);
  assert.equal(inputLimited.diagnostics.some((issue) => issue.code === "INPUT_LIMIT_REACHED"), true);

  const corpusLimited = await scanWorkspace(root, { maxTotalCorpusCharacters: 64 });
  assert.equal(corpusLimited.resources.length, 2);
  assert.ok(corpusLimited.resources.reduce((total, resource) => total + resource.corpus.length, 0) <= 64);
  assert.equal(corpusLimited.diagnostics.filter((issue) => issue.code === "CORPUS_LIMIT_REACHED").length, 1);
});

test("bounds entries, resources, and diagnostics from malformed catalogs", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "catalog.json"), JSON.stringify({
    catalogVersion: 1,
    name: "Large",
    resources: [
      { id: "one", name: "One", kind: "prompt", description: "First" },
      { id: "two", name: "Two", kind: "prompt", description: "Second" },
      { id: "three", name: "Three", kind: "prompt", description: "Third" }
    ]
  }));
  const entryLimited = await scanWorkspace(root, { maxEntriesPerDocument: 2 });
  assert.equal(entryLimited.resources.length, 2);
  assert.equal(entryLimited.diagnostics.some((issue) => issue.code === "ENTRY_LIMIT_REACHED"), true);

  const resourceLimited = await scanWorkspace(root, { maxResources: 1 });
  assert.equal(resourceLimited.resources.length, 1);
  assert.equal(resourceLimited.diagnostics.some((issue) => issue.code === "RESOURCE_LIMIT_REACHED"), true);

  await writeFile(join(root, "mcp.json"), JSON.stringify({ mcpServers: { a: 1, b: 2, c: 3 } }));
  const diagnosticLimited = await scanWorkspace(root, { maxDiagnostics: 1 });
  assert.equal(diagnosticLimited.diagnostics.some((issue) => issue.code === "DIAGNOSTICS_TRUNCATED"), true);
  assert.ok(diagnosticLimited.diagnostics.length <= 2);
});

test("discovers GitHub Copilot instruction Markdown as prompt resources", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, ".github", "instructions"), { recursive: true });
  await writeFile(join(root, ".github", "copilot-instructions.md"), "# Repo Conventions\n\nAlways write tests first.\n");
  await writeFile(join(root, ".github", "instructions", "security.instructions.md"), "---\nname: Security Rules\ntags: [security]\n---\n# Security\n\nNever log credentials.\n");
  await writeFile(join(root, "README.md"), "# Readme\n\nOrdinary docs stay out of the catalog.\n");
  await writeFile(join(root, "notes.md"), "# Notes\n\nAlso ignored.\n");
  await writeFile(join(root, "COPILOT-INSTRUCTIONS.MD"), "# Uppercase\n\nCase-insensitive match.\n");

  const first = await scanWorkspace(root);
  const second = await scanWorkspace(root);
  assert.deepEqual(first.resources, second.resources); // deterministic ordering

  const kinds = first.resources.map((resource) => resource.kind);
  assert.deepEqual(kinds, ["prompt", "prompt", "prompt"]);
  const names = first.resources.map((resource) => resource.name).sort();
  assert.deepEqual(names, ["Repo Conventions", "Security Rules", "Uppercase"]);

  const security = first.resources.find((resource) => resource.name === "Security Rules");
  assert.match(security?.description ?? "", /credentials/u);
  assert.deepEqual(security?.tags, ["prompt", "security"]);
  assert.match(security?.id ?? "", /^prompt:/u);

  const paths = first.resources.map((resource) => resource.path).join("\n");
  assert.doesNotMatch(paths, /README\.md|notes\.md/u);
});


test("parses YAML block-list tags and keywords in frontmatter", async (t) => {
  const root = await workspace(t);
  const content = [
    "---",
    "name: Block Tags",
    "tags:",
    "  - security",
    '  - "review"',
    "keywords:",
    "  - 'audit'",
    "---",
    "# Block",
    "",
    "Body.",
  ].join("\n");
  await writeFile(join(root, "block.prompt.md"), content);

  const scan = await scanWorkspace(root);
  const resource = scan.resources.find((r) => r.name === "Block Tags");
  assert.ok(resource);
  // kind tag + block-list values, deduped and sorted deterministically.
  assert.deepEqual(resource.tags, ["audit", "prompt", "review", "security"]);
});

test("still parses inline-list tags", async (t) => {
  const root = await workspace(t);
  const content = [
    "---",
    "name: Inline",
    "tags: [security, review]",
    "---",
    "# Inline",
    "",
    "Body.",
  ].join("\n");
  await writeFile(join(root, "inline.prompt.md"), content);

  const scan = await scanWorkspace(root);
  const resource = scan.resources.find((r) => r.name === "Inline");
  assert.ok(resource);
  assert.deepEqual(resource.tags, ["prompt", "review", "security"]);
});

test("block-list stops at a nested/mapping item without crashing", async (t) => {
  const root = await workspace(t);
  const content = [
    "---",
    "name: Nested",
    "tags:",
    "  - security",
    "  - nested: value",
    "---",
    "# Nested",
    "",
    "Body.",
  ].join("\n");
  await writeFile(join(root, "nested.prompt.md"), content);

  const scan = await scanWorkspace(root);
  const resource = scan.resources.find((r) => r.name === "Nested");
  assert.ok(resource);
  // The scalar before the mapping item is kept; the mapping item is not.
  assert.deepEqual(resource.tags, ["prompt", "security"]);
});
