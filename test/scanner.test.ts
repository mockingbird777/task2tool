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
  for (const directory of ["node_modules", ".git", "dist"]) {
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, `${directory.replace(".", "")}.prompt.md`), "# Ignore me\n\nNot a resource.\n");
  }
  await writeFile(join(root, "real.prompt.md"), "# Real\n\nA real prompt.\n");
  await symlink(join(root, "real.prompt.md"), join(root, "linked.prompt.md"));
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
